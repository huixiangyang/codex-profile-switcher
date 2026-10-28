import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { observe as observeEvent } from '../src/live/events';
import { LiveSessions } from '../src/live/channel';
import { createLauncher } from '../src/launcher';
import { serveWindow } from '../src/window';
const observe = (line: string) => { const event = observeEvent(line); return event?.type === 'status' ? event : undefined; };
const notification = (type: string, flags: string[] = []) => JSON.stringify({ method: 'thread/status/changed', params: { threadId: 'fixture', status: { type, activeFlags: flags } } }) + '\n';
const waitFor = async (check: () => boolean) => {
  const until = Date.now() + 5000;
  while (!check()) { if (Date.now() > until) throw new Error('监听状态超时'); await new Promise(resolve => setTimeout(resolve, 20)); }
};

test('只按已核验的后端状态判定运行、批准、输入；未知状态与卸载清除观测', () => {
  for (const [flags, expected] of [[[], 'running'], [['waitingOnApproval'], 'approval'], [['waitingOnUserInput'], 'input'], [['waitingOnApproval', 'waitingOnUserInput'], 'approvalInput']] as const)
    assert.equal(observe(notification('active', [...flags]))?.state, expected);
  assert.equal(observe(notification('idle'))?.state, 'idle');
  assert.equal(observe(notification('systemError'))?.state, 'error');
  assert.equal(observe(notification('notLoaded'))?.state, null);
  assert.equal(observe(notification('active', ['new-unknown-flag']))?.state, null);
  assert.equal(observe('{"method":"thread/closed","params":{"threadId":"fixture"}}')?.state, null);
  assert.equal(observe('{"method":"item/tool/requestUserInput","params":{"isBlocking":false,"questions":["PRIVATE"]}}'), undefined);
  assert.equal(observe('{"id":1,"result":{"content":"PRIVATE"}}'), undefined);
});

test('真实桥接字节透明、没有注入或代答；旁路断开后官方流仍可继续', { timeout: 15000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'live-bridge-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const storage = path.join(root, 'storage'), received = path.join(root, 'received');
  const live = new LiveSessions();
  const socket = await live.start(storage);
  t.after(() => live.dispose());
  const binary = path.join(root, 'codex');
  await fs.writeFile(binary, `#!${process.execPath}\nconst fs=require('fs');process.stdin.on('data',b=>{fs.appendFileSync(${JSON.stringify(received)},b);process.stdout.write(b)});process.on('SIGTERM',()=>process.exit(42));\n`, { mode: 0o700 });
  const stop = await serveWindow(storage, { version: 2, profile: null, codexHome: root, binary, liveSocket: socket });
  t.after(stop);
  const executable = await createLauncher(storage, path.resolve('dist/bridge.cjs'), process.execPath, path.resolve('dist/observer.cjs'));
  const child = spawn(executable, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const output: Buffer[] = [], sent: Buffer[] = []; let size = 0, errors = '';
  child.stdout.on('data', bytes => { output.push(bytes); size += bytes.length; });
  child.stderr.on('data', bytes => { errors += bytes.toString(); });
  const send = (value: string) => { const bytes = Buffer.from(value); sent.push(bytes); child.stdin.write(bytes); };
  await waitFor(() => live.connected);
  for (const [flags, expected] of [[[], 'running'], [['waitingOnApproval'], 'approval'], [['waitingOnUserInput'], 'input'], [[], 'running']] as const) {
    send(notification('active', [...flags]));
    await waitFor(() => live.entries.get('fixture')?.state === expected);
  }
  send('{"method":"item/commandExecution/requestApproval","id":9,"params":{"command":"PRIVATE"}}\n');
  send('{"id":9,"result":{"decision":"decline"}}\n');
  send(JSON.stringify({ id: 5, result: { content: '正文'.repeat(600000) } }) + '\n');
  send(notification('idle'));
  await waitFor(() => size === sent.reduce((sum, bytes) => sum + bytes.length, 0));
  assert.ok(!JSON.stringify([...live.entries]).includes('PRIVATE'));
  await live.dispose();
  send('{"id":10,"result":"旁路断开后仍可输出"}\n');
  await waitFor(() => size === sent.reduce((sum, bytes) => sum + bytes.length, 0));
  assert.deepEqual(Buffer.concat(output), Buffer.concat(sent));
  assert.deepEqual(await fs.readFile(received), Buffer.concat(sent));
  const exited = once(child, 'exit'); child.kill('SIGTERM');
  assert.equal((await exited)[0], 42); assert.equal(errors, '');
  // spawn 失败也要收掉 Worker，不能让启动器因旁路存活而挂住。
  await stop();
  await fs.writeFile(binary, '#!/nonexistent/codex-live-test-runtime\n', { mode: 0o700 });
  const stopFailed = await serveWindow(storage, { version: 2, profile: null, codexHome: root, binary, liveSocket: socket });
  t.after(stopFailed);
  const failed = spawn(executable, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (failed.exitCode === null) failed.kill('SIGKILL'); });
  failed.stdout.resume(); failed.stderr.resume();
  assert.equal((await once(failed, 'exit'))[0], 1);
});
