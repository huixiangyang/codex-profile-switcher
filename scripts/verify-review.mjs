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
await build({ entryPoints: { channel: 'src/live/channel.ts', launcher: 'src/launcher.ts', window: 'src/window.ts', records: 'src/sessions/records.ts' }, bundle: true, platform: 'node', format: 'cjs', outdir: root, outExtension: { '.js': '.cjs' } });
const require = createRequire(import.meta.url);
const { LocalSessionRecords } = require(path.join(root, 'records.cjs'));
const { LiveSessions } = require(path.join(root, 'channel.cjs'));
const { createLauncher } = require(path.join(root, 'launcher.cjs'));
const { serveWindow } = require(path.join(root, 'window.cjs'));
const inventory = JSON.parse(await fs.readFile(path.join(os.homedir(), '.vscode/extensions/extensions.json'), 'utf8'));
const installed = inventory.find(item => item.identifier.id === 'openai.chatgpt');
assert.ok(installed.relativeLocation.includes('26.51021.22027'));
const binary = path.join(os.homedir(), '.vscode/extensions', installed.relativeLocation, 'bin/macos-aarch64/codex');
let mode = 'patch', call = 0, release;
await fs.writeFile(path.join(root,'edit.txt'),'old\n');
await fs.writeFile(path.join(root,'delete.txt'),'removed\n');
const patch = '*** Begin Patch\n*** Add File: added.txt\n+created\n*** Update File: edit.txt\n@@\n-old\n+updated\n*** Delete File: delete.txt\n*** End Patch';
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
    if (mode === 'patch') {
      mode = 'complete';
      item = { id: 'fc_' + call, type: 'function_call', call_id: callId, name: 'exec_command', arguments: JSON.stringify({cmd: "apply_patch <<'PATCH'\n" + patch + '\nPATCH', max_output_tokens: 1000}) };
    } else if (mode === 'approval' || mode === 'input') {
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
const pending = new Map(), requests = [], completed = new Set(), events = [];
let next = 0;
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  const message = JSON.parse(line);
  if (['turn/started','turn/completed','turn/diff/updated','item/completed'].includes(message.method)) events.push(message);
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
  await rpc('initialize', { clientInfo: { name: 'review-verification', version: '0.7.0' }, capabilities: { experimentalApi: true } }); send({ method: 'initialized' });
  const { thread } = await rpc('thread/start', { cwd: root, approvalPolicy: 'never', sandbox: 'workspace-write' });
  const {turn} = await rpc('turn/start', { threadId: thread.id, input: [{type:'text',text:'仅在此隔离目录执行预置补丁。'}] });
  await waitFor(() => completed.has(turn.id), 'patch complete');
  assert.equal(await fs.readFile(path.join(root,'edit.txt'),'utf8'),'updated\n');
  assert.equal(await fs.readFile(path.join(root,'added.txt'),'utf8'),'created\n');
  await assert.rejects(fs.stat(path.join(root,'delete.txt')));
  const files=await fs.readdir(path.join(home,'sessions'),{recursive:true});
  const file=path.join(home,'sessions',files.find(f=>f.endsWith('.jsonl')));
  const records=(await fs.readFile(file,'utf8')).trim().split('\n').map(JSON.parse);
  await waitFor(()=>live.turns.get(thread.id)?.get(turn.id)?.outcome==='completed', 'observed terminal');
  const store = new LocalSessionRecords(home); const catalog = await store.list([root]);
  const recorded = catalog.sessions[0].turns.find(t=>t.id===turn.id);
  const observed = live.turns.get(thread.id).get(turn.id);
  assert.equal(recorded.items.length,1);
  assert.equal(recorded.items[0].fingerprint,observed.items[0].fingerprint);
  assert.equal((await store.patches(thread.id,turn.id))[0].patches.length,3); store.dispose();
  const report={officialExtension:installed.relativeLocation,readOnlyRecovery:true,liveAndRecordedEvidenceMatch:true,root,threadId:thread.id,turnId:turn.id,rollout:file,events,records:records.filter(r=>r.type==='event_msg'&&/patch|diff|task/.test(r.payload.type))};
  await fs.writeFile('artifacts/review-probe.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({root,readOnlyRecovery:true,liveAndRecordedEvidenceMatch:true,files:recorded.items[0].files}));
} finally {
  release?.(); child.kill('SIGTERM'); lines.close(); await stop(); await live.dispose();
  responder.closeAllConnections(); await new Promise(resolve => responder.close(resolve));
}
