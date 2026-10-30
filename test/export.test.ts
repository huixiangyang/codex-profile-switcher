import test from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { csvCell, exportSessionsCsv, sessionCsvSnapshot, sessionsCsv } from '../src/sessions/export';
import type { Session } from '../src/sessions/types';

function session(id: string, inherited = false): Session {
  return { id, title: `private title ${id}`, cwd: '/private/project', cwdLabel: 'private-project', createdAt: 1, updatedAt: 2,
    model: 'private-model', provider: 'private-provider', state: 'finished', stateAt: 2, stateReason: 'lifecycle',
    organization: { favorite: true, tags: ['private-tag'] },
    turns: [{ id: 'private-turn', outcome: 'completed', startedAt: 1, endedAt: 2, durationMs: 0, items: [] }],
    stats: { tokens: { total: 0, input: null, output: 0, cachedInput: null, cacheWriteInput: null, reasoningOutput: null },
      counts: { total: 1, completed: 1, failed: 0, interrupted: 0, unresolved: 0 }, lastDurationMs: 0,
      recordedDurationMs: 0, timedTurns: 1, inherited, incomplete: inherited } };
}
function parseCsv(csv: string): string[][] {
  const result: string[][] = []; let row: string[] = [], value = '', quoted = false;
  csv = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(value); value = ''; }
    else if (!quoted && char === '\r' && csv[i + 1] === '\n') { row.push(value); result.push(row); row = []; value = ''; i++; }
    else value += char;
  }
  assert.equal(quoted, false);
  assert.equal(value, '');
  return result;
}

test('CSV defaults exclude identifiers, paths and turn contents; preserve unknown, zero and inherited history without aggregation', () => {
  const normal = session('private-a'), fork = session('private-fork', true);
  fork.stats.tokens = null; fork.stats.counts = null; fork.createdAt = 0;
  const csv = sessionsCsv(sessionCsvSnapshot([normal, fork]));
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.endsWith('\r\n'));
  assert.ok(!csv.includes('private')); assert.ok(!csv.includes('/')); assert.ok(!csv.includes('cost'));
  const rows = parseCsv(csv), keys = rows[0];
  assert.equal(rows.length, 3);
  const first = Object.fromEntries(keys.map((key, i) => [key, rows[1][i]]));
  const second = Object.fromEntries(keys.map((key, i) => [key, rows[2][i]]));
  assert.equal(first.latest_total_tokens, '0'); assert.equal(first.latest_input_tokens, '');
  assert.equal(first.recorded_turns_failed, '0'); assert.equal(first.last_turn_duration_ms, '0');
  assert.equal(first.created_at_utc, '1970-01-01T00:00:01.000Z'); assert.equal(first.favorite, 'true');
  assert.equal(second.created_at_utc, ''); assert.equal(second.latest_total_tokens, '');
  assert.equal(second.recorded_turns_total, ''); assert.equal(second.contains_inherited_history, 'true');
  assert.equal(second.incomplete_record, 'true'); assert.equal(first.contains_inherited_history, 'false');
});

test('CSV snapshots are immutable projections; optional fields, commas, quotes, Unicode and line endings round trip', () => {
  const row = session('identifier'); row.title = '标题, "quoted"\r\nsecond line';
  row.organization!.tags = ['alpha,beta', '标签'];
  const snapshot = sessionCsvSnapshot([row]);
  row.title = 'changed'; row.stats.tokens!.total = 500; row.organization!.tags.push('changed');
  assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot.rows[0].values));
  assert.ok(!JSON.stringify(snapshot).includes('/private')); assert.ok(!JSON.stringify(snapshot).includes('private-turn'));
  const rows = parseCsv(sessionsCsv(snapshot, ['title', 'tags', 'session_id', 'title']));
  const result = Object.fromEntries(rows[0].map((key, i) => [key, rows[1][i]]));
  assert.equal(result.title, '标题, "quoted"\r\nsecond line'); assert.equal(result.latest_total_tokens, '0');
  assert.equal(result.session_id, 'identifier'); assert.deepEqual(JSON.parse(result.tags), ['alpha,beta', '标签']);
  assert.equal(rows[0].filter(key => key === 'title').length, 1); assert.equal(result.provider, undefined);
});

test('CSV defends spreadsheet formulas including whitespace and control prefixes and validates numeric/date values', () => {
  for (const payload of ['=1+1', '+cmd', '-1+1', '@SUM(A1)', '  =1', '\uFEFF=1', '\u0000=1', '\t=1', '\r=1', '\ntext']) {
    assert.equal(parseCsv(csvCell(payload) + '\r\n')[0][0], `'${payload}`);
  }
  assert.equal(csvCell(0), '"0"'); assert.equal(csvCell('ordinary'), '"ordinary"');
  const row = session('=id'); row.model = ' +model'; row.provider = '@provider'; row.updatedAt = Infinity;
  row.stats.tokens!.input = NaN; row.stats.tokens!.output = -1;
  const rows = parseCsv(sessionsCsv(sessionCsvSnapshot([row]), ['session_id', 'model', 'provider']));
  const result = Object.fromEntries(rows[0].map((key, i) => [key, rows[1][i]]));
  assert.equal(result.session_id, "'=id"); assert.equal(result.model, "' +model"); assert.equal(result.provider, "'@provider");
  assert.equal(result.updated_at_utc, ''); assert.equal(result.latest_input_tokens, ''); assert.equal(result.latest_output_tokens, '');
});

