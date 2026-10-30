import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionOrganization, favoritesFirst, isOrganizationChange, matchesSessionFilters, maxSessionTags, normalizeTag, type SessionFilters } from '../src/sessions/organization';
import type { Session } from '../src/sessions/types';

function memory() {
  const values = new Map<string, unknown>();
  return { values, get:<T>(key:string) => values.get(key) as T | undefined,
    update:async (key:string, value:unknown) => { values.set(key, structuredClone(value)); } };
}
const row = (id: string, extra: Partial<Session> = {}): Session => ({
  id, title: `Session ${id}`, cwd: '/project/backend', cwdLabel: 'backend', createdAt: 1, updatedAt: 2,
  state: 'finished', stateAt: 2, stateReason: 'lifecycle', provider: '', model: '', turns: [],
  stats: { tokens: null, counts: null, lastDurationMs: null, recordedDurationMs: null, timedTurns: 0, inherited: false, incomplete: false }, ...extra
});
const filters: SessionFilters = { status: 'all', query: '', onlyFavorites: false, tag: '' };

test('收藏和标签按数据源及会话隔离，持久化重载，不暴露可变内部值', async () => {
  const storage = memory(), organization = new SessionOrganization(storage);
  await organization.update('/source-a', 'same-id', { favorite: true, addTag: ' urgent ' });
  await organization.update('/source-b', 'same-id', { addTag: 'other' });
  await organization.update('/source-a', 'another-id', { addTag: 'separate' });
  const reloaded = new SessionOrganization(storage);
  assert.deepEqual(reloaded.read('/source-a', 'same-id'), { favorite: true, tags: ['urgent'] });
  assert.deepEqual(reloaded.read('/source-b', 'same-id'), { favorite: false, tags: ['other'] });
  assert.deepEqual(reloaded.read('/source-a', 'another-id'), { favorite: false, tags: ['separate'] });
  const copy = reloaded.read('/source-a', 'same-id'); copy.tags.push('external'); copy.favorite = false;
  assert.deepEqual(reloaded.read('/source-a', 'same-id'), { favorite: true, tags: ['urgent'] });
  assert.deepEqual(new SessionOrganization(memory()).read('/source-a', 'same-id'), { favorite: false, tags: [] });
  assert.deepEqual([...storage.values.keys()], ['sessionOrganization']);
});

