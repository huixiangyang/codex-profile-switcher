import { spawn } from 'node:child_process';
import os from 'node:os';
import { observeOutput } from './live/tap';
import { readProfile, profileArgs } from './profiles';
import { resolveBinary } from './launcher';
import { readWindowSpec } from './window';

async function main(): Promise<void> {
  const spec = await readWindowSpec(process.argv[2]);
  const args = spec.profile === null ? [] : profileArgs(await readProfile(spec.codexHome, spec.profile));
  const binary = await resolveBinary(spec);
  const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: spec.codexHome };
  delete env.ELECTRON_RUN_AS_NODE;
  const live = spec.liveSocket && process.argv.slice(3).includes('app-server') ? spec.liveSocket : undefined;
  const child = spawn(binary, [...args, ...process.argv.slice(3)], {
    stdio: live ? ['pipe', 'pipe', 'inherit'] : 'inherit', env
  });
  let stopObservation: (() => void) | undefined;
  if (live) {
    // 双向原始字节透传，pipe 保留背压；不按 JSON 重组、不注入请求、不代答批准。
    process.stdin.pipe(child.stdin!); child.stdout!.pipe(process.stdout);
    child.stdin!.on('error', () => process.stdin.unpipe(child.stdin!));
    process.stdout.on('error', () => child.kill('SIGTERM'));
    stopObservation = observeOutput(child.stdout!, live);
  }
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, () => child.kill(signal));
  const cleanup = () => { stopObservation?.(); process.stdin.unpipe(); process.stdin.pause(); };
  child.on('error', () => { cleanup(); process.stderr.write('Codex Profiles：无法启动 Codex 内置程序。\n'); process.exitCode = 1; });
  child.on('exit', (code, signal) => { cleanup(); process.exitCode = code ?? (128 + (signal ? os.constants.signals[signal] : 1)); });
}

main().catch(error => {
  // 只输出受控业务错误，不输出 profile、完整参数或解析器的原始错误行。
  const message = error instanceof Error && /^(找不到|无法读取 profile|Profile |窗口|启动配置|当前版本)/.test(error.message)
    ? error.message : '启动配置读取失败，请重新选择 profile。';
  process.stderr.write(`Codex Profiles：${message}\n`);
  process.exitCode = 1;
});
