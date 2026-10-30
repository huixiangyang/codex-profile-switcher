import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import {
  collectMetadata, createProfileDraft, previewOverrides, readAssistantMetadata,
  safeMetadataValue, validateDraftName, validateProfileToml,
  type DraftOptions, type ProfileTemplate, type ReasoningEffort
} from '../src/profile-assistant';
import { profileArgs, tomlValue } from '../src/profiles';

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

function restoredArgs(data: Record<string, unknown>): Record<string, unknown> {
  const args = profileArgs(data);
  assert.ok(args.every((value, index) => index % 2 || value === '-c'));
  return args.filter((_, index) => index % 2).reduce<Record<string, unknown>>((all, value) => Object.assign(all, parse(value)), {});
}

test('草稿模板只设置推理强度，显式继承和自定义不复制默认配置', () => {
  const expected: Record<ProfileTemplate, Record<string, unknown>> = {
    coding: { model_reasoning_effort: 'medium' },
    review: { model_reasoning_effort: 'high' },
    custom: {}
  };
  for (const template of ['coding', 'review', 'custom'] as const) {
    const draft = createProfileDraft({ name: 'work-2', template });
    assert.deepEqual(plain(parse(draft)), expected[template]);
    assert.deepEqual(plain(parse(createProfileDraft({ name: 'work-2', template, effort: null }))), {});
    for (const effort of ['low', 'medium', 'high'] as const) {
      assert.deepEqual(plain(parse(createProfileDraft({ name: 'work-2', template, effort }))), { model_reasoning_effort: effort });
    }
  }
  const explicit = createProfileDraft({ name: 'my_review', template: 'review', model: 'org/模型-v2.1', provider: '团队中继', effort: 'low' });
  assert.deepEqual(plain(parse(explicit)), { model: 'org/模型-v2.1', model_provider: '团队中继', model_reasoning_effort: 'low' });
  assert.deepEqual(plain(validateProfileToml(explicit)), plain(parse(explicit)));
});

test('名称校验拒绝路径、控制符、Unicode、保留名和大小写冲突，不回显输入', () => {
  for (const name of ['coding', 'REVIEW_2', 'a-b', 'a'.repeat(64)]) assert.equal(validateDraftName(name), undefined);
  for (const name of ['', '../escape', '/absolute', 'with space', 'with.dot', 'review.config.toml', 'a\\b', 'line\nbreak', 'a\0b', '审阅', 'a'.repeat(65), 'config', 'AUTH', 'Con', 'PRN', 'aux', 'NUL', 'COM1', 'LPT9']) {
    assert.ok(validateDraftName(name), `should reject ${JSON.stringify(name)}`);
    assert.throws(() => createProfileDraft({ name, template: 'coding' }));
  }
  assert.ok(validateDraftName('review', ['Review']));
  assert.ok(validateDraftName('CODING', ['coding']));
  assert.equal(validateDraftName('review-2', ['review']), undefined);
  const malicious = 'PRIVATE_NAME_SENTINEL/../bad';
  assert.doesNotMatch(validateDraftName(malicious)!, /PRIVATE_NAME_SENTINEL/);
});

