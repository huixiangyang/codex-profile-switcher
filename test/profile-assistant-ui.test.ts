import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { state, workspace, type StubPickItem } from './vscode-stub';
import { createProfileDocument, showProfilePreview, profileDescription } from '../src/profile-assistant-ui';

function reset(): void {
  state.picks.length = 0; state.inputs.length = 0; state.documents.length = 0; state.shownDocuments.length = 0;
  state.notifications.length = 0; state.updates.length = 0; state.values.clear();
  state.quickPickHandler = undefined; state.inputBoxHandler = undefined;
  workspace.isTrusted = true;
}
async function fixture(t: { after: (callback: () => unknown) => void }): Promise<string> {
  reset();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-assistant-ui-'));
  t.after(async () => { reset(); await fs.rm(home, { recursive: true, force: true }); });
  return home;
}
const pickValue = (items: StubPickItem[], value: unknown) => items.find(item => item.value === value);
async function snapshot(home: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of (await fs.readdir(home)).sort()) out[name] = await fs.readFile(path.join(home, name), 'utf8');
  return out;
}

test('向导只创建未保存文档：继承可选，元数据来自合成配置且不读取认证/会话', async t => {
  const home = await fixture(t);
  await fs.writeFile(path.join(home, 'config.toml'), 'model = "代码模型-v1"\nmodel_provider = "relay"\n[model_providers.relay]\napi_key = "SECRET_CREDENTIAL"\nbase_url = "https://private.example"');
  await fs.writeFile(path.join(home, 'auth.json'), '{"token":"AUTH_SENTINEL"}');
  await fs.writeFile(path.join(home, 'sessions.jsonl'), '{"message":"SESSION_SENTINEL"}');
  const before = await snapshot(home), reads: string[] = [];
  const original = fs.readFile;
  fs.readFile = (async (...args: Parameters<typeof fs.readFile>) => { reads.push(String(args[0])); return original(...args); }) as typeof fs.readFile;
  t.after(() => { fs.readFile = original; });
  state.inputBoxHandler = async options => {
    const validate = (options as { validateInput: (value: string) => unknown }).validateInput;
    assert.equal(validate('new-profile'), undefined);
    assert.ok(validate('../escape'));
    return 'new-profile';
  };
  const values: unknown[] = ['coding', '代码模型-v1', 'relay', 'medium'];
  state.quickPickHandler = async items => pickValue(items, values.shift());
  await createProfileDocument(() => home);
  fs.readFile = original;
  assert.deepEqual(reads.map(file => path.basename(file)), ['config.toml', 'config.toml']);
  assert.equal(state.documents.length, 1);
  assert.equal(state.documents[0].language, 'toml');
  assert.deepEqual({ ...parse(state.documents[0].content!) }, { model: '代码模型-v1', model_provider: 'relay', model_reasoning_effort: 'medium' });
  assert.equal(state.shownDocuments.length, 1);
  const shown = state.shownDocuments[0] as { document: { isUntitled: boolean }; options: { preview: boolean } };
  assert.equal(shown.document.isUntitled, true); assert.equal(shown.options.preview, false);
  assert.deepEqual(await snapshot(home), before);
  assert.deepEqual(state.updates, []);
  assert.doesNotMatch(JSON.stringify([state.picks, state.documents, state.notifications]), /SECRET_CREDENTIAL|AUTH_SENTINEL|SESSION_SENTINEL|private\.example|api_key/);
});

test('向导每一步取消都不创建文档、不写文件或设置，可立即重新打开', async t => {
  const home = await fixture(t);
  await fs.writeFile(path.join(home, 'config.toml'), 'model = "fixture"');
  const before = await snapshot(home);
  for (let cancel = 0; cancel < 5; cancel++) {
    reset();
    state.inputBoxHandler = async () => cancel === 0 ? undefined : 'cancel-test';
    let step = 0;
    state.quickPickHandler = async items => ++step === cancel ? undefined : items[0];
    await createProfileDocument(() => home);
    assert.equal(state.documents.length, 0); assert.equal(state.shownDocuments.length, 0);
    assert.deepEqual(state.updates, []); assert.deepEqual(state.notifications, []);
    assert.deepEqual(await snapshot(home), before);
  }
  reset(); state.inputBoxHandler = async () => 'reopened';
  const values: unknown[] = ['custom', undefined, undefined, null];
  state.quickPickHandler = async items => pickValue(items, values.shift());
  await createProfileDocument(() => home);
  assert.equal(state.documents.length, 1);
  assert.deepEqual({ ...parse(state.documents[0].content!) }, {});
  assert.deepEqual(await snapshot(home), before);
});

test('名称校验不能被 API 绕过，结束前重新核对大小写重名文件', async t => {
  const home = await fixture(t);
  state.inputBoxHandler = async () => '../outside';
  await createProfileDocument(() => home);
  assert.equal(state.picks.length, 0); assert.equal(state.documents.length, 0);
  assert.equal((await fs.readdir(home)).length, 0);
  reset(); state.inputBoxHandler = async () => 'MyProfile';
  let step = 0;
  state.quickPickHandler = async items => {
    if (++step === 4) await fs.writeFile(path.join(home, 'myprofile.config.toml'), '# created externally');
    return items[0];
  };
  await createProfileDocument(() => home);
  assert.equal(state.documents.length, 0); assert.equal(state.notifications.length, 1);
  assert.equal(await fs.readFile(path.join(home, 'myprofile.config.toml'), 'utf8'), '# created externally');
});

