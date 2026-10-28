import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalSessionRecords } from '../src/sessions/records';
import { formatWorkingDirectory, within } from '../src/sessions/catalog';
import { durationLabel, tokenLabel, statisticsText } from '../src/sessions/statistics';

const line = (type: string, payload: object) => JSON.stringify({ timestamp: '2026-10-22T03:00:00.000Z', type, payload }) + '\n';
const event = (type: string, payload: object = {}) => line('event_msg', { type, ...payload });
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-local-records-'));
  const home = path.join(root, 'home'), workspace = path.join(root, 'workspace');
  const directory = path.join(home, 'sessions/2026/10/22');
  await fs.mkdir(directory, { recursive: true }); await fs.mkdir(workspace);
  const store = new LocalSessionRecords(home);
  t.after(async () => { store.dispose(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, home, workspace, directory, store };
}

test('Token 紧凑格式保留缺失与零，跨单位进位，不保留无意义的小数', () => {
  const cases: [number | null, string][] = [[null, '—'], [0, '0'], [999, '999'], [1000, '1K'],
    [18400, '18.4K'], [82000, '82K'], [110000, '110K'], [128400, '128K'],
    [999499, '999K'], [999500, '1M'], [1234567, '1.23M'], [1234567890, '1.23B'], [1234567890123, '1.23T']];
  for (const [value, label] of cases) assert.equal(tokenLabel(value), label);
  assert.ok(tokenLabel(Number.MAX_SAFE_INTEGER).length <= 5);
});

test('直接读取落盘统计：累计快照不重复相加，回合按 ID 去重，未结束记录不假报运行中', async t => {
  const { home, workspace, directory, store } = await fixture(t);
  const file = path.join(directory, 'rollout-a.jsonl');
  const usage = (total: number) => event('token_count', { info: { total_token_usage: {
    total_tokens: total, input_tokens: total - 40, output_tokens: 40, cached_input_tokens: 80, reasoning_output_tokens: 10
  } } });
  const source = line('session_meta', { id: 'a', cwd: workspace, model_provider: 'fixture', forked_from_id: 'parent' })
    + line('turn_context', { model: 'fixture-model', cwd: workspace })
    + event('task_started', { turn_id: 'one' }) + event('task_started', { turn_id: 'one' })
    + usage(150) + usage(200) + usage(200) + event('token_count', { info: null })
    + event('task_complete', { turn_id: 'one', duration_ms: 35 })
    + event('task_started', { turn_id: 'two' }) + event('task_complete', { turn_id: 'two', error: { message: 'fixture failure' }, duration_ms: 47 })
    + event('task_started', { turn_id: 'three' }) + event('turn_aborted', { turn_id: 'three', duration_ms: 13 })
    + event('task_started', { turn_id: 'four' })
    + line('response_item', { role: 'assistant', content: 'PRIVATE_OUTPUT_SENTINEL' });
  await fs.writeFile(file, source);
  const index = JSON.stringify({ id: 'a', thread_name: '统计验收', updated_at: '2026-10-22T03:00:00Z' }) + '\n';
  await fs.writeFile(path.join(home, 'session_index.jsonl'), index);
  const result = await store.list([workspace]); const session = result.sessions[0];
  assert.equal(session.title, '统计验收'); assert.equal(session.cwd, workspace); assert.equal(session.cwdLabel, 'workspace（根目录）');
  assert.equal(session.model, 'fixture-model'); assert.equal(session.state, 'unclosed');
  assert.equal(session.stats.tokens!.total, 200); assert.equal(session.stats.tokens!.cachedInput, 80);
  assert.equal(session.stats.tokens!.cacheWriteInput, null);
  assert.deepEqual(session.stats.counts, { total: 4, completed: 1, failed: 1, interrupted: 1, unresolved: 1 });
  assert.equal(session.stats.recordedDurationMs, 95); assert.equal(session.stats.lastDurationMs, null);
  assert.equal(session.stats.inherited, true); assert.ok(!JSON.stringify(result).includes('PRIVATE_OUTPUT_SENTINEL'));
  assert.match(statisticsText(session.stats), /3 轮有耗时记录/);
  // 读取不改动原始 JSONL 或索引，既不连接后端，也不依赖它正在运行。
  assert.equal(await fs.readFile(file, 'utf8'), source);
  assert.equal(await fs.readFile(path.join(home, 'session_index.jsonl'), 'utf8'), index);
});

test('增量读取处理半行、UTF-8、重写、改名与归档；缺失 Token 和耗时显示未知', async t => {
  const { home, workspace, directory, store } = await fixture(t);
  const file = path.join(directory, 'rollout-b.jsonl');
  const start = line('session_meta', { id: 'b', cwd: workspace }) + event('task_started', { turn_id: 'turn' });
  await fs.writeFile(file, start);
  const completed = Buffer.from(event('task_complete', { turn_id: 'turn', last_agent_message: '完成中文', duration_ms: 2345 }));
  const cut = completed.indexOf(Buffer.from('中文')) + 1;
  await fs.appendFile(file, completed.subarray(0, cut));
  assert.equal((await store.list([workspace])).sessions[0].state, 'unclosed');
  await fs.appendFile(file, completed.subarray(cut));
  let row = (await store.list([workspace])).sessions[0];
  assert.equal(row.state, 'finished'); assert.equal(row.stats.counts?.total, 1); assert.equal(row.stats.lastDurationMs, 2345);
  assert.equal(row.stats.tokens, null); assert.equal(tokenLabel(null), '—'); assert.equal(durationLabel(null), '—');
  await fs.writeFile(path.join(home, 'session_index.jsonl'), JSON.stringify({ id: 'b', thread_name: '改名后的会话' }) + '\n');
  assert.equal((await store.list([workspace])).sessions[0].title, '改名后的会话');
  // 官方回滚/重写会改变文件长度或 inode；重新索引不能重复累计。
  await fs.writeFile(file, line('session_meta', { id: 'b', cwd: workspace }) + event('task_complete', { turn_id: 'replacement', error: {}, duration_ms: 0 }));
  row = (await store.list([workspace])).sessions[0];
  assert.equal(row.state, 'failed'); assert.equal(row.stats.counts?.total, 1); assert.equal(row.stats.lastDurationMs, 0);
  await fs.mkdir(path.join(home, 'archived_sessions'));
  await fs.rename(file, path.join(home, 'archived_sessions/rollout-b.jsonl'));
  assert.equal((await store.list([workspace])).sessions.length, 0);
});

test('目录边界、缺失目录与损坏记录不会产生伪造统计', async t => {
  assert.equal(within('/work/app', '/work/apple/a'), false);
  assert.equal(formatWorkingDirectory(['/work/yhx'], '/work/yhx'), 'yhx（根目录）');
  assert.equal(formatWorkingDirectory(['/'], '/'), '/（根目录）');
  assert.equal(formatWorkingDirectory(['/work'], '/work/app/src'), 'app/src');
  assert.equal(formatWorkingDirectory(['/a/server', '/b/server'], '/b/server/src'), '/b/server/src');
  const { root, home, workspace, directory, store } = await fixture(t);
  await fs.writeFile(path.join(directory, 'bad.jsonl'), line('session_meta', { id: 'bad', cwd: workspace })
    + event('task_complete', { turn_id: 'done', duration_ms: 50 }) + '{"type":"event_msg",BAD}\n');
  await fs.writeFile(path.join(directory, 'outside.jsonl'), line('session_meta', { id: 'outside', cwd: root + '-outside' }));
  await fs.writeFile(path.join(directory, 'subagent.jsonl'), line('session_meta', { id: 'child', cwd: workspace, source: { subAgent: { thread_spawn: {} } } }));
  const { sessions } = await store.list([workspace]); assert.equal(sessions.length, 1);
  assert.equal(sessions[0].stats.counts, null); assert.equal(sessions[0].stats.incomplete, true); assert.equal(sessions[0].state, 'unknown');
  const missingHome = path.join(home, 'does-not-exist'); const missing = new LocalSessionRecords(missingHome);
  assert.deepEqual(await missing.list([workspace]), { sessions: [], sourceAvailable: false }); missing.dispose();
  await assert.rejects(fs.stat(missingHome), { code: 'ENOENT' });
});


test('历史计数缺损不抹掉最新明确结果；未结束、无记录、损坏与回滚分别说明', async t => {
  const { workspace, directory, store } = await fixture(t);
  const file = path.join(directory, 'status.jsonl');
  await fs.writeFile(file, line('session_meta', { id: 'status', cwd: workspace })
    + event('task_started') + event('task_complete', { duration_ms: 10 }));
  let row = (await store.list([workspace])).sessions[0];
  assert.equal(row.state, 'finished'); assert.equal(row.stats.counts, null);
  assert.equal(row.stats.lastDurationMs, 10); assert.equal(row.stateReason, 'lifecycle');
  assert.equal(row.stateAt, Date.parse('2026-10-22T03:00:00Z') / 1000);
  await fs.appendFile(file, '{"type":"event_msg",BAD}\n');
  row = (await store.list([workspace])).sessions[0];
  assert.equal(row.state, 'unknown'); assert.equal(row.stateReason, 'invalid_record');
  await fs.appendFile(file, event('task_started', { turn_id: 'next' }));
  row = (await store.list([workspace])).sessions[0];
  assert.equal(row.state, 'unclosed'); assert.equal(row.stats.counts, null);
  await fs.appendFile(file, event('task_complete', { turn_id: 'next', duration_ms: 55 }));
  row = (await store.list([workspace])).sessions[0];
  assert.equal(row.state, 'finished'); assert.equal(row.stats.lastDurationMs, 55);
  assert.equal(row.stats.incomplete, true); assert.equal(row.stats.counts, null);
  await fs.appendFile(file, event('thread_rolled_back'));
  row = (await store.list([workspace])).sessions[0];
  assert.equal(row.state, 'unknown'); assert.equal(row.stateReason, 'history_rollback');
  await fs.appendFile(file, event('turn_aborted', { turn_id: 'later', duration_ms: 5 }));
  assert.equal((await store.list([workspace])).sessions[0].state, 'interrupted');
  await fs.writeFile(path.join(directory, 'empty.jsonl'), line('session_meta', { id: 'empty', cwd: workspace }));
  row = (await store.list([workspace])).sessions.find(session => session.id === 'empty')!;
  assert.equal(row.state, 'empty'); assert.equal(row.stateReason, 'no_events'); assert.equal(row.stateAt, null);
});

test('跨分块的大行与嵌套 type 不吞掉回合结果；标题索引独立解码', async t => {
  const { home, workspace, directory, store } = await fixture(t);
  const file = path.join(directory, 'large.jsonl');
  // 正文大于多个读取块，后面的正常事件必须继续消费；不能把内层 type 当作顶层记录类型。
  await fs.writeFile(file, line('session_meta', { id: 'large', cwd: workspace })
    + line('response_item', { content: '长内容'.repeat(180000) })
    + event('task_started', { turn_id: 'large-turn' })
    + JSON.stringify({ payload: { type: 'task_complete', error: { type: 'response_item' }, turn_id: 'large-turn', duration_ms: 9 }, type: 'event_msg' }) + '\n');
  await fs.writeFile(path.join(home, 'session_index.jsonl'), JSON.stringify({
    extra: { type: 'compacted' }, id: 'large', thread_name: '标题仍然可读'
  }) + '\n');
  let row = (await store.list([workspace])).sessions[0];
  assert.equal(row.title, '标题仍然可读'); assert.equal(row.state, 'failed');
  assert.equal(row.stats.counts?.failed, 1); assert.equal(row.stats.lastDurationMs, 9);
  // 同尺寸原地改写也应重建摘要，而不是只按文件长度判断“没有变化”。
  const replacement = line('session_meta', { id: 'large', cwd: workspace }) + event('task_complete', { turn_id: 'same-size', duration_ms: 4 });
  await fs.writeFile(file, replacement); await store.list([workspace]);
  await fs.writeFile(file, replacement.replace('duration_ms":4', 'duration_ms":7'));
  const stat = await fs.stat(file); await fs.utimes(file, stat.atime, new Date(stat.mtimeMs + 1000));
  row = (await store.list([workspace])).sessions[0];
  assert.equal(row.stats.lastDurationMs, 7); assert.equal(row.stats.counts?.total, 1);
});
