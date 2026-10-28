import { decodePatch, newTurn, setItem, type TurnSummary, type Outcome } from './turns';
import type { RecordState, StateReason, SessionStats, TokenUsage } from './types';

type Json = Record<string, unknown>;
function object(value: unknown): Json | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : null;
}
function parse(line: string): Json | null {
  try { return object(JSON.parse(line)); }
  catch { return null; }
}
function amount(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function timestamp(value: unknown): number { const n = typeof value === 'string' ? Date.parse(value) / 1000 : NaN; return Number.isFinite(n) ? n : 0; }
function title(value: unknown): string { return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 200) : ''; }

/** 只解析落盘的统计事件，不保存聊天正文、命令输出或凭据。 */
export class RolloutSummary {
  createdAt = 0; id = ''; cwd = ''; model = ''; provider = ''; preview = ''; updatedAt = 0;
  interactive = true;
  inherited = false; incomplete = false; tokens: TokenUsage | null = null;
  private turns = new Map<string, TurnSummary>();
  // 最新回合状态与整段历史的统计完整性分开；旧缺损不能抹掉后来明确的结束事件。
  private latest: { state: RecordState; at: number | null; reason: StateReason; durationMs: number | null } = {
    state: 'empty', at: null, reason: 'no_events', durationMs: null
  };
  consume(line: string): void {
    // 只快跳过确定的顶层信封；字段顺序不同则正常解析，不能误匹配嵌套 type。
    if (/^\s*\{\s*(?:"timestamp"\s*:\s*"(?:[^"\\]|\\.)*"\s*,\s*)?"type"\s*:\s*"(?:response_item|compacted)"\s*[,}]/.test(line)) return;
    const record = parse(line);
    if (!record) {
      this.incomplete = true;
      this.latest = { state: 'unknown', at: null, reason: 'invalid_record', durationMs: null }; return;
    }
    const p = object(record.payload);
    if (!p) return;
    if (record.type !== 'session_meta' && !this.interactive) return;
    this.updatedAt = Math.max(this.updatedAt, timestamp(record.timestamp));
    if (record.type === 'session_meta') {
      this.createdAt = timestamp(record.timestamp);
      if (typeof p.id === 'string') this.id = p.id;
      if (typeof p.cwd === 'string') this.cwd = p.cwd;
      if (typeof p.model_provider === 'string') this.provider = p.model_provider;
      this.inherited = typeof p.forked_from_id === 'string';
      // 延续会话面板原有范围，不把 exec 或子代理日志当作独立交互会话。
      this.interactive = p.source === undefined || p.source === 'cli' || p.source === 'vscode' || p.source === 'appServer';
    } else if (record.type === 'turn_context') {
      if (typeof p.cwd === 'string') this.cwd = p.cwd;
      if (typeof p.model === 'string') this.model = p.model;
      if (typeof p.turn_id === 'string') { const turn = this.turns.get(p.turn_id) ?? newTurn(p.turn_id); turn.cwd = this.cwd; this.turns.set(p.turn_id, turn); }
    } else if (record.type === 'event_msg') {
      if (p.type === 'token_count') {
        const usage = object(object(p.info)?.total_token_usage);
        // total_token_usage 是累计快照，重复事件不可再次求和；info:null 只更新限额，不清零用量。
        if (usage) this.tokens = {
          total: amount(usage.total_tokens), input: amount(usage.input_tokens), output: amount(usage.output_tokens),
          cachedInput: amount(usage.cached_input_tokens), cacheWriteInput: amount(usage.cache_write_input_tokens),
          reasoningOutput: amount(usage.reasoning_output_tokens)
        };
      } else if (p.type === 'task_started' || p.type === 'task_complete' || p.type === 'turn_aborted') {
        const outcome: Outcome = p.type === 'task_started' ? 'unresolved' : p.type === 'turn_aborted' ? 'interrupted' : p.error != null ? 'failed' : 'completed';
        const durationMs = p.type === 'task_started' ? null : amount(p.duration_ms);
        this.latest = {
          state: outcome === 'unresolved' ? 'unclosed' : outcome === 'completed' ? 'finished' : outcome,
          at: timestamp(record.timestamp) || amount(p.type === 'task_started' ? p.started_at : p.completed_at) || null,
          reason: 'lifecycle', durationMs
        };
        // 即使缺少用于去重的 ID，明确的结束事件仍能说明结果；只把完整回合计数标为未知。
        if (typeof p.turn_id !== 'string') { this.incomplete = true; return; }
        const turn = this.turns.get(p.turn_id) ?? newTurn(p.turn_id); turn.cwd ??= this.cwd;
        // 重复的开始记录不能把已明确结束的同一回合降为未结束。
        if (outcome !== 'unresolved' || turn.outcome === 'unresolved') { turn.outcome = outcome; turn.durationMs = durationMs; }
        if (p.type === 'task_started') turn.startedAt ??= timestamp(record.timestamp);
        else turn.endedAt = timestamp(record.timestamp);
        this.turns.set(p.turn_id, turn);
      } else if (p.type === 'thread_rolled_back') {
        // 不从回滚标记猜测哪些历史回合还有效；最新用量快照仍可单独读取。
        this.incomplete = true; this.tokens = null;
        this.latest = { state: 'unknown', at: timestamp(record.timestamp) || null, reason: 'history_rollback', durationMs: null };
      } else if (p.type === 'item_completed' && object(p.item)?.type === 'FileChange' && typeof p.turn_id === 'string') {
        const body = decodePatch(p.item, typeof p.completed_at_ms === 'number' ? p.completed_at_ms : timestamp(record.timestamp) * 1000, true);
        if (body) { const turn = this.turns.get(p.turn_id) ?? newTurn(p.turn_id); setItem(turn, body.item); this.turns.set(p.turn_id, turn); }
      } else if (!this.preview && p.type === 'user_message') this.preview = title(p.message);
      else if (!this.preview && p.type === 'item_completed') {
        const item = object(p.item);
        if (item?.type === 'UserMessage' && Array.isArray(item.content))
          this.preview = title(item.content.map(object).find(part => part?.type === 'text')?.text);
      }
    }
  }
  snapshot(): { state: RecordState; stateAt: number | null; stateReason: StateReason; stats: SessionStats; turns: TurnSummary[] } {
    const turns = [...this.turns.values()];
    const counts = this.incomplete || !turns.length ? null : {
      total: turns.length, completed: turns.filter(t => t.outcome === 'completed').length,
      failed: turns.filter(t => t.outcome === 'failed').length, interrupted: turns.filter(t => t.outcome === 'interrupted').length,
      unresolved: turns.filter(t => t.outcome === 'unresolved').length
    };
    const timed = turns.filter(turn => turn.outcome !== 'unresolved' && turn.durationMs !== null);
    return { turns, state: this.latest.state, stateAt: this.latest.at, stateReason: this.latest.reason, stats: {
      tokens: this.tokens, counts, lastDurationMs: this.latest.durationMs,
      recordedDurationMs: timed.length ? timed.reduce((sum, turn) => sum + turn.durationMs!, 0) : null,
      timedTurns: timed.length, inherited: this.inherited, incomplete: this.incomplete
    } };
  }
}

export type TitleIndex = Map<string, { title: string; updatedAt: number }>;
export function consumeTitle(names: TitleIndex, line: string): void {
  const record = parse(line);
  if (record && typeof record.id === 'string' && typeof record.thread_name === 'string')
    names.set(record.id, { title: title(record.thread_name), updatedAt: timestamp(record.updated_at) });
}
