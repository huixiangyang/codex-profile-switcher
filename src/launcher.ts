import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export interface LaunchSpec {
  version: 1;
  profile: string;
  codexHome: string;
  binary: string;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export async function atomicWrite(file: string, content: string | Buffer, mode = 0o600): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, content, { mode });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}

export async function createLauncher(storage: string, bridgeSource: string, node: string, spec: LaunchSpec): Promise<string> {
  const dir = path.join(storage, 'launchers');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const id = createHash('sha256').update(`${spec.codexHome}\0${spec.profile}`).digest('hex').slice(0, 16);
  const base = path.join(dir, `${spec.profile}-${id}`);
  const bridge = path.join(storage, 'bridge.cjs');
  await atomicWrite(bridge, await fs.readFile(bridgeSource));
  await atomicWrite(`${base}.json`, JSON.stringify(spec));
  // 配置不写进 shell；启动时读取 TOML，修改 profile 后无需重新生成脚本。
  const script = `#!/bin/sh\n# 由 Codex Profile Switcher 生成。\nexport ELECTRON_RUN_AS_NODE=1\nexec ${shellQuote(node)} ${shellQuote(bridge)} ${shellQuote(`${base}.json`)} "$@"\n`;
  await atomicWrite(`${base}.sh`, script, 0o700);
  return `${base}.sh`;
}

export async function readManagedSpec(storage: string, executable: string | undefined): Promise<LaunchSpec | undefined> {
  if (!executable || path.dirname(executable) !== path.join(storage, 'launchers') || !executable.endsWith('.sh')) return undefined;
  try {
    const spec = JSON.parse(await fs.readFile(executable.slice(0, -3) + '.json', 'utf8')) as LaunchSpec;
    return spec.version === 1 && typeof spec.profile === 'string' && path.isAbsolute(spec.codexHome) ? spec : undefined;
  } catch { return undefined; }
}

export function binaryRelativePath(platform = process.platform, arch = process.arch): string {
  const system = platform === 'darwin' ? 'macos' : platform === 'linux' ? 'linux' : undefined;
  const cpu = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : undefined;
  if (!system || !cpu) throw new Error('当前版本支持本机 macOS / Linux 的 arm64 和 x64 架构。');
  return path.join('bin', `${system}-${cpu}`, 'codex');
}

export async function resolveBinary(spec: LaunchSpec, envPath = process.env.PATH || ''): Promise<string> {
  // 官方扩展把配套二进制目录追加到 PATH；优先跟随当前启动的扩展版本。
  const root = path.dirname(path.dirname(path.dirname(spec.binary)));
  const parent = path.dirname(root);
  for (const directory of envPath.split(path.delimiter).reverse()) {
    const candidate = path.join(directory, 'codex');
    const extension = path.dirname(path.dirname(directory));
    if (path.dirname(extension) !== parent || !path.basename(extension).startsWith('openai.chatgpt-')) continue;
    try { await fs.access(candidate, fs.constants.X_OK); return candidate; } catch { /* 继续检查配套路径。 */ }
  }
  try { await fs.access(spec.binary, fs.constants.X_OK); return spec.binary; }
  catch { throw new Error('找不到 Codex 内置程序，请重新选择 profile 以更新启动路径。'); }
}
