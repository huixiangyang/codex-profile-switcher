// 隔离真实后端：固定响应触发运行、批准、用户输入；不调用模型或使用个人凭据。
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const root = await fs.realpath(await fs.mkdtemp('/tmp/clive-'));
await build({ entryPoints: { channel: 'src/live/channel.ts', launcher: 'src/launcher.ts', window: 'src/window.ts' }, bundle: true, platform: 'node', format: 'cjs', outdir: root, outExtension: { '.js': '.cjs' } });
const require = createRequire(import.meta.url);
const { LiveSessions } = require(path.join(root, 'channel.cjs'));
const { createLauncher } = require(path.join(root, 'launcher.cjs'));
const { serveWindow } = require(path.join(root, 'window.cjs'));
const inventory = JSON.parse(await fs.readFile(path.join(os.homedir(), '.vscode/extensions/extensions.json'), 'utf8'));
const installed = inventory.find(item => item.identifier.id === 'openai.chatgpt');
assert.ok(installed.relativeLocation.includes('26.51021.22027'));
const binary = path.join(os.homedir(), '.vscode/extensions', installed.relativeLocation, 'bin/macos-aarch64/codex');
let mode = 'hold', call = 0, release;
const toolsSeen = new Set();
const responder = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  for (const tool of request.tools ?? []) toolsSeen.add(tool.name ?? tool.type);
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const id = 'resp_' + (++call), callId = 'call_' + call;
  const event = (type, fields) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
  event('response.created', { response: { id, object: 'response', status: 'in_progress', output: [] } });
  const finish = () => {
    let item;
    if (mode === 'approval' || mode === 'input') {
      const approval = mode === 'approval'; mode = 'complete';
      item = { id: 'fc_' + call, type: 'function_call', call_id: callId, name: approval ? 'exec_command' : 'request_user_input', arguments: JSON.stringify(approval
        ? { cmd: 'pwd', sandbox_permissions: 'require_escalated', justification: '仅供隔离测试批准流程，不执行命令。' }
        : { questions: [{ id: 'choice', header: '验收', question: '选择验收路径？', options: [{ label: 'A', description: '路径 A' }, { label: 'B', description: '路径 B' }] }] }) };
    } else item = { id: 'msg_' + call, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '隔离验收结束。', annotations: [] }] };
    event('response.output_item.added', { output_index: 0, item });
    event('response.output_item.done', { output_index: 0, item });
    event('response.completed', { response: { id, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
    res.end();
  };
  if (mode === 'hold') release = finish; else finish();
});
await new Promise(resolve => responder.listen(0, '127.0.0.1', resolve));
const home = path.join(root, 'home'), storage = path.join(root, 'storage');
await fs.mkdir(home);
await fs.writeFile(path.join(home, 'config.toml'), `model_provider="probe"\nmodel="probe-model"\n[model_providers.probe]\nname="Probe"\nbase_url="http://127.0.0.1:${responder.address().port}/v1"\nwire_api="responses"\n`);
const live = new LiveSessions(), states = [];
live.subscribe(() => { for (const entry of live.entries.values()) if (states.at(-1)?.state !== entry.state) states.push({ ...entry }); });
const socket = await live.start(storage);
const stop = await serveWindow(storage, { version: 2, profile: null, codexHome: home, binary, liveSocket: socket });
const launcher = await createLauncher(storage, path.resolve('dist/bridge.cjs'), process.execPath, path.resolve('dist/observer.cjs'));
const child = spawn(launcher, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.resume();
const pending = new Map(), requests = [], completed = new Set();
let next = 0;
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  const message = JSON.parse(line);
  if (message.id !== undefined && message.method) requests.push(message);
  else pending.get(message.id)?.(message);
  if (message.method === 'turn/completed') completed.add(message.params.turn.id);
});
const send = message => child.stdin.write(JSON.stringify(message) + '\n');
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timeout')); }, 15000);
  pending.set(id, m => { clearTimeout(timer); pending.delete(id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }); send({ id, method, params });
});
const waitFor = async (check, label) => { const end = Date.now() + 20000; while (!check()) { if (Date.now() > end) throw new Error(label + ' timeout; states=' + JSON.stringify(states) + '; tools=' + JSON.stringify([...toolsSeen]) + '; requests=' + requests.map(r => r.method).join(',')); await new Promise(resolve => setTimeout(resolve, 30)); } };
try {
  await rpc('initialize', { clientInfo: { name: 'live-verification', version: '0.6.0' }, capabilities: { experimentalApi: true } }); send({ method: 'initialized' });
  const { thread } = await rpc('thread/start', { cwd: root, approvalPolicy: 'on-request', sandbox: 'read-only' });
  const start = (extra = {}) => rpc('turn/start', { ...extra, threadId: thread.id, input: [{ type: 'text', text: '只进行隔离验收。' }] });
  const first = await start();
  await waitFor(() => live.entries.get(thread.id)?.state === 'running' && release, 'running');
  await waitFor(() => live.turnState(thread.id, first.turn.id) === 'running', 'running turn ID');
  mode = 'complete'; release();
  await waitFor(() => completed.has(first.turn.id) && live.entries.get(thread.id)?.state === 'idle', 'idle');
  assert.equal(live.turnState(thread.id, first.turn.id), undefined);
  mode = 'approval'; const second = await start();
  await waitFor(() => requests.some(r => r.method === 'item/commandExecution/requestApproval') && live.entries.get(thread.id)?.state === 'approval', 'approval');
  assert.equal(live.turnState(thread.id, second.turn.id), 'approval');
  const approval = requests.find(r => r.method === 'item/commandExecution/requestApproval');
  send({ id: approval.id, result: { decision: 'decline' } });
  await waitFor(() => completed.has(second.turn.id) && live.entries.get(thread.id)?.state === 'idle', 'approval resolved');
  mode = 'input'; const third = await start({ collaborationMode: { mode: 'plan', settings: { model: 'probe-model', reasoning_effort: 'medium', developer_instructions: null } } });
  await waitFor(() => requests.some(r => r.method === 'item/tool/requestUserInput') && live.entries.get(thread.id)?.state === 'input', 'input');
  assert.equal(live.turnState(thread.id, third.turn.id), 'input');
  const input = requests.find(r => r.method === 'item/tool/requestUserInput');
  send({ id: input.id, result: { answers: { choice: { answers: ['A'] } } } });
  await waitFor(() => completed.has(third.turn.id) && live.entries.get(thread.id)?.state === 'idle', 'input resolved');
  const report = { root, officialExtension: installed.relativeLocation, running: true, approval: true, input: true, currentTurnBinding:true, resolvedToIdle: true, states };
  await fs.writeFile('artifacts/live-verification.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  release?.(); child.kill('SIGTERM'); lines.close(); await stop(); await live.dispose();
  responder.closeAllConnections(); await new Promise(resolve => responder.close(resolve));
}
