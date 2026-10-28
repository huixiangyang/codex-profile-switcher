import { object, threadId } from './json';
import type { TurnSummary, PatchBody } from '../sessions/turns';
/** 传递运行和回合摘要，以及有界文件补丁；不传聊天、命令输出、批准正文或认证信息。 */
export type LiveState = 'running' | 'approval' | 'input' | 'approvalInput' | 'idle' | 'error';
export type ActiveLiveState = Exclude<LiveState,'idle'|'error'>;
export interface LiveEntry { id: string; state: LiveState; at: number; waitingSince?: number }
export type RuntimeEvent = { type: 'status'; id: string; state: LiveState | null; at: number }
  | { type: 'turn'; id: string; turn: TurnSummary }
  | { type: 'patch'; id: string; turnId: string; body: PatchBody };
export type LiveMode = 'off' | 'reload' | 'connecting' | 'connected' | 'disconnected' | 'unsupported';
export const liveModeLabels: Record<LiveMode, string> = {
  off: '本地记录', reload: '监听待重载', connecting: '等待监听连接', connected: '实时监听', disconnected: '监听已断开', unsupported: '监听未适配'
};
export function activeLiveState(value:unknown):value is ActiveLiveState {return ['running','approval','input','approvalInput'].some(state=>state===value);}
export function liveState(value: unknown): value is LiveState { return activeLiveState(value)||value==='idle'||value==='error'; }
export function liveEntry(value: unknown): value is LiveEntry {
  const row = object(value);
  return !!row && threadId(row.id) && liveState(row.state) && typeof row.at === 'number' && Number.isFinite(row.at) && row.at > 0;
}
