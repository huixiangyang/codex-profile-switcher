import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codexRepair, repairCodex, replaceExactly, sha256, RepairSpec } from '../src/repair';

const release = codexRepair.files[0].replacements[0];
const [schedule, execute] = codexRepair.files[1].replacements;
// 将实际匹配片段放入可执行的最小环境，验证改动后的分支语义。
const sources = [
  `function handlers(){return{${release.before}}}`,
  `class Queue{constructor(context){Object.assign(this,context)}#s(){return{id:'message'}}scheduled(e){return !(${schedule.before})}run(e,t,n){${execute.before}false)return false;return true;}}`
];
const fixtureSpec: RepairSpec = {
  version: codexRepair.version,
  files: codexRepair.files.map((file, i) => ({ ...file, sha256: sha256(sources[i]) }))
};

test('释放锁响应可解析；未知或跟随窗口不自动发送，所属窗口与主动发送保留', async () => {
  let releases = 0;
  const owner = { queuedFollowUpSendLocks: { release() { releases++; } } };
  const original = new Function(`${sources[0]};return handlers.call(this)`).call(owner);
  const result = await original['queued-follow-up-send-lock-release']({});
  assert.throws(() => JSON.parse(JSON.stringify(result)), SyntaxError);
  const fixed = replaceExactly(sources[0], [release]);
  const repaired = new Function(`${fixed};return handlers.call(this)`).call(owner);
  const response = JSON.parse(JSON.stringify({ bodyJsonString: JSON.stringify(await repaired['queued-follow-up-send-lock-release']({})) }));
  assert.deepEqual(JSON.parse(response.bodyJsonString), { success: true });
  assert.equal(releases, 2);

  const Queue = new Function(`${replaceExactly(sources[1], [schedule, execute])};return Queue`)();
  for (const role of [undefined, 'follower', 'owner']) {
    const queue = new Queue({
      execution: {}, pending: new Set(), automaticTurnDeferrals: new Set(),
      accepted: new Map(),
      options: { getStreamRole: () => role ? { role } : undefined }
    });
    assert.equal(queue.scheduled('thread'), role === 'owner');
    // 即使上游允许自动获取所有权，也不能从未知窗口抢占。
    assert.equal(queue.run('thread', { canAcquireOwnership: () => true }), role === 'owner');
    assert.equal(queue.run('thread', {}, { messageId: 'explicit' }), true);
    queue.accepted.set('thread', new Map([['message', {}]]));
    assert.equal(queue.scheduled('thread'), role !== 'follower', '普通发送只由接收消息的窗口发起');
    assert.equal(queue.run('thread', { canAcquireOwnership: () => true }), true);
    assert.equal(queue.run('thread', { canAcquireOwnership: () => false }), role === 'owner');
    queue.accepted.set('thread', new Map([['different-message', {}]]));
    assert.equal(queue.run('thread', { canAcquireOwnership: () => true }), role === 'owner', '不能用后面的本地消息冒领共享队列头');
  }
});

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-repair-'));
  const root = path.join(directory, 'extension'); const storage = path.join(directory, 'storage');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ publisher: 'openai', name: 'chatgpt', version: codexRepair.version }));
  for (const [i, file] of fixtureSpec.files.entries()) {
    await fs.mkdir(path.dirname(path.join(root, file.file)), { recursive: true });
    await fs.writeFile(path.join(root, file.file), sources[i], { mode: 0o644 });
  }
  return { directory, root, storage };
}

test('修复与还原幂等；可信备份可恢复写到一半的状态，保留文件权限', async t => {
  const { directory, root, storage } = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const applied = await repairCodex(root, storage, false, fixtureSpec);
  assert.ok(applied.changed);
  assert.equal((await repairCodex(root, storage, false, fixtureSpec)).changed, false);
  for (const [i, file] of fixtureSpec.files.entries()) {
    assert.equal(await fs.readFile(path.join(applied.backup, path.basename(file.file)), 'utf8'), sources[i]);
    assert.equal((await fs.stat(path.join(root, file.file))).mode & 0o777, 0o644);
  }
  // 模拟进程在两个文件之间退出；重新运行只完成缺失的写入。
  await fs.writeFile(path.join(root, fixtureSpec.files[1].file), sources[1]);
  assert.ok((await repairCodex(root, storage, false, fixtureSpec)).changed);
  assert.ok((await repairCodex(root, storage, true, fixtureSpec)).changed);
  assert.equal((await repairCodex(root, storage, true, fixtureSpec)).changed, false);
  for (const [i, file] of fixtureSpec.files.entries()) assert.equal(await fs.readFile(path.join(root, file.file), 'utf8'), sources[i]);

  const rename = fs.rename;
  const failingTarget = path.join(await fs.realpath(root), fixtureSpec.files[1].file);
  fs.rename = async (from, to) => {
    if (to === failingTarget) throw new Error('模拟第二个文件写入失败');
    await rename(from, to);
  };
  try { await assert.rejects(repairCodex(root, storage, false, fixtureSpec), /模拟第二个文件/); }
  finally { fs.rename = rename; }
  for (const [i, file] of fixtureSpec.files.entries()) assert.equal(await fs.readFile(path.join(root, file.file), 'utf8'), sources[i], '写入失败后应恢复整套原文件');

  const parallel = await Promise.allSettled([
    repairCodex(root, storage, false, fixtureSpec), repairCodex(root, storage, false, fixtureSpec)
  ]);
  assert.equal(parallel.filter(result => result.status === 'fulfilled').length, 1);
  const blocked = parallel.find(result => result.status === 'rejected');
  assert.ok(blocked?.status === 'rejected' && /互斥端口/.test(blocked.reason.message));
  await repairCodex(root, storage, true, fixtureSpec);
});

test('未知版本、文件漂移或坏备份拒绝写入；预检失败不留下半套补丁', async t => {
  const { directory, root, storage } = await fixture();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ publisher: 'openai', name: 'chatgpt', version: 'new-version' }));
  await assert.rejects(repairCodex(root, storage, false, fixtureSpec), /不受支持/);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ publisher: 'openai', name: 'chatgpt', version: codexRepair.version }));
  await fs.appendFile(path.join(root, fixtureSpec.files[1].file), '// external change');
  await assert.rejects(repairCodex(root, storage, false, fixtureSpec), /校验失败/);
  assert.equal(await fs.readFile(path.join(root, fixtureSpec.files[0].file), 'utf8'), sources[0]);
  await fs.writeFile(path.join(root, fixtureSpec.files[1].file), sources[1]);
  const applied = await repairCodex(root, storage, false, fixtureSpec);
  await fs.writeFile(path.join(applied.backup, path.basename(fixtureSpec.files[1].file)), 'invalid backup');
  await assert.rejects(repairCodex(root, storage, true, fixtureSpec), /备份校验失败/);
  assert.equal(await fs.readFile(path.join(root, fixtureSpec.files[0].file), 'utf8'), replaceExactly(sources[0], [release]));
});
