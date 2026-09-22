import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, TomlDate } from 'smol-toml';

export interface Profile {
  name: string;
  file: string;
  provider?: string;
  model?: string;
  error?: string;
}

export function resolveHome(setting = '', envHome = process.env.CODEX_HOME): string {
  const value = setting.trim() || envHome || path.join(os.homedir(), '.codex');
  const expanded = value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
  if (!path.isAbsolute(expanded)) throw new Error('Codex 配置目录必须是绝对路径。');
  return path.normalize(expanded);
}

export function profilePath(home: string, name: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('Profile 名称只能包含字母、数字、短横线和下划线。');
  return path.join(home, `${name}.config.toml`);
}

export async function readProfile(home: string, name: string): Promise<Record<string, unknown>> {
  try {
    return parse(await fs.readFile(profilePath(home, name), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`找不到 profile：${name}`);
    // 解析器错误可能包含原始行，避免将密钥或配置内容写入通知和日志。
    throw new Error(`无法读取 profile「${name}」，请检查文件权限和 TOML 格式。`);
  }
}

export async function listProfiles(home: string): Promise<Profile[]> {
  let entries: string[];
  try { entries = await fs.readdir(home); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error('无法读取 Codex 配置目录，请检查路径和访问权限。');
  }
  return Promise.all(entries.filter(x => /^[A-Za-z0-9_-]+\.config\.toml$/.test(x)).sort().map(async entry => {
    const name = entry.slice(0, -'.config.toml'.length);
    const result: Profile = { name, file: profilePath(home, name) };
    try {
      const data = await readProfile(home, name);
      result.provider = typeof data.model_provider === 'string' ? data.model_provider : undefined;
      result.model = typeof data.model === 'string' ? data.model : undefined;
    } catch (error) { result.error = (error as Error).message; }
    return result;
  }));
}

export function tomlValue(value: unknown): string {
  if (value instanceof TomlDate) return value.toISOString();
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint' || typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'nan';
    if (value === Infinity) return 'inf';
    if (value === -Infinity) return '-inf';
    return Object.is(value, -0) ? '-0.0' : String(value);
  }
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{ ${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)} = ${tomlValue(v)}`).join(', ')} }`;
  }
  throw new Error('Profile 包含无法转换的 TOML 值。');
}

export function profileArgs(profile: Record<string, unknown>): string[] {
  return Object.entries(profile).flatMap(([key, value]) => {
    // Codex 的 -c 使用点路径；顶层必须是合法配置项，嵌套表由 TOML 序列化保留。
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error('Profile 顶层配置项不支持点号或特殊字符。');
    return ['-c', `${key}=${tomlValue(value)}`];
  });
}
