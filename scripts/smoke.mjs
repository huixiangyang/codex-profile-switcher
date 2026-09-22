// 只验证本机真实 app-server 的配置，不创建对话，不发送模型请求或改写 VS Code 设置。
import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { parse } from 'smol-toml';

const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const profiles = process.argv.slice(2);
if (!profiles.length || profiles.some(name => !/^[A-Za-z0-9_-]+$/.test(name))) {
  console.error('用法：node scripts/smoke.mjs <profile> [另一个 profile]');
  process.exit(2);
}
const extensions = path.join(os.homedir(), '.vscode/extensions');
const entries = JSON.parse(await fs.readFile(path.join(extensions, 'extensions.json'), 'utf8'));
const codex = entries.find(x => x.identifier.id === 'openai.chatgpt');
if (!codex) throw new Error('未安装本机 Codex 扩展。');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-profiles-smoke-'));
try {
  const moduleFile = path.join(temporary, 'launcher.cjs');
  await build({ entryPoints: ['src/launcher.ts'], outfile: moduleFile, bundle: true, platform: 'node', format: 'cjs' });
  const { createLauncher, binaryRelativePath } = createRequire(import.meta.url)(moduleFile);
  // 终端 Node 可能运行在 Rosetta 下，按已安装扩展的平台选择二进制。
  const installedArch = codex.relativeLocation.endsWith('-arm64') ? 'arm64'
    : codex.relativeLocation.endsWith('-x64') ? 'x64' : process.arch;
  const binary = path.join(extensions, codex.relativeLocation, binaryRelativePath(process.platform, installedArch));
  const runtime = process.env.CODEX_SWITCHER_SMOKE_NODE || (process.platform === 'darwin' ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code' : process.execPath);
  for (const profile of profiles) {
    const wanted = parse(await fs.readFile(path.join(home, `${profile}.config.toml`), 'utf8'));
    const launcher = await createLauncher(path.join(temporary, profile), path.resolve('dist/bridge.cjs'), runtime, {
      version: 1, profile, codexHome: home, binary
    });
    const child = spawn(launcher, ['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled'], {
      stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, RUST_LOG: 'error' }
    });
    const pending = new Map();
    let exited = false;
    const reader = createInterface({ input: child.stdout });
    reader.on('line', line => {
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-3000); });
    child.on('exit', () => { exited = true; for (const fail of pending.values()) fail({ error: true }); });
    const send = message => child.stdin.write(JSON.stringify(message) + '\n');
    const request = (id, method, params) => new Promise((resolve, reject) => {
      if (exited) { reject(new Error('app-server 已退出')); return; }
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时，进程状态 ${child.exitCode}，stderr 字节数 ${stderr.length}`)); }, 15000);
      pending.set(id, response => { clearTimeout(timer); pending.delete(id); response.error ? reject(new Error(`${method} 失败`)) : resolve(response.result); });
      send({ id, method, params });
    });
    try {
      await request(1, 'initialize', { clientInfo: { name: 'codex-profiles-smoke', version: '0.1.0' }, capabilities: { experimentalApi: true } });
      send({ method: 'initialized', params: {} });
      const result = await request(2, 'config/read', { includeLayers: false });
      for (const key of ['model_provider', 'model', 'model_reasoning_effort']) {
        if (wanted[key] !== undefined && result.config[key] !== wanted[key]) throw new Error(`${profile} 的 ${key} 与 profile 不一致`);
      }
      console.log(JSON.stringify({ profile, initialized: true, model_provider: result.config.model_provider, model: result.config.model, model_reasoning_effort: result.config.model_reasoning_effort }));
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const stopped = once(child, 'exit');
        child.kill('SIGTERM');
        const killer = setTimeout(() => child.kill('SIGKILL'), 5000);
        await stopped;
        clearTimeout(killer);
      }
      reader.close();
    }
  }
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