test('不受信任时不解析来源，向导途中切换来源或撤销信任则失效', async t => {
  const home = await fixture(t);
  workspace.isTrusted = false;
  let calls = 0;
  const source = () => { calls++; return home; };
  await createProfileDocument(source); await showProfilePreview(source);
  assert.equal(calls, 0); assert.equal(state.inputs.length, 0); assert.equal(state.picks.length, 0);
  reset(); let current = home;
  state.inputBoxHandler = async () => { current = path.join(home, 'new-home'); return 'stale'; };
  await createProfileDocument(() => current);
  assert.equal(state.documents.length, 0); assert.equal(state.picks.length, 0);
  reset(); state.inputBoxHandler = async () => 'stale';
  let step = 0;
  state.quickPickHandler = async items => { if (++step === 4) workspace.isTrusted = false; return items[0]; };
  await createProfileDocument(() => home);
  assert.equal(state.documents.length, 0); assert.deepEqual(await fs.readdir(home), []);
});

test('缺失目录仍可生成继承草稿，但不创建目录；失败错误不回显值', async t => {
  const root = await fixture(t), home = path.join(root, 'missing');
  state.inputBoxHandler = async () => 'review';
  state.quickPickHandler = async items => items[0];
  await createProfileDocument(() => home);
  assert.equal(state.documents.length, 1); await assert.rejects(fs.stat(home), { code: 'ENOENT' });
  reset(); state.inputBoxHandler = async () => { throw new Error('SECRET_BACKEND_ERROR'); };
  await createProfileDocument(() => home);
  assert.equal(state.documents.length, 0); assert.equal(state.notifications.length, 1);
  assert.doesNotMatch(JSON.stringify(state.notifications), /SECRET_BACKEND_ERROR/);
});

test('安全预览只列白名单值，未知键及嵌套密钥隐藏且不切换不保存', async t => {
  const home = await fixture(t);
  const text = 'model = "sk-SECRET_MODEL"\nmodel_provider = "relay"\nmodel_reasoning_effort = "high"\napproval_policy = "on-request"\nsandbox_mode = "workspace-write"\nSECRET_KEY_NAME = "SECRET_UNKNOWN"\n[model_providers.relay]\napi_key = "SECRET_PROVIDER"\nbase_url = "https://private.example"';
  await fs.writeFile(path.join(home, 'private.config.toml'), text);
  const before = await snapshot(home);
  state.quickPickHandler = async items => items.find(item => item.label === 'private');
  await showProfilePreview(() => home);
  assert.equal(state.picks.length, 2);
  const result = state.picks[1].items;
  assert.equal(result.find(item => item.label === 'model_provider')?.description, 'relay');
  assert.equal(result.find(item => item.label === 'model_reasoning_effort')?.description, 'high');
  assert.ok(result.find(item => item.label === 'model_providers'));
  assert.doesNotMatch(JSON.stringify([state.picks, state.notifications]), /SECRET_|private\.example|api_key|\[model_providers/);
  assert.deepEqual(await snapshot(home), before); assert.deepEqual(state.updates, []); assert.equal(state.documents.length, 0);
});

test('默认预览不读 config，取消或失效来源不会展开；损坏 TOML 和特殊顶层键安全报错', async t => {
  const home = await fixture(t);
  await fs.writeFile(path.join(home, 'config.toml'), 'SECRET_DEFAULT = "malformed');
  state.quickPickHandler = async items => items[0];
  await showProfilePreview(() => home);
  assert.equal(state.picks.length, 2); assert.deepEqual(state.notifications, []);
  assert.doesNotMatch(JSON.stringify(state.picks), /SECRET_DEFAULT/);
  reset(); await showProfilePreview(() => home);
  assert.equal(state.picks.length, 1); assert.deepEqual(state.notifications, []);
  for (const text of ['token = "SECRET_PARSE_LINE', '"SECRET_BAD.KEY" = "SECRET_VALUE"']) {
    reset(); await fs.writeFile(path.join(home, 'broken.config.toml'), text);
    state.quickPickHandler = async items => items.find(item => item.label === 'broken');
    await showProfilePreview(() => home);
    assert.equal(state.picks.length, 1); assert.equal(state.notifications.length, 1);
    assert.doesNotMatch(JSON.stringify([state.picks, state.notifications]), /SECRET_/);
  }
  reset(); let current = home;
  state.quickPickHandler = async items => { current = path.join(home, 'changed'); return items[0]; };
  await showProfilePreview(() => current);
  assert.equal(state.picks.length, 1); assert.equal(state.notifications.length, 1);
  assert.equal(state.documents.length, 0); assert.deepEqual(state.updates, []);
});

test('切换菜单摘要不回显外部错误或注入式元数据', () => {
  assert.doesNotMatch(profileDescription({ name: 'safe', file: '/unused', error: 'SECRET_ERROR' }), /SECRET/);
  assert.doesNotMatch(profileDescription({ name: 'safe', file: '/unused', provider: 'Bearer SECRET', model: '$(zap) SECRET\n' }), /SECRET|\$\(/);
});
