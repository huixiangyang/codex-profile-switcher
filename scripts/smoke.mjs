// 临时配置 + 两个独立宿主 + 真实 app-server；不改用户配置，不创建对话或发送模型请求。
import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const extensions = path.join(os.homedir(), '.vscode/extensions');
const entries = JSON.parse(await fs.readFile(path.join(extensions, 'extensions.json'), 'utf8'));
const codex = entries.find(x => x.identifier.id === 'openai.chatgpt');
if (!codex) throw new Error('未安装本机 Codex 扩展。');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-profiles-smoke-'));
const hosts = [];
try {
  await build({ entryPoints: { launcher: 'src/launcher.ts', host: 'test/window-host.ts' }, outdir: temporary, outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs' });
  const { createLauncher, binaryRelativePath } = createRequire(import.meta.url)(path.join(temporary, 'launcher.cjs'));
  const installedArch = codex.relativeLocation.endsWith('-arm64') ? 'arm64'
    : codex.relativeLocation.endsWith('-x64') ? 'x64' : process.arch;
  const binary = path.join(extensions, codex.relativeLocation, binaryRelativePath(process.platform, installedArch));
  const runtime = process.env.CODEX_SWITCHER_SMOKE_NODE || (process.platform === 'darwin' ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code' : process.execPath);
  const home = path.join(temporary, 'home'); const storage = path.join(temporary, 'storage');
  await fs.mkdir(home);
  await fs.writeFile(path.join(home, 'config.toml'), `model = "smoke-default"
model_reasoning_effort = "medium"
[model_providers.window_a]
name = "Smoke A"
base_url = "https://example.invalid/v1"
wire_api = "responses"
[model_providers.window_b]
name = "Smoke B"
base_url = "https://example.invalid/v1"
wire_api = "responses"
`);
  await fs.writeFile(path.join(home, 'alpha.config.toml'), 'model_provider = "window_a"\nmodel = "smoke-a"\nmodel_reasoning_effort = "high"\n');
  await fs.writeFile(path.join(home, 'beta.config.toml'), 'model_provider = "window_b"\nmodel = "smoke-b"\nmodel_reasoning_effort = "low"\n');
  await createLauncher(storage, path.resolve('dist/bridge.cjs'), runtime);

  const start = async profile => {
    const child = spawn(runtime, [path.join(temporary, 'host.cjs'), storage, JSON.stringify({ version: 2, profile, codexHome: home, binary })], {
      stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', RUST_LOG: 'error' }
    });
    const pending = new Map(); let id = 0; let stderr = '';
    const reader = createInterface({ input: child.stdout });
    reader.on('line', line => { const message = JSON.parse(line); pending.get(message.id)?.(message); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-6000); });
    const fail = () => { for (const callback of pending.values()) callback({ error: true }); };
    child.on('error', fail); child.on('exit', fail); child.stdin.on('error', fail);
    const request = (method, params) => new Promise((resolve, reject) => {
      if (child.exitCode !== null || child.signalCode !== null) { reject(new Error('app-server 已退出')); return; }
      const requestId = ++id;
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} 超时；stderr: ${stderr}`)); }, 20000);
      pending.set(requestId, response => { clearTimeout(timer); pending.delete(requestId); response.error ? reject(new Error(`${method} 失败，宿主退出码 ${child.exitCode}；stderr: ${stderr}`)) : resolve(response.result); });
      child.stdin.write(JSON.stringify({ id: requestId, method, params }) + '\n');
    });
    const stop = async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        try { await exited; } finally { clearTimeout(timer); }
      }
      reader.close();
    };
    hosts.push({ stop });
    await request('initialize', { clientInfo: { name: 'codex-profiles-smoke', version: '0.2.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const config = async () => {
      const result = await request('config/read', { includeLayers: false });
      return Object.fromEntries(['model_provider', 'model', 'model_reasoning_effort'].map(key => [key, result.config[key]]));
    };
    return { stop, config };
  };
  // 官方后端首次并行初始化同一空目录时存在 SQLite 竞争；先建立共享状态，再验证窗口隔离。
  const baseline = await start(null);
  const expectedDefault = { model_provider: null, model: 'smoke-default', model_reasoning_effort: 'medium' };
  assert.deepEqual(await baseline.config(), expectedDefault);
  await baseline.stop();
  const [a, b] = await Promise.all([start('alpha'), start('beta')]);
  assert.deepEqual(await a.config(), { model_provider: 'window_a', model: 'smoke-a', model_reasoning_effort: 'high' });
  const expectedB = { model_provider: 'window_b', model: 'smoke-b', model_reasoning_effort: 'low' };
  assert.deepEqual(await b.config(), expectedB);
  await a.stop();
  const defaultA = await start(null);
  assert.deepEqual(await defaultA.config(), expectedDefault);
  assert.deepEqual(await b.config(), expectedB);
  console.log(JSON.stringify({ independentWindows: true, defaultResetIsolated: true, officialExtension: codex.relativeLocation }));
} finally {
  await Promise.allSettled(hosts.map(host => host.stop()));
  await fs.rm(temporary, { recursive: true, force: true });
}
