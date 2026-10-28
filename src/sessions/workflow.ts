import type { Memento } from 'vscode';
import type { Session } from './types';
import { evidenceVersion, mergeTurn, type TurnSummary } from './turns';
import type { LiveSessions } from '../live/channel';

interface ThreadDecision { baseline: string[]; reviewed: Record<string, string>; seenFailure?: string; tracked?: string[] }
interface SourceDecision { enrolledAt: number; threads: Record<string, ThreadDecision> }
interface Saved { version: 1; sources: Record<string, SourceDecision> }
export interface WorkflowState { pending: number; attention: 'waiting' | 'failure' | null; attentionAt: number; active: boolean }
export type ReviewStatus = 'baseline' | 'pending' | 'reviewed' | 'updated';
const key = (id: string) => `id:${id}`;
export class SessionWorkflow {
  private saved: Saved;
  private serial = Promise.resolve();
  private recent = new Set<string>();
  private error?: string;
  constructor(private storage: Pick<Memento, 'get' | 'update'>) {
    const value = storage.get<Saved>('sessionWorkflow');
    this.saved = value ?? { version: 1, sources: {} };
    if (this.saved.version !== 1 || !this.saved.sources) { this.error = '审阅存储格式无法识别，请保留数据并检查扩展版本。'; this.saved = { version: 1, sources: {} }; }
  }
  observed(source: string, threadId: string, turnId: string): void { this.recent.add(JSON.stringify([source, threadId, turnId])); }
  private transaction(change: (next: Saved) => boolean): Promise<void> {
    const task = this.serial.catch(() => {}).then(async () => {
      if (this.error) throw new Error(this.error);
      const next = structuredClone(this.saved);
      if (!change(next)) return;
      await this.storage.update('sessionWorkflow', next); this.saved = next;
    });
    this.serial = task; return task;
  }
  async enroll(source: string, sessions: Session[]): Promise<void> {
    await this.transaction(next => {
      let changed = false;
      let state = next.sources[key(source)];
      const first = !state;
      if (!state) { state = { enrolledAt: Date.now() / 1000, threads: {} }; next.sources[key(source)] = state; changed = true; }
      for (const session of sessions) {
        const observed = session.turns.filter(turn => this.recent.has(JSON.stringify([source, session.id, turn.id]))).map(turn => turn.id);
        const previous = state.threads[key(session.id)];
        if (previous) {
          if (previous.tracked) {
            const ids = [...new Set([...previous.tracked, ...observed])];
            if (ids.length !== previous.tracked.length) { previous.tracked = ids; changed = true; }
            if (!session.stats.incomplete) { previous.baseline = session.turns.filter(turn => turn.outcome !== 'unresolved' && !ids.includes(turn.id)).map(turn => turn.id); delete previous.tracked; changed = true; }
          }
          continue;
        }
        if (session.stats.incomplete && !observed.length) continue;
        const historical = first || !session.createdAt || session.createdAt < state.enrolledAt || session.stats.inherited;
        const baseline = historical ? session.turns.filter(t => t.outcome !== 'unresolved' && !this.recent.has(JSON.stringify([source, session.id, t.id]))).map(t => t.id) : [];
        state.threads[key(session.id)] = { baseline, reviewed: {}, ...(session.stats.incomplete ? { tracked: observed } : {}) }; changed = true;
      }
      return changed;
    });
  }
  turns(session: Session, live?: LiveSessions): TurnSummary[] {
    const turns = new Map(session.turns.map(turn => [turn.id, turn]));
    for (const turn of live?.turns.get(session.id)?.values() ?? []) turns.set(turn.id, mergeTurn(turns.get(turn.id), turn));
    return [...turns.values()].sort((a, b) => (a.startedAt ?? a.endedAt ?? 0) - (b.startedAt ?? b.endedAt ?? 0) || a.id.localeCompare(b.id));
  }
  status(source: string, threadId: string, turn: TurnSummary): ReviewStatus {
    const decision = this.saved.sources[key(source)]?.threads[key(threadId)];
    const reviewed = decision?.reviewed[key(turn.id)];
    if (reviewed) return reviewed === evidenceVersion(turn) ? 'reviewed' : 'updated';
    if (!decision || decision.tracked && !decision.tracked.includes(turn.id) || decision.baseline.includes(turn.id)) return 'baseline';
    return 'pending';
  }
  reviewable(turn: TurnSummary): boolean { return turn.outcome !== 'unresolved' && (turn.outcome === 'completed' || turn.items.length > 0); }
  pending(source: string, session: Session, live?: LiveSessions): TurnSummary[] {
    return this.turns(session, live).filter(turn => this.reviewable(turn) && ['pending', 'updated'].includes(this.status(source, session.id, turn)));
  }
  state(source: string, session: Session, live?: LiveSessions): WorkflowState {
    const status = live?.entries.get(session.id);
    const waiting = status?.state === 'approval' || status?.state === 'input' || status?.state === 'approvalInput';
    const latest = this.turns(session, live).at(-1);
    const decision = this.saved.sources[key(source)]?.threads[key(session.id)];
    const failed = latest?.outcome === 'failed' && (!status || status.state === 'idle' || status.state === 'error') && !!decision && (!decision.tracked || decision.tracked.includes(latest.id)) && !decision.baseline.includes(latest.id) && decision.seenFailure !== latest.id;
    return { pending: this.pending(source, session, live).length, attention: waiting ? 'waiting' : failed ? 'failure' : null,
      attentionAt: waiting ? status.waitingSince ?? status.at : (latest?.endedAt ?? 0) * 1000,
      active: !!status && ['running', 'approval', 'input', 'approvalInput'].includes(status.state) };
  }
  async opened(source: string, session: Session, live?: LiveSessions): Promise<void> {
    const latest = this.turns(session, live).at(-1);
    if (latest?.outcome !== 'failed') return;
    await this.transaction(next => {
      const decision = next.sources[key(source)]?.threads[key(session.id)];
      if (!decision || decision.seenFailure === latest.id) return false;
      decision.seenFailure = latest.id; return true;
    });
  }
  async mark(source: string, threadId: string, turn: TurnSummary, reviewed: boolean): Promise<void> {
    await this.transaction(next => {
      const decision = next.sources[key(source)]?.threads[key(threadId)];
      if (!decision) throw new Error('该会话记录尚不完整，无法保存审阅决定。');
      decision.baseline = decision.baseline.filter(id => id !== turn.id);
      if (reviewed) decision.reviewed[key(turn.id)] = evidenceVersion(turn); else delete decision.reviewed[key(turn.id)];
      return true;
    });
  }
  async flush(): Promise<void> { await this.serial.catch(() => {}); }
}
