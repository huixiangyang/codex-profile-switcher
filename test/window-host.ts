// 用独立进程模拟不同窗口的扩展宿主，覆盖 launcher 的真实父进程寻址。
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { serveWindow } from '../src/window';
import { launcherPath, LaunchSpec } from '../src/launcher';

async function main(): Promise<void> {
  const storage = process.argv[2];
  const spec = JSON.parse(process.argv[3]) as LaunchSpec;
  const child = spawn(launcherPath(storage), ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  process.stdin.pipe(child.stdin);
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  child.on('error', error => { process.stderr.write(`${error.message}\n`); process.exit(1); });
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  const stop = await serveWindow(storage, spec);
  const [code] = await exited;
  await stop();
  process.exit(code ?? 1);
}
void main().catch(error => { process.stderr.write(`${(error as Error).message}\n`); process.exit(1); });
