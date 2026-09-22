import { spawn } from 'node:child_process';
import os from 'node:os';
import { readProfile, profileArgs } from './profiles';
import { resolveBinary } from './launcher';
import { readWindowSpec } from './window';

async function main(): Promise<void> {
  const spec = await readWindowSpec(process.argv[2]);
  const args = spec.profile === null ? [] : profileArgs(await readProfile(spec.codexHome, spec.profile));
  const binary = await resolveBinary(spec);
  const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: spec.codexHome };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(binary, [...args, ...process.argv.slice(3)], {
    stdio: 'inherit', env
  });
  // 透传退出信号和标准流，确保窗口重载能结束后端，且 JSON-RPC 不混入日志。
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, () => child.kill(signal));
  child.on('error', () => { process.stderr.write('Codex Profiles：无法启动 Codex 内置程序。\n'); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (128 + (signal ? os.constants.signals[signal] : 1)); });
}

main().catch(error => {
  // 只输出受控业务错误，不输出 profile、完整参数或解析器的原始错误行。
  const message = error instanceof Error && /^(找不到|无法读取 profile|Profile |窗口|启动配置|当前版本)/.test(error.message)
    ? error.message : '启动配置读取失败，请重新选择 profile。';
  process.stderr.write(`Codex Profiles：${message}\n`);
  process.exitCode = 1;
});
