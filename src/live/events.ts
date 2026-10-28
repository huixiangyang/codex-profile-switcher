import { object, threadId } from './json';
import { decodePatch, newTurn, seconds, type TurnSummary } from '../sessions/turns';
import type { LiveState, RuntimeEvent } from './protocol';

function status(value: unknown): LiveState | null {
  const s = object(value);
  if (s?.type === 'idle') return 'idle';
  if (s?.type === 'systemError') return 'error';
  if (s?.type !== 'active' || !Array.isArray(s.activeFlags)) return null;
  if (s.activeFlags.some(flag => flag !== 'waitingOnApproval' && flag !== 'waitingOnUserInput')) return null;
  const approval = s.activeFlags.includes('waitingOnApproval'), input = s.activeFlags.includes('waitingOnUserInput');
  return approval && input ? 'approvalInput' : approval ? 'approval' : input ? 'input' : 'running';
}
/** 仅消费已核验的状态通知；不从输出频率、请求正文或文件时间推断运行状态。 */
export function observe(line: string, at = Date.now()): RuntimeEvent | undefined {
  const message = object(JSON.parse(line)), p = object(message?.params);
  if (!p) return;
  if (message?.method === 'thread/status/changed' && threadId(p.threadId)) return { type: 'status', id: p.threadId, state: status(p.status), at };
  if (message?.method === 'thread/closed' && threadId(p.threadId)) return { type: 'status', id: p.threadId, state: null, at };
  if (!threadId(p.threadId)) return;
  const turn = object(p.turn);
  if ((message?.method === 'turn/started' || message?.method === 'turn/completed') && threadId(turn?.id)) {
    const result = newTurn(turn.id);
    if (message.method === 'turn/completed') {
      if (!['completed', 'failed', 'interrupted'].includes(String(turn.status))) return;
      result.outcome = turn.status as TurnSummary['outcome'];
    }
    result.startedAt = seconds(turn.startedAt); result.endedAt = seconds(turn.completedAt); result.durationMs = seconds(turn.durationMs);
    return { type: 'turn', id: p.threadId, turn: result };
  }
  if (message?.method === 'item/completed' && threadId(p.turnId)) {
    const body = decodePatch(p.item, seconds(p.completedAtMs) ?? at);
    if (body) return { type: 'patch', id: p.threadId, turnId: p.turnId, body };
  }

}
