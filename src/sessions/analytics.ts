import type { Session, SessionStats, TokenUsage } from './types';
import type { Outcome } from './turns';
import type { ReviewStatus } from './workflow';
import type { ActiveLiveState } from '../live/protocol';

export type AnalysisSession = Omit<Session, 'turns'>;
export interface AnalysisChange { path:string; label:string; kind:'add'|'update'|'delete'; status:string; operations:number }
export interface AnalysisTurn {
  id: string; ordinal: number; startedAt: number | null; endedAt: number | null;
  outcome: Outcome; durationMs: number | null; files: number; operations: number;
  review: ReviewStatus; canReview: boolean; changes:AnalysisChange[];liveState?:ActiveLiveState;
}
export interface AnalysisDetail {
  session: AnalysisSession; turns: AnalysisTurn[]; recordedFiles: number;
}
export interface AnalysisState {
  scope: number; workspace: string; updatedAt: number; loading: boolean; error?: string;
  supported: boolean; sessions: AnalysisSession[]; selectedId?: string; detail?: AnalysisDetail;
}
export type AnalysisAction = { action: 'refresh' } | { action: 'switch'; id: string }
  | { action: 'review'; id: string; turnId: string };
export type AnalysisMessage = AnalysisAction | { action: 'ready' } | { action: 'overview' } | { action: 'detail'; id: string };
export function isAnalysisMessage(value: unknown): value is AnalysisMessage {
  if (!value || typeof value !== 'object' || !('action' in value)) return false;
  if (['ready', 'refresh', 'overview'].includes(String(value.action))) return true;
  if (!('id' in value) || typeof value.id !== 'string' || !value.id) return false;
  return value.action === 'detail' || value.action === 'switch'
    || value.action === 'review' && 'turnId' in value && typeof value.turnId === 'string' && !!value.turnId;
}
export const tokenFields = ['total', 'input', 'output', 'cachedInput', 'cacheWriteInput', 'reasoningOutput'] as const;
export interface KnownAmount { value: number | null; known: number }
export function sumKnown(values: (number | null | undefined)[]): KnownAmount {
  const known = values.filter((value): value is number => value != null);
  const total = known.reduce((sum, value) => sum + value, 0);
  return { value: known.length && Number.isSafeInteger(total) ? total : null, known: known.length };
}
/** 缓存命中率只使用成对有效字段，按输入量加权，不平均各会话的百分比。 */
export function cacheRate(rows: Pick<AnalysisSession, 'stats'>[]): { value: number | null; known: number } {
  const paired = rows.map(row => row.stats.tokens).filter((t): t is TokenUsage =>
    t?.input != null && t.cachedInput != null && t.cachedInput <= t.input);
  const input = sumKnown(paired.map(t => t.input)), cached = sumKnown(paired.map(t => t.cachedInput));
  return { value: input.value !== null && input.value > 0 && cached.value !== null ? cached.value / input.value : null, known: paired.length };
}
/** 环图只使用输入与输出均存在的会话；缓存完整时再拆成互不重叠的三部分。 */
export function tokenComposition(rows: Pick<AnalysisSession,'stats'>[]) {
  const paired=rows.map(row=>row.stats.tokens).filter((tokens):tokens is TokenUsage=>tokens?.input!=null&&tokens.output!=null);
  const input=sumKnown(paired.map(tokens=>tokens.input)).value, output=sumKnown(paired.map(tokens=>tokens.output)).value;
  const cacheComplete=paired.length>0&&paired.every(tokens=>tokens.cachedInput!==null&&tokens.cachedInput<=tokens.input!);
  const cached=cacheComplete?sumKnown(paired.map(tokens=>tokens.cachedInput)).value:null;
  const parts=input===null||output===null?[]:cached===null
    ? [{key:'input',label:'输入',value:input},{key:'output',label:'输出',value:output}]
    : [{key:'input',label:'非缓存输入',value:input-cached},{key:'cached',label:'缓存输入',value:cached},{key:'output',label:'输出',value:output}];
  return {parts,total:parts.length?sumKnown(parts.map(part=>part.value)).value:null,known:paired.length};
}
export function aggregate(rows: AnalysisSession[]) {
  // 分叉快照可能包含父会话用量；继续列出并可查看，但不重复加入跨会话累计值。
  const eligible = rows.filter(row => !row.stats.inherited);
  const tokens = Object.fromEntries(tokenFields.map(field => [field, sumKnown(eligible.map(row => row.stats.tokens?.[field]))])) as Record<keyof TokenUsage, KnownAmount>;
  const counted = eligible.filter(row => row.stats.counts !== null);
  const counts = counted.length ? Object.fromEntries(['total', 'completed', 'failed', 'interrupted', 'unresolved'].map(field =>
    [field, sumKnown(counted.map(row => row.stats.counts![field as keyof NonNullable<SessionStats['counts']>])).value])) as SessionStats['counts'] : null;
  return { total: rows.length, eligible: eligible.length, inherited: rows.length - eligible.length,
    active: rows.filter(row => row.workflow?.active).length,
    waiting: rows.filter(row => row.live && ['approval', 'input', 'approvalInput'].includes(row.live.state)).length,
    pending: rows.filter(row => (row.workflow?.pending ?? 0) > 0).length,
    tokens, counts, counted: counted.length, cache: cacheRate(eligible),
    duration: sumKnown(eligible.map(row => row.stats.recordedDurationMs)),
    timedTurns: eligible.reduce((sum, row) => sum + row.stats.timedTurns, 0) };
}
export function durationDistribution(turns: AnalysisTurn[]) {
  const values = turns.filter(t => t.outcome !== 'unresolved' && t.durationMs !== null).map(t => t.durationMs!).sort((a,b) => a-b);
  const mid = Math.floor(values.length / 2);
  return { count: values.length, min: values[0] ?? null, max: values.at(-1) ?? null,
    median: values.length ? values.length % 2 ? values[mid] : (values[mid-1] + values[mid]) / 2 : null,
    p95: values.length ? values[Math.ceil(values.length * .95)-1] : null };
}
export function filterSessions(rows: AnalysisSession[], query: string, cwd: string): AnalysisSession[] {
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter(row => (!cwd || row.cwd === cwd) && `${row.title} ${row.cwd} ${row.cwdLabel}`.toLocaleLowerCase().includes(needle));
}
