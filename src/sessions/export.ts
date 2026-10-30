import * as vscode from 'vscode';
import type { Session } from './types';

type Cell = string | number | boolean | null;
export type CsvOptionalField = 'session_id' | 'title' | 'tags' | 'model' | 'provider';
const optionalFields: { field: CsvOptionalField; label: string; description: string }[] = [
  { field: 'session_id', label: '会话 ID', description: '可用于关联原始会话' },
  { field: 'title', label: '会话标题', description: '可能包含私人任务内容' },
  { field: 'tags', label: '自定义标签', description: '可能包含项目或个人信息' },
  { field: 'model', label: '模型名称', description: '可能包含自定义名称' },
  { field: 'provider', label: 'Provider 名称', description: '可能包含自定义名称' }
];
const headers = [
  'row', 'record_state', 'live_state', 'created_at_utc', 'updated_at_utc', 'favorite',
  'latest_total_tokens', 'latest_input_tokens', 'latest_output_tokens', 'latest_cached_input_tokens',
  'latest_cache_write_input_tokens', 'latest_reasoning_output_tokens',
  'recorded_turns_total', 'recorded_turns_completed', 'recorded_turns_failed', 'recorded_turns_interrupted', 'recorded_turns_unresolved',
  'last_turn_duration_ms', 'recorded_duration_ms', 'timed_turns', 'contains_inherited_history', 'incomplete_record'
] as const;
export interface SessionCsvSnapshot {
  readonly rows: readonly { readonly values: readonly Cell[]; readonly optional: Readonly<Record<CsvOptionalField, string>> }[];
}
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const count = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
function timestamp(value: unknown): string {
  // The records reader uses zero for an unavailable timestamp, unlike zero usage.
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

/** Project only exportable fields before opening any dialog. Never retain turns or paths. */
export function sessionCsvSnapshot(sessions: readonly Session[]): SessionCsvSnapshot {
  return Object.freeze({ rows: Object.freeze(sessions.map((session, index) => {
    const stats = session.stats, tokens = stats.tokens, counts = stats.counts;
    const recordState = ['finished', 'failed', 'interrupted', 'unclosed', 'empty', 'unknown'].includes(session.state) ? session.state : 'unknown';
    const liveState = session.live && ['running', 'approval', 'input', 'approvalInput', 'idle', 'error'].includes(session.live.state) ? session.live.state : '';
    const values: Cell[] = [
      index + 1, recordState, liveState, timestamp(session.createdAt), timestamp(session.updatedAt), session.organization?.favorite === true,
      count(tokens?.total), count(tokens?.input), count(tokens?.output), count(tokens?.cachedInput), count(tokens?.cacheWriteInput), count(tokens?.reasoningOutput),
      count(counts?.total), count(counts?.completed), count(counts?.failed), count(counts?.interrupted), count(counts?.unresolved),
      count(stats.lastDurationMs), count(stats.recordedDurationMs), count(stats.timedTurns), stats.inherited === true, stats.incomplete === true
    ];
    const optional: Record<CsvOptionalField, string> = {
      session_id: text(session.id), title: text(session.title), model: text(session.model), provider: text(session.provider),
      tags: JSON.stringify((session.organization?.tags ?? []).filter(tag => typeof tag === 'string'))
    };
    return Object.freeze({ values: Object.freeze(values), optional: Object.freeze(optional) });
  })) });
}

/** Quoting alone does not stop spreadsheet formulas. Prefix dangerous text with an apostrophe. */
export function csvCell(value: Cell): string {
  let content = value === null ? '' : String(value);
  if (typeof value === 'string' && (/^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(content) || /^[\t\r\n]/.test(content))) content = `'${content}`;
  return `"${content.replace(/"/g, '""')}"`;
}

/** Row totals can include inherited fork history; deliberately no aggregate/period/cost row. */
export function sessionsCsv(snapshot: SessionCsvSnapshot, fields: readonly CsvOptionalField[] = []): string {
  const chosen = optionalFields.map(option => option.field).filter(field => fields.includes(field));
  const rows: Cell[][] = [[...headers, ...chosen], ...snapshot.rows.map(row => [...row.values, ...chosen.map(field => row.optional[field])])];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** The controller supplies a host-validated scope and rejects stale source generations. */
export async function exportSessionsCsv(sessions: readonly Session[], isCurrent: () => boolean): Promise<boolean> {
  if (!sessions.length || !isCurrent()) return false;
  const snapshot = sessionCsvSnapshot(sessions);
  const fields = await vscode.window.showQuickPick(optionalFields, {
    canPickMany: true,
    title: `导出 ${snapshot.rows.length} 个会话 · 选择额外字段`,
    placeHolder: '不选直接回车：仅统计。所选标识可能含隐私；不导出工作目录、对话或补丁。',
    ignoreFocusOut: true
  });
  if (!fields || !isCurrent()) return false;
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const uri = await vscode.window.showSaveDialog({
    title: `保存 ${snapshot.rows.length} 个会话的最新累计统计（非期间用量；分叉可能含继承历史）`,
    saveLabel: '导出 CSV', filters: { CSV: ['csv'] },
    defaultUri: folder ? vscode.Uri.joinPath(folder, `codex-sessions-${new Date().toISOString().slice(0, 10)}.csv`) : undefined
  });
  if (!uri || !isCurrent()) return false;
  if (!/\.csv$/i.test(uri.path)) throw new Error('请选择 .csv 文件，避免覆盖其他格式的记录。');
  const csv = sessionsCsv(snapshot, fields.map(field => field.field));
  await vscode.workspace.fs.writeFile(uri, Buffer.from(csv, 'utf8'));
  return true;
}
