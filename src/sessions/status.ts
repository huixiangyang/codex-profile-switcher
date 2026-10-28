import type { LiveState, ActiveLiveState } from '../live/protocol';
import type { Session, RecordState } from './types';
import type { Outcome } from './turns';
import type { ReviewStatus } from './workflow';

// 页面只展示用户能据此行动的状态；日志缺少字段不是一种运行状态。
export const liveLabels: Record<LiveState,string> = {
  running:'运行中',approval:'待批准',input:'待回复',approvalInput:'待处理',idle:'空闲',error:'异常'
};
const recordLabels: Record<RecordState,string> = {
  finished:'已完成',failed:'失败',interrupted:'已停止',unclosed:'—',empty:'—',unknown:'—'
};
export const outcomeLabels: Record<Outcome,string> = {
  completed:'已完成',failed:'失败',interrupted:'已停止',unresolved:'—'
};
export const reviewLabels: Record<ReviewStatus,string> = {
  baseline:'未审阅',pending:'待审阅',reviewed:'已审阅',updated:'需重审'
};
export function sessionStatusLabel(session:Pick<Session,'state'|'live'>):string {
  return session.live?liveLabels[session.live.state]:recordLabels[session.state];
}
export function sessionStatusHint(session:Pick<Session,'state'|'stateAt'|'live'>):string {
  const label=sessionStatusLabel(session);
  if(session.live){
    const waiting=['approval','input','approvalInput'].includes(session.live.state);
    return `${label} · 实时状态${waiting?'\n请在 Codex 侧栏处理。':''}`;
  }
  if(label==='—')return '当前状态不可用。';
  return `上一轮：${label}${session.stateAt===null?'':`\n记录时间：${new Date(session.stateAt*1000).toLocaleString('zh-CN')}`}`;
}
export function turnStatusLabel(turn:{outcome:Outcome;liveState?:ActiveLiveState}):string {
  return turn.outcome==='unresolved'&&turn.liveState?liveLabels[turn.liveState]:outcomeLabels[turn.outcome];
}