test('CSV field/save cancellation and invalidated source never write; no selection means safe defaults', async t => {
  let pick: unknown = undefined, saves = 0, writes = 0, current = true;
  let destination: vscode.Uri | undefined = vscode.Uri.file('/exports/sessions.csv');
  t.mock.method(vscode.window, 'showQuickPick', async () => pick);
  t.mock.method(vscode.window, 'showSaveDialog', async () => { saves++; return destination; });
  t.mock.method(vscode.workspace.fs, 'writeFile', async (_uri: vscode.Uri, bytes: Uint8Array) => {
    writes++; assert.ok(!Buffer.from(bytes).toString().includes('private'));
  });
  assert.equal(await exportSessionsCsv([session('private-id')], () => current), false);
  assert.equal(saves, 0); assert.equal(writes, 0);
  pick = []; destination = undefined;
  assert.equal(await exportSessionsCsv([session('private-id')], () => current), false);
  assert.equal(saves, 1); assert.equal(writes, 0);
  destination = vscode.Uri.file('/exports/sessions.csv'); current = false;
  assert.equal(await exportSessionsCsv([session('private-id')], () => current), false);
  assert.equal(saves, 1); assert.equal(writes, 0);
  current = true;
  assert.equal(await exportSessionsCsv([session('private-id')], () => current), true);
  assert.equal(saves, 2); assert.equal(writes, 1);
  destination = vscode.Uri.file('/exports/record.jsonl');
  await assert.rejects(exportSessionsCsv([session('private-id')], () => current));
  assert.equal(writes, 1);
});

test('CSV validates source after both dialogs and exports the original host snapshot across refreshes', async t => {
  const row = session('snapshot-id'); let current = true, saves = 0, writes = 0, stage = 'fields';
  t.mock.method(vscode.window, 'showQuickPick', async () => {
    row.stats.tokens!.total = 500;
    if (stage === 'fields') current = false;
    return [{ field: 'session_id' }];
  });
  t.mock.method(vscode.window, 'showSaveDialog', async (options: vscode.SaveDialogOptions) => {
    saves++; assert.match(options.defaultUri!.path, /codex-sessions-\d{4}-\d{2}-\d{2}\.csv$/);
    if (stage === 'save') current = false;
    return vscode.Uri.file('/exports/sessions.csv');
  });
  t.mock.method(vscode.workspace.fs, 'writeFile', async (_uri: vscode.Uri, bytes: Uint8Array) => {
    writes++; const rows = parseCsv(Buffer.from(bytes).toString());
    assert.equal(rows[1][rows[0].indexOf('latest_total_tokens')], '0');
    assert.equal(rows[1][rows[0].indexOf('session_id')], 'snapshot-id');
  });
  assert.equal(await exportSessionsCsv([row], () => current), false); assert.equal(saves, 0);
  stage = 'save'; current = true;
  assert.equal(await exportSessionsCsv([row], () => current), false); assert.equal(saves, 1); assert.equal(writes, 0);
  stage = 'saved'; current = true; row.stats.tokens!.total = 0;
  assert.equal(await exportSessionsCsv([row], () => current), true); assert.equal(saves, 2); assert.equal(writes, 1);
});

test('CSV write failures propagate to the controller without a false success', async t => {
  t.mock.method(vscode.window, 'showQuickPick', async () => []);
  t.mock.method(vscode.window, 'showSaveDialog', async () => vscode.Uri.file('/exports/sessions.csv'));
  t.mock.method(vscode.workspace.fs, 'writeFile', async () => { throw new Error('disk full'); });
  await assert.rejects(exportSessionsCsv([session('id')], () => true), /disk full/);
});

test('CSV feedback is quiet for empty/canceled actions, confirms only completed writes, and explains invalidated exports', async t => {
  const notices: string[] = []; let fields: unknown = [], current = true, fail = false, writes = 0;
  let destination: vscode.Uri | undefined = vscode.Uri.file('/exports/synthetic-results.csv');
  t.mock.method(vscode.window, 'showInformationMessage', async (message: string) => { notices.push(message); });
  t.mock.method(vscode.window, 'showQuickPick', async () => fields);
  t.mock.method(vscode.window, 'showSaveDialog', async () => destination);
  t.mock.method(vscode.workspace.fs, 'writeFile', async () => { writes++; if (fail) throw new Error('fixture write failure'); });
  assert.equal(await exportSessionsCsv([], () => current), false);
  fields = undefined;
  assert.equal(await exportSessionsCsv([session('id')], () => current), false);
  fields = []; destination = undefined;
  assert.equal(await exportSessionsCsv([session('id')], () => current), false);
  assert.equal(notices.length, 0); assert.equal(writes, 0);
  destination = vscode.Uri.file('/exports/synthetic-results.csv'); fail = true;
  await assert.rejects(exportSessionsCsv([session('id')], () => current), /fixture write failure/);
  assert.equal(notices.length, 0);
  fail = false;
  assert.equal(await exportSessionsCsv([session('id')], () => current), true);
  assert.equal(notices.length, 1); assert.ok(notices[0].includes('synthetic-results.csv'));
  assert.ok(!notices[0].includes('/exports/')); assert.equal(writes, 2);
  t.mock.method(vscode.window, 'showQuickPick', async () => { current = false; return []; });
  assert.equal(await exportSessionsCsv([session('id')], () => current), false);
  assert.equal(notices.length, 2); assert.equal(writes, 2);
  current = true;
  t.mock.method(vscode.window, 'showQuickPick', async () => []);
  t.mock.method(vscode.window, 'showSaveDialog', async () => { current = false; return destination; });
  assert.equal(await exportSessionsCsv([session('id')], () => current), false);
  assert.equal(notices.length, 3); assert.equal(writes, 2);
});