test('草稿拒绝未知模板、非法强度与危险标识，错误不含输入值', () => {
  const inputs: DraftOptions[] = [
    { name: 'safe', template: 'PRIVATE_TEMPLATE_SENTINEL' as ProfileTemplate },
    { name: 'safe', template: 'custom', effort: 'PRIVATE_EFFORT_SENTINEL' as ReasoningEffort },
    { name: 'safe', template: 'custom', model: 'sk-PRIVATE_MODEL_SENTINEL' },
    { name: 'safe', template: 'custom', provider: 'https://PRIVATE_PROVIDER_SENTINEL.invalid' },
    { name: 'safe', template: 'custom', model: 'quoted"value' },
    { name: 'safe', template: 'custom', provider: 'line\nbreak' }
  ];
  for (const input of inputs) assert.throws(() => createProfileDraft(input), error => {
    assert.doesNotMatch(String(error), /PRIVATE_.*_SENTINEL|quoted"value|line\nbreak/);
    return true;
  });
});

test('元数据仅收集允许字段与 Provider 名称，过滤凭据形状、URL 和控件标记', () => {
  const models = new Set<string>(), providers = new Set<string>();
  collectMetadata({ model: '模型-v2', model_provider: 'relay', api_key: 'PRIVATE_API_SENTINEL',
    model_providers: { 'other-relay': { api_key: 'PRIVATE_NESTED_SENTINEL', base_url: 'https://private.invalid' }, 'sk-private-value': {} },
    nested: { model: 'PRIVATE_NESTED_MODEL_SENTINEL' }
  }, models, providers);
  collectMetadata({ model: '模型-v2', model_provider: 'relay' }, models, providers);
  assert.deepEqual([...models], ['模型-v2']);
  assert.deepEqual([...providers], ['relay', 'other-relay']);
  assert.doesNotMatch(JSON.stringify({ models: [...models], providers: [...providers] }), /PRIVATE_|private\.invalid/);
  for (const unsafe of [undefined, null, 42, {}, '', 'a'.repeat(97), 'https://private.invalid', 'user:password', 'Bearerabc', 'sk-value', 'sk_value', 'sess-value', 'github_pat_value', 'ghp_value', 'xoxb-value', 'AKIA1234567890ABCDEF', 'api-key', 'access_token', 'credential', 'a\nb', 'a\tb', 'a\u202eb', '$(warning)model', 'quote"injection', '\\path']) {
    assert.equal(safeMetadataValue(unsafe), undefined, `should hide ${JSON.stringify(unsafe)}`);
  }
  for (const safe of ['ordinary-model', 'company_relay', 'org/model.v2', '模型', '提供商-2']) assert.equal(safeMetadataValue(safe), safe);
});

test('只读目录扫描跳过 auth/session 与其他文件，保留损坏项名称且不泄漏原始内容', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-assistant-read-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const files = {
    'config.toml': `model = 'base-model'\nmodel_provider = 'base-provider'\napi_key = 'PRIVATE_CONFIG_SENTINEL'\n[model_providers.extra-provider]\nbase_url = 'https://private.invalid'\napi_key = 'PRIVATE_PROVIDER_SENTINEL'\n`,
    'review.config.toml': `model = 'review-model'\nmodel_provider = 'review-provider'\nmodel_reasoning_effort = 'high'\n`,
    'broken.config.toml': 'api_key = "PRIVATE_PARSE_SENTINEL',
    'auth.json': '{"access_token":"PRIVATE_AUTH_SENTINEL"}',
    'auth.toml': 'model = "PRIVATE_AUTH_MODEL_SENTINEL"',
    'invalid.name.config.toml': 'model = "PRIVATE_INVALID_NAME_SENTINEL"',
    'ignored.txt': 'model = "PRIVATE_TEXT_SENTINEL"'
  };
  for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(home, name), content);
  await fs.mkdir(path.join(home, 'sessions'));
  await fs.writeFile(path.join(home, 'sessions', 'synthetic.jsonl'), '{"model":"PRIVATE_SESSION_SENTINEL"}');
  const readFile = fs.readFile;
  const reads: string[] = [];
  const spy = t.mock.method(fs, 'readFile', (file: unknown, ...args: unknown[]) => {
    const filename = String(file);
    assert.ok(['config.toml', 'review.config.toml', 'broken.config.toml'].some(name => filename === path.join(home, name)), 'only known config sources may be read');
    reads.push(path.basename(filename));
    return Reflect.apply(readFile, fs, [file, ...args]);
  });
  const metadata = await readAssistantMetadata(home);
  spy.mock.restore();
  assert.deepEqual(reads.sort(), ['broken.config.toml', 'config.toml', 'review.config.toml']);
  assert.deepEqual(metadata, {
    names: ['broken', 'review'], models: ['base-model', 'review-model'], providers: ['base-provider', 'extra-provider', 'review-provider'], incomplete: true
  });
  assert.doesNotMatch(JSON.stringify(metadata), /PRIVATE_|private\.invalid/);
  const draft = createProfileDraft({ name: 'new-review', template: 'review', model: metadata.models[0], provider: metadata.providers[0] });
  assert.deepEqual(Object.keys(parse(draft)).sort(), ['model', 'model_provider', 'model_reasoning_effort']);
  assert.doesNotMatch(draft, /PRIVATE_|api_key|base_url|model_providers/);
  assert.deepEqual((await fs.readdir(home)).sort(), [...Object.keys(files), 'sessions'].sort());
  for (const [name, content] of Object.entries(files)) assert.equal(await fs.readFile(path.join(home, name), 'utf8'), content);
  assert.equal(await fs.readFile(path.join(home, 'sessions', 'synthetic.jsonl'), 'utf8'), '{"model":"PRIVATE_SESSION_SENTINEL"}');
});

test('缺失目录不创建文件，非文件和超限配置仅标记不完整，目录错误不回显路径', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-assistant-limits-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const missing = path.join(root, 'not-created');
  const mutations = ['writeFile', 'appendFile', 'mkdir', 'rename', 'unlink', 'copyFile', 'truncate', 'chmod'] as const;
  const spies = mutations.map(method => t.mock.method(fs, method, () => { throw new Error(`unexpected mutation: ${method}`); }));
  assert.deepEqual(await readAssistantMetadata(missing), { names: [], models: [], providers: [], incomplete: false });
  createProfileDraft({ name: 'unsaved', template: 'coding' });
  for (const spy of spies) { assert.equal(spy.mock.callCount(), 0); spy.mock.restore(); }
  await assert.rejects(fs.access(missing), { code: 'ENOENT' });
  await fs.mkdir(path.join(root, 'directory.config.toml'));
  const oversized = path.join(root, 'large.config.toml');
  await fs.writeFile(oversized, '#'.repeat(1024 * 1024 + 1));
  assert.deepEqual(await readAssistantMetadata(root), { names: ['directory', 'large'], models: [], providers: [], incomplete: true });
  const notDirectory = path.join(root, 'PRIVATE_PATH_SENTINEL');
  await fs.writeFile(notDirectory, 'not a directory');
  await assert.rejects(readAssistantMetadata(notDirectory), error => {
    assert.doesNotMatch(String(error), /PRIVATE_PATH_SENTINEL|not a directory/);
    return true;
  });
});

