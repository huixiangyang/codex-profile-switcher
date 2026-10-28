import { isColumnLayout, type ColumnLayoutPreferences } from './columns';
import type { TurnSummary, ChangedFile } from './turns';
import type { WorkflowState, ReviewStatus } from './workflow';
import type { LiveEntry, LiveMode } from '../live/protocol';
export type RecordState = 'finished' | 'failed' | 'interrupted' | 'unclosed' | 'empty' | 'unknown';
export type StateReason = 'lifecycle' | 'no_events' | 'invalid_record' | 'history_rollback';
export interface TokenUsage {
  total: number | null; input: number | null; output: number | null;
  cachedInput: number | null; cacheWriteInput: number | null; reasoningOutput: number | null;
}
export interface SessionStats {
  tokens: TokenUsage | null;
  counts: { total: number; completed: number; failed: number; interrupted: number; unresolved: number } | null;
  lastDurationMs: number | null;
  recordedDurationMs: number | null;
  timedTurns: number;
  inherited: boolean;
  incomplete: boolean;
}
export interface Session {
  createdAt: number; turns: TurnSummary[]; workflow?: WorkflowState; id: string; title: string; cwd: string; updatedAt: number;
  provider: string; model: string; state: RecordState; stateAt: number | null; stateReason: StateReason;
  cwdLabel: string; stats: SessionStats; live?: LiveEntry;
}
export interface ViewState {
  columnLayout: ColumnLayoutPreferences; columnLayoutAck?: string;
  liveMode: LiveMode; sourceAvailable: boolean; loading: boolean; error?: string; supported: boolean;
  selectedId?: string; sessions: Session[]; review?: ReviewDetail; focusAttention?: number;
}
export interface ReviewDetail {
  id: string; title: string; turnId: string; version: string; stale: boolean; status: ReviewStatus; outcome: TurnSummary['outcome'];
  turns: { id: string; label: string; status: ReviewStatus }[];
  files: (ChangedFile & { label: string; operations: number; status: string; available: boolean })[];
  note: string;
}
export type PanelAction = { action: 'open' | 'refresh' | 'configureLive' | 'next' | 'back' }
  | { action: 'analytics'; id?: string }
  | { action: 'layout'; layout: ColumnLayoutPreferences; requestId: string }
  | { action: 'switch'; id: string }
  | { action: 'review'; id: string; turnId?: string }
  | { action: 'mark'; id: string; turnId: string; version: string; reviewed: boolean }
  | { action: 'patch' | 'file'; id: string; turnId: string; version: string; path: string };
export type ViewMessage = PanelAction | { action: 'ready' };
export function isViewMessage(value: unknown): value is ViewMessage {
  if (!value || typeof value !== 'object' || !('action' in value)) return false;
  if (value.action === 'analytics') return !('id' in value) || typeof value.id === 'string' && !!value.id;
  if (value.action === 'layout') return 'layout' in value && isColumnLayout(value.layout) && 'requestId' in value && typeof value.requestId === 'string' && value.requestId.length > 0 && value.requestId.length <= 128;
  if (['ready','open','refresh','configureLive','next','back'].includes(String(value.action))) return true;
  if (!('id' in value) || typeof value.id !== 'string' || !value.id) return false;
  if (value.action === 'switch') return true;
  if (value.action === 'review') return !('turnId' in value) || typeof value.turnId === 'string';
  if (!('turnId' in value) || typeof value.turnId !== 'string' || !('version' in value) || typeof value.version !== 'string') return false;
  if (value.action === 'mark') return 'reviewed' in value && typeof value.reviewed === 'boolean';
  return (value.action === 'patch' || value.action === 'file') && 'path' in value && typeof value.path === 'string';
}
