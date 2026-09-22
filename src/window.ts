import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createConnection, createServer, Socket } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { LaunchSpec } from './launcher';

function socketPath(storage: string, hostPid: number): string {
  // macOS 的 Unix socket 路径上限较短，使用固定短路径；哈希区分用户及 VS Code 数据目录。
  const id = createHash('sha256').update(storage).digest('hex').slice(0, 24);
  return path.join('/tmp', `codex-profiles-${id}`, `${hostPid}.sock`);
}

export async function serveWindow(storage: string, spec: LaunchSpec): Promise<() => Promise<void>> {
  const socket = socketPath(storage, process.pid);
  await fs.mkdir(path.dirname(socket), { recursive: true, mode: 0o700 });
  // 同一扩展宿主只注册一次；崩溃留下的 socket 无法接受连接，启动前移除。
  await fs.rm(socket, { force: true });
  const clients = new Set<Socket>();
  const server = createServer(client => {
    clients.add(client);
    client.on('error', () => client.destroy());
    client.on('close', () => clients.delete(client));
    client.setTimeout(2000, () => client.destroy());
    client.end(JSON.stringify(spec));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socket, () => { server.removeListener('error', reject); resolve(); });
  });
  server.on('error', () => { /* 新连接失败由 bridge 报告，不向协议流写日志。 */ });
  return async () => {
    for (const client of clients) client.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(socket, { force: true });
  };
}

function receiveSpec(socket: string, timeout: number): Promise<LaunchSpec> {
  return new Promise((resolve, reject) => {
    const client = createConnection(socket);
    let content = '';
    client.setEncoding('utf8');
    client.setTimeout(timeout, () => client.destroy(new Error('窗口配置读取超时。')));
    client.on('data', chunk => {
      content += chunk;
      if (content.length > 65536) client.destroy(new Error('窗口启动配置无效。'));
    });
    client.on('error', reject);
    client.on('end', () => {
      try {
        const spec = JSON.parse(content) as LaunchSpec;
        if (spec.version !== 2 || !(spec.profile === null || typeof spec.profile === 'string' && /^[A-Za-z0-9_-]+$/.test(spec.profile))
          || typeof spec.codexHome !== 'string' || !path.isAbsolute(spec.codexHome)
          || typeof spec.binary !== 'string' || !path.isAbsolute(spec.binary)) throw new Error();
        resolve(spec);
      } catch { reject(new Error('窗口启动配置无效，请重新加载窗口。')); }
    });
  });
}

export async function readWindowSpec(storage: string, hostPid = process.ppid, timeout = 15000): Promise<LaunchSpec> {
  const deadline = Date.now() + timeout;
  // Codex 作为依赖先启动；等待本窗口的切换器激活，不借用其他窗口或全局 profile。
  do {
    try { return await receiveSpec(socketPath(storage, hostPid), Math.max(1, deadline - Date.now())); }
    catch (error) {
      if (!['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
    }
    await delay(Math.min(50, Math.max(0, deadline - Date.now())));
  } while (Date.now() < deadline);
  throw new Error('找不到所属窗口的配置服务，请启用 Codex Profile Switcher 并重新加载窗口；卸载后请移除用户设置中的 chatgpt.cliExecutable。');
}
