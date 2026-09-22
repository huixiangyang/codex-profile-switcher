import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface LaunchSpec {
  version: 2;
  profile: string | null;
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

export function launcherPath(storage: string): string {
  return path.join(storage, 'launcher.sh');
}

export async function createLauncher(storage: string, bridgeSource: string, node: string): Promise<string> {
  await fs.mkdir(storage, { recursive: true, mode: 0o700 });
  const bridge = path.join(storage, 'bridge.cjs');
  await atomicWrite(bridge, await fs.readFile(bridgeSource));
  // 入口保持固定；exec 保留父进程，bridge 据此只连接所属窗口的扩展宿主。
  const script = `#!/bin/sh\n# 由 Codex Profile Switcher 生成。\nexport ELECTRON_RUN_AS_NODE=1\nexec ${shellQuote(node)} ${shellQuote(bridge)} ${shellQuote(storage)} "$@"\n`;
  const executable = launcherPath(storage);
  await atomicWrite(executable, script, 0o700);
  return executable;
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