test('复合键没有分隔符或原型冲突，清空最后一项只移除该会话元数据', async () => {
  const storage = memory(), organization = new SessionOrganization(storage);
  await organization.update('a/b', 'c', { favorite: true });
  await organization.update('a', 'b/c', { addTag: 'separate' });
  await organization.update('__proto__', 'constructor', { addTag: '__proto__' });
  assert.equal(organization.read('a/b', 'c').favorite, true);
  assert.equal(organization.read('a', 'b/c').favorite, false);
  assert.deepEqual(organization.read('__proto__', 'constructor').tags, ['__proto__']);
  await organization.update('a/b', 'c', { favorite: false });
  assert.deepEqual(organization.read('a/b', 'c'), { favorite: false, tags: [] });
  assert.deepEqual(new SessionOrganization(storage).read('a', 'b/c').tags, ['separate']);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test('快速写入串行并基于已提交状态计算；失败不丢旧值也不阻塞后续编辑', async () => {
  const storage = memory();
  let release!: () => void, entered!: () => void, fail = false, writes = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const firstWrite = new Promise<void>(resolve => { release = resolve; });
  const organization = new SessionOrganization({ get: storage.get, update: async (key, value) => {
    writes++;
    if (writes === 1) { entered(); await firstWrite; }
    if (fail) { fail = false; throw new Error('synthetic storage failure'); }
    await storage.update(key, value);
  } });
  const initial = organization.update('/source', 'id', { favorite: true });
  await started;
  const add = organization.update('/source', 'id', { addTag: 'one' });
  const remove = organization.update('/source', 'id', { removeTag: 'one', addTag: 'two' });
  assert.equal(writes, 1);
  assert.deepEqual(organization.read('/source', 'id'), { favorite: false, tags: [] });
  release(); await Promise.all([initial, add, remove]);
  assert.deepEqual(organization.read('/source', 'id'), { favorite: true, tags: ['two'] });
  fail = true;
  const failed = organization.update('/source', 'id', { favorite: false, addTag: 'lost' });
  const recovered = organization.update('/source', 'id', { addTag: 'saved' });
  await assert.rejects(failed, /synthetic storage failure/); await recovered; await organization.flush();
  assert.deepEqual(new SessionOrganization(storage).read('/source', 'id'), { favorite: true, tags: ['two', 'saved'] });
});

test('标签正规化、去重、大小写和数量限制；拒绝非法或被修改的请求', async () => {
  const organization = new SessionOrganization(memory());
  assert.equal(normalizeTag('  e\u0301  '), 'é');
  assert.equal(normalizeTag('😀'.repeat(32)), '😀'.repeat(32));
  for (const invalid of ['', '   ', 'x\ny', '\tx', 'a'.repeat(33)]) assert.throws(() => normalizeTag(invalid));
  for (const invalid of [null, {}, [], { favorite: 'true' }, { addTag: '\n' }, { unknown: true }]) assert.equal(isOrganizationChange(invalid), false);
  assert.equal(isOrganizationChange({ favorite: false, addTag: 'ok' }), true);
  const change = { addTag: 'e\u0301' }; const pending = organization.update('/source', 'id', change); change.addTag = 'mutated';
  await pending; await organization.update('/source', 'id', { addTag: 'é' });
  await organization.update('/source', 'id', { addTag: 'É' });
  assert.deepEqual(organization.read('/source', 'id').tags, ['é', 'É']);
  for (let n = 2; n < maxSessionTags; n++) await organization.update('/source', 'id', { addTag: String(n) });
  await assert.rejects(organization.update('/source', 'id', { addTag: 'overflow' }));
  await organization.update('/source', 'id', { removeTag: 'e\u0301', addTag: 'replacement' });
  assert.equal(organization.read('/source', 'id').tags.length, maxSessionTags);
  assert.equal(organization.read('/source', 'id').tags.includes('replacement'), true);
});

test('未知版本或损坏元数据不被新写入静默覆盖', async () => {
  for (const saved of [{ version: 2, entries: [] }, { version: 1, entries: [{ source: 's', id: 'i', favorite: true, tags: ['bad\n'] }] }]) {
    const storage = memory(); storage.values.set('sessionOrganization', saved);
    const organization = new SessionOrganization(storage);
    assert.ok(organization.error);
    await assert.rejects(organization.update('s', 'i', { favorite: true }));
    assert.deepEqual(storage.values.get('sessionOrganization'), saved);
  }
});

test('收藏、标签、文本与原有工作流筛选组合；收藏排序不更改待处理优先级', () => {
  const active: Session['workflow'] = { active: true, attention: 'waiting', attentionAt: 1, pending: 2 };
  const a = row('a', { organization: { favorite: true, tags: ['Important', 'release'] }, workflow: active });
  const b = row('b', { organization: { favorite: false, tags: ['release'] } });
  const c = row('c', { organization: { favorite: true, tags: [] } });
  assert.equal(matchesSessionFilters(a, { ...filters, status: 'active', query: 'important', onlyFavorites: true, tag: 'release' }), true);
  assert.equal(matchesSessionFilters(a, { ...filters, status: 'review', query: 'BACKEND', onlyFavorites: true, tag: 'release' }), true);
  assert.equal(matchesSessionFilters(a, { ...filters, status: 'attention', tag: 'Release' }), false);
  assert.equal(matchesSessionFilters(b, { ...filters, onlyFavorites: true, tag: 'release' }), false);
  assert.equal(matchesSessionFilters(b, { ...filters, status: 'active' }), false);
  assert.equal(matchesSessionFilters(c, { ...filters, tag: 'release' }), false);
  const input = [b, a, c];
  assert.deepEqual(favoritesFirst(input, 'all').map(session => session.id), ['a', 'c', 'b']);
  assert.deepEqual(favoritesFirst(input, 'attention').map(session => session.id), ['b', 'a', 'c']);
  assert.deepEqual(input.map(session => session.id), ['b', 'a', 'c']);
});
