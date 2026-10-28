import { createHash } from 'node:crypto';
import { object } from '../live/json';

export type Outcome = 'unresolved' | 'completed' | 'failed' | 'interrupted';
export interface ChangedFile { path: string; kind: 'add' | 'update' | 'delete'; movePath?: string }
export interface FilePatch extends ChangedFile { diff: string }
export interface PatchItem { id: string; at: number; status: string; files: ChangedFile[]; fingerprint: string; bytes: number }
export interface TurnSummary { cwd?: string; id: string; outcome: Outcome; durationMs: number | null; startedAt: number | null; endedAt: number | null; items: PatchItem[] }
export interface PatchBody { item: PatchItem; patches: FilePatch[] }
export const maxPatchBytes = 512 * 1024;
export function newTurn(id: string): TurnSummary { return { id, outcome: 'unresolved', durationMs: null, startedAt: null, endedAt: null, items: [] }; }
export function seconds(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
// 内容指纹只用于把用户的审阅决定绑定到具体补丁，跨重启识别证据更新。
export function fingerprint(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function evidenceVersion(turn: TurnSummary): string {
  return fingerprint(JSON.stringify([turn.outcome, turn.items.map(i => [i.id, i.fingerprint]).sort((a, b) => a[0].localeCompare(b[0]))]));
}
export function patchItem(id: string, at: number, status: string, patches: FilePatch[]): PatchBody {
  patches.sort((a, b) => a.path.localeCompare(b.path));
  const json = JSON.stringify([status, patches]);
  return { item: { id, at, status, files: patches.map(({ diff, ...file }) => file), fingerprint: fingerprint(json), bytes: Buffer.byteLength(json) }, patches };
}
function filePatch(file: unknown, recorded = false, filePath?: string): FilePatch | undefined {
  const p = object(file), kind = recorded ? p?.type : object(p?.kind)?.type;
  const name = filePath ?? p?.path;
  const diff = recorded ? kind === 'update' ? p?.unified_diff : p?.content : p?.diff;
  const movePath = recorded ? p?.move_path : object(p?.kind)?.move_path;
  if (typeof name !== 'string' || typeof diff !== 'string' || !['add', 'delete', 'update'].includes(String(kind))) return;
  return { path: name, kind: kind as FilePatch['kind'], diff, ...(typeof movePath === 'string' ? { movePath } : {}) };
}
export function decodePatch(value: unknown, at: number, recorded = false): PatchBody | undefined {
  const item = object(value);
  if (!item || typeof item.id !== 'string' || item.type !== (recorded ? 'FileChange' : 'fileChange') || typeof item.status !== 'string') return;
  const changes = recorded ? object(item.changes) : item.changes;
  const raw = recorded && changes ? Object.entries(changes).map(([name, value]) => filePatch(value, true, name))
    : Array.isArray(changes) ? changes.map(file => filePatch(file)) : [];
  // 未知记录不能被降成空的“无改动”，该项交由缺失证据提示处理。
  if (!raw.length || raw.some(file => !file)) return;
  return patchItem(item.id, at, item.status, raw as FilePatch[]);
}
export function setItem(turn: TurnSummary, item: PatchItem): void {
  const i = turn.items.findIndex(row => row.id === item.id);
  if (i < 0) turn.items.push(item); else if (turn.items[i].at <= item.at) turn.items[i] = item;
}
export function mergeTurn(record: TurnSummary | undefined, live: TurnSummary): TurnSummary {
  if (!record) return structuredClone(live);
  const result = structuredClone(record);
  if (record.outcome === 'unresolved' && live.outcome !== 'unresolved') Object.assign(result, { outcome: live.outcome, durationMs: live.durationMs, endedAt: live.endedAt });
  result.startedAt ??= live.startedAt; result.cwd ??= live.cwd;
  for (const item of live.items) setItem(result, item);
  return result;
}
export function renderPatch(file: FilePatch): string {
  const name = file.path.replace(/[\r\n]/g, ' ');
  if (file.kind === 'update') return `--- ${name}\n+++ ${file.movePath ?? name}\n${file.diff}\n`;
  const lines = file.diff ? file.diff.replace(/\n$/, '').split('\n') : [];
  const add = file.kind === 'add';
  const header = `--- ${add ? '/dev/null' : name}\n+++ ${add ? name : '/dev/null'}\n`;
  if (!lines.length) return header;
  return `${header}@@ -${add ? '0,0' : `1,${lines.length}`} +${add ? `1,${lines.length}` : '0,0'} @@\n${lines.map(line => (add ? '+' : '-') + line).join('\n')}\n${file.diff.endsWith('\n') ? '' : '\\ No newline at end of file\n'}`;
}

/** 只缓存显式文件补丁正文，预算内淘汰；摘要和审阅标记由其他层持有。 */
export class PatchCache {
  private values = new Map<string, PatchBody>();
  private bytes = 0;
  constructor(private budget = 8 * 1024 * 1024) {}
  put(body: PatchBody): void {
    if (body.item.bytes > maxPatchBytes) return;
    const key = body.item.fingerprint;
    if (this.values.has(key)) this.values.delete(key); else this.bytes += body.item.bytes;
    this.values.set(key, body);
    while (this.bytes > this.budget) {
      const [id, old] = this.values.entries().next().value!; this.values.delete(id); this.bytes -= old.item.bytes;
    }
  }
  get(key: string): PatchBody | undefined { return this.values.get(key); }
  clear(): void { this.values.clear(); this.bytes = 0; }
}
