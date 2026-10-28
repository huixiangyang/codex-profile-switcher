import type { Memento } from 'vscode';

// 列顺序、可读下限和默认收起规则只在这里定义，宿主与 Webview 共用同一契约。
export const columns = [
  { id: 'title', label: '会话', min: 120, hideAt: 0, help: '点击切换官方会话；表头右键可配置列' },
  { id: 'status', label: '状态', min: 104, hideAt: 0, help: '实时状态优先；没有实时信息时显示上一轮结果' },
  { id: 'cwd', label: '工作目录', min: 104, hideAt: 600, help: '会话记录的实际工作目录' },
  { id: 'model', label: '模型 / Provider', min: 116, hideAt: 1040, help: '最近记录的模型或 Provider' },
  { id: 'tokens', label: 'Token 用量', min: 136, hideAt: 0, help: '入：输入；出：输出；缓：缓存输入；总：总计。悬停数值查看精确明细' },
  { id: 'rounds', label: '会话轮次', min: 68, hideAt: 0, help: '按回合计数，不是消息条数' },
  { id: 'duration', label: '最近轮耗时', min: 84, hideAt: 680, help: '最近记录回合的耗时' },
  { id: 'time', label: '记录更新', min: 80, hideAt: 880, help: '本地会话记录的更新时间' },
] as const;
export type ColumnId = typeof columns[number]['id'];
export interface ColumnLayoutPreferences {
  version: 1;
  /** null 使用默认响应式显示；数组表示用户明确选择的列。会话列不可隐藏。 */
  visible: ColumnId[] | null;
  widths: Partial<Record<ColumnId, number>>;
}
export const maxColumnWidth = 4096;
export function defaultColumnLayout(): ColumnLayoutPreferences { return { version: 1, visible: null, widths: {} }; }
export function isColumnId(id: unknown): id is ColumnId { return columns.some(column => column.id === id); }
export function isColumnLayout(value: unknown): value is ColumnLayoutPreferences {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['version','visible','widths'].includes(key))) return false;
  if (row.version !== 1 || !row.widths || typeof row.widths !== 'object' || Array.isArray(row.widths)) return false;
  if (row.visible !== null && (!Array.isArray(row.visible) || !row.visible.includes('title')
    || !row.visible.every(isColumnId) || new Set(row.visible).size !== row.visible.length)) return false;
  return Object.entries(row.widths).every(([id, width]) => isColumnId(id) && typeof width === 'number'
    && Number.isInteger(width) && width >= columns.find(column => column.id === id)!.min && width <= maxColumnWidth);
}
export function columnWidth(id: ColumnId, value: number): number {
  return Math.max(columns.find(column => column.id === id)!.min, Math.min(maxColumnWidth, Math.round(value)));
}
export function resolveColumns(layout: ColumnLayoutPreferences, viewport: number, available: number): { visible: ColumnId[]; widths: Partial<Record<ColumnId, number>>; width: number } {
  const visible = columns.filter(column => layout.visible ? layout.visible.includes(column.id) : !column.hideAt || viewport > column.hideAt).map(column => column.id);
  const base = Math.max(layout.visible === null ? 500 : 120, Math.floor(available));
  const defaults: Record<ColumnId, number> = { title: 120, status: viewport <= 1040 ? 104 : 118,
    cwd: Math.round(base * (viewport <= 1040 ? .2 : .16)), model: Math.round(base * .14), tokens: 136, rounds: 68, duration: 90, time: 92 };
  const widths: Partial<Record<ColumnId, number>> = {};
  for (const id of visible.filter(id => id !== 'title')) widths[id] = layout.widths[id] ?? Math.max(columns.find(column => column.id === id)!.min, defaults[id]);
  const others = Object.values(widths).reduce((sum, width) => sum + width, 0);
  widths.title = layout.widths.title ?? Math.max(120, base - others);
  return { visible, widths, width: others + widths.title };
}

/** 保存成功后才提交宿主状态；失败回传旧布局，前端据请求标识回滚预览。 */
export class ColumnLayoutSettings {
  layout = defaultColumnLayout();
  ack?: string;
  error?: string;
  private queue = Promise.resolve();
  constructor(private storage: Pick<Memento, 'get' | 'update'>) {
    const saved = storage.get<unknown>('sessionColumnLayout');
    if (isColumnLayout(saved)) this.layout = structuredClone(saved);
    else if (saved !== undefined) this.error = '列布局记录无法读取，暂用默认布局；可在列设置中恢复默认。';
  }
  save(layout: ColumnLayoutPreferences, requestId: string): Promise<void> {
    const next = structuredClone(layout);
    this.queue = this.queue.then(async () => {
      try {
        if (!isColumnLayout(next)) throw new Error('无效列布局');
        await this.storage.update('sessionColumnLayout', next);
        this.layout = next; this.error = undefined;
      } catch { this.error = '列布局保存失败，已恢复上次保存的布局。请稍后重试。'; }
      this.ack = requestId;
    });
    return this.queue;
  }
  async flush(): Promise<void> { await this.queue; }
}
