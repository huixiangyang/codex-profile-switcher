import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'smol-toml';
import { profileArgs, tomlValue } from './profiles';

export const reasoningEfforts = ['low', 'medium', 'high'] as const;
export type ReasoningEffort = typeof reasoningEfforts[number];
export type ProfileTemplate = 'coding' | 'review' | 'custom';
export const templates: Record<ProfileTemplate, { label: string; effort?: ReasoningEffort }> = {
  coding: { label: '日常编码', effort: 'medium' },
  review: { label: '代码审阅', effort: 'high' },
  custom: { label: '自定义', effort: undefined }
};

// Names match the existing discovery contract. Also avoid ambiguous default/auth
// names, portable filename hazards, and case-only collisions when making drafts.
export function validateDraftName(name: string, existing: readonly string[] = []): string | undefined {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) return '名称需为 1–64 位字母、数字、短横线或下划线。';
  if (/^(?:config|auth|con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name)) return '此名称保留给配置、凭据或系统文件，请换一个名称。';
  if (existing.some(value => value.toLowerCase() === name.toLowerCase())) return '已存在同名 Profile，请换一个名称；草稿不会覆盖现有文件。';
  return undefined;
}

// Only identifier-like metadata can be offered or displayed. Never include
// provider definitions, URLs, control characters, or credential-shaped values.
export function safeMetadataValue(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 96 || !/^[\p{L}\p{N}_][\p{L}\p{N}._/-]*$/u.test(value)) return undefined;
  if (/(?:secret|password|credential|authorization|api[_-]?key|token|bearer|sk[-_]|sess-|gh[pousr]_|github_pat_|xox[baprs]-|AKIA[0-9A-Z]{16})/i.test(value)) return undefined;
  return value;
}

export interface AssistantMetadata {
  names: string[];
  models: string[];
  providers: string[];
  incomplete: boolean;
}

export function collectMetadata(data: Record<string, unknown>, models: Set<string>, providers: Set<string>): void {
  const model = safeMetadataValue(data.model), provider = safeMetadataValue(data.model_provider);
  if (model) models.add(model);
  if (provider) providers.add(provider);
  if (data.model_providers && typeof data.model_providers === 'object' && !Array.isArray(data.model_providers)) {
    for (const key of Object.keys(data.model_providers)) {
      const id = safeMetadataValue(key);
      if (id) providers.add(id);
    }
  }
}

// Explicit read-only boundary: only config.toml and discoverable profile TOMLs.
// A missing home is an empty catalog, not a reason to create a directory.
export async function readAssistantMetadata(home: string): Promise<AssistantMetadata> {
  let entries: string[];
  try { entries = await fs.readdir(home); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { names: [], models: [], providers: [], incomplete: false };
    throw new Error('无法读取配置目录；请检查目录和访问权限。');
  }
  const files = entries.filter(name => /^[A-Za-z0-9_-]+\.config\.toml$/.test(name)).sort();
  const models = new Set<string>(), providers = new Set<string>();
  let incomplete = false;
  for (const filename of [...(entries.includes('config.toml') ? ['config.toml'] : []), ...files]) {
    try {
      const file = path.join(home, filename), stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 1024 * 1024) { incomplete = true; continue; }
      const data = parse(await fs.readFile(file, 'utf8'));
      collectMetadata(data, models, providers);
    } catch { incomplete = true; } // Parser and OS errors may contain secrets/paths.
  }
  return { names: files.map(name => name.slice(0, -'.config.toml'.length)), models: [...models].sort(), providers: [...providers].sort(), incomplete };
}

export interface DraftOptions {
  name: string;
  template: ProfileTemplate;
  model?: string;
  provider?: string;
  // undefined uses the template; null explicitly inherits the default.
  effort?: ReasoningEffort | null;
}

export function createProfileDraft(options: DraftOptions): string {
  const nameError = validateDraftName(options.name);
  if (nameError) throw new Error(nameError);
  if (!Object.hasOwn(templates, options.template)) throw new Error('请选择有效的 Profile 模板。');
  const data: Record<string, unknown> = {};
  for (const [key, value] of [['model', options.model], ['model_provider', options.provider]] as const) {
    if (value === undefined) continue;
    if (!safeMetadataValue(value)) throw new Error('模型或 Provider 标识无法安全写入草稿；请在编辑器中手动检查。');
    data[key] = value;
  }
  const effort = options.effort === undefined ? templates[options.template].effort : options.effort;
  if (effort !== undefined && effort !== null) {
    if (!reasoningEfforts.includes(effort)) throw new Error('请选择支持的推理强度。');
    data.model_reasoning_effort = effort;
  }
  const content = [
    `# Profile draft: ${options.name}.config.toml`,
    '# Unsaved draft: use Save As to choose the location. No files were changed.',
    '# Save in your configured Codex home to make this profile discoverable.',
    '# Omitted settings inherit Codex defaults. Keep credentials out of profiles.',
    '# Template reasoning effort is a starting point, not a model capability check.',
    ...Object.entries(data).map(([key, value]) => `${key} = ${tomlValue(value)}`), ''
  ].join('\n');
  validateProfileToml(content);
  return content;
}

export function validateProfileToml(content: string): Record<string, unknown> {
  let data: Record<string, unknown>;
  try { data = parse(content); }
  catch { throw new Error('TOML 格式无效；请在编辑器中检查，错误详情不会显示配置内容。'); }
  // Uses precisely the same top-level/serialization contract as application.
  profileArgs(data);
  return data;
}

export interface OverridePreview { fields: { key: string; value: string }[]; omitted: number }
const enumValues: Record<string, readonly string[]> = {
  model_reasoning_effort: reasoningEfforts,
  approval_policy: ['untrusted', 'on-failure', 'on-request', 'never'],
  sandbox_mode: ['read-only', 'workspace-write', 'danger-full-access'],
  model_verbosity: ['low', 'medium', 'high'],
  model_reasoning_summary: ['auto', 'concise', 'detailed', 'none'],
  web_search: ['disabled', 'cached', 'live']
};
const tableKeys = ['model_providers', 'mcp_servers', 'features', 'sandbox_workspace_write', 'tools', 'projects'];

export function previewOverrides(data: Record<string, unknown>): OverridePreview {
  profileArgs(data); // Reject unsupported TOML keys exactly as switching does.
  const fields: OverridePreview['fields'] = [];
  for (const key of ['model', 'model_provider']) if (Object.hasOwn(data, key)) {
    fields.push({ key, value: safeMetadataValue(data[key]) ?? '值已隐藏（非安全标识）' });
  }
  for (const [key, values] of Object.entries(enumValues)) if (Object.hasOwn(data, key)) {
    fields.push({ key, value: typeof data[key] === 'string' && values.includes(data[key]) ? data[key] : '值已隐藏（未识别）' });
  }
  if (Object.hasOwn(data, 'disable_response_storage')) fields.push({ key: 'disable_response_storage', value: typeof data.disable_response_storage === 'boolean' ? String(data.disable_response_storage) : '值已隐藏（未识别）' });
  for (const key of tableKeys) if (Object.hasOwn(data, key)) fields.push({ key, value: '已设置；内容不显示' });
  return { fields, omitted: Object.keys(data).length - fields.length };
}