test('TOML 校验保留未知合法配置、转义与 Unicode，错误不暴露内容', () => {
  const values = ['引号 " 与反斜杠 \\', '第一行\n第二行\t\r', 'emoji 😀 / 标点', '\b\f'];
  for (const value of values) assert.equal(parse(`note = ${tomlValue(value)}`).note, value);
  const data = { future_option: { 'a.b/路径': values }, note: 'literal "quoted" \\ path\nline' };
  const content = Object.entries(data).map(([key, value]) => `${key} = ${tomlValue(value)}`).join('\n');
  const validated = validateProfileToml(content);
  assert.deepEqual(plain(validated), data);
  assert.deepEqual(plain(restoredArgs(validated)), data);
  for (const content of ['api_key = "PRIVATE_PARSE_SENTINEL', '"PRIVATE.KEY_SENTINEL" = "PRIVATE_VALUE_SENTINEL"', '"私人键" = "PRIVATE_VALUE_SENTINEL"']) {
    assert.throws(() => validateProfileToml(content), error => {
      assert.doesNotMatch(String(error), /PRIVATE_|私人键/);
      return true;
    });
  }
});

test('预览仅显示允许的字段值、布尔值和表存在性，未知键计数而不改变实际应用', () => {
  const data = validateProfileToml(`
model = 'org/模型-v2'
model_provider = 'relay'
model_reasoning_effort = 'high'
approval_policy = 'on-request'
sandbox_mode = 'workspace-write'
model_verbosity = 'low'
model_reasoning_summary = 'auto'
web_search = 'cached'
disable_response_storage = false
PRIVATE_FUTURE_NAME_SENTINEL = 'PRIVATE_FUTURE_VALUE_SENTINEL'
api_key = 'PRIVATE_KEY_SENTINEL'
[model_providers.relay]
api_key = 'PRIVATE_PROVIDER_SENTINEL'
[mcp_servers.private]
env = { PRIVATE_ENV_SENTINEL = 'PRIVATE_ENV_VALUE_SENTINEL' }
[features]
PRIVATE_FEATURE_SENTINEL = true
[sandbox_workspace_write]
writable_roots = ['/PRIVATE_ROOT_SENTINEL']
[tools]
PRIVATE_TOOL_SENTINEL = true
[projects.'/PRIVATE_PROJECT_SENTINEL']
trust_level = 'trusted'
`);
  const before = plain(data), preview = previewOverrides(data);
  assert.equal(preview.omitted, 2);
  const fields = Object.fromEntries(preview.fields.map(field => [field.key, field.value]));
  for (const key of ['model', 'model_provider', 'model_reasoning_effort', 'approval_policy', 'sandbox_mode', 'model_verbosity', 'model_reasoning_summary', 'web_search']) assert.equal(fields[key], data[key]);
  assert.equal(fields.disable_response_storage, 'false');
  for (const key of ['model_providers', 'mcp_servers', 'features', 'sandbox_workspace_write', 'tools', 'projects']) assert.ok(typeof fields[key] === 'string');
  assert.doesNotMatch(JSON.stringify(preview), /PRIVATE_|api_key|trust_level|writable_roots|-c/);
  assert.deepEqual(plain(data), before);
  assert.deepEqual(plain(restoredArgs(data)), before);
  assert.deepEqual(previewOverrides({}), { fields: [], omitted: 0 });
});

test('预览隐藏错误类型、未识别枚举与伪装在模型字段的敏感值', () => {
  const data = { model: 'sk-PRIVATE_MODEL_SENTINEL', model_provider: 'https://PRIVATE_PROVIDER_SENTINEL.invalid', model_reasoning_effort: 'PRIVATE_EFFORT_SENTINEL', approval_policy: ['PRIVATE_ARRAY_SENTINEL'], sandbox_mode: false, model_verbosity: 17, model_reasoning_summary: 'PRIVATE_SUMMARY_SENTINEL', web_search: 'PRIVATE_SEARCH_SENTINEL', disable_response_storage: 'PRIVATE_BOOL_SENTINEL' };
  const preview = previewOverrides(data);
  assert.equal(preview.omitted, 0);
  assert.equal(preview.fields.length, 9);
  assert.doesNotMatch(JSON.stringify(preview), /PRIVATE_|https:|sk-/);
  assert.deepEqual(plain(restoredArgs(data)), data);
  assert.throws(() => previewOverrides({ 'PRIVATE.BAD_KEY': 'PRIVATE_BAD_VALUE' }), error => {
    assert.doesNotMatch(String(error), /PRIVATE_/);
    return true;
  });
});
