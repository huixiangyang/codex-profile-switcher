import type { SessionStats } from './types';

// 主表保留三位有效数字与 K/M/B/T 单位；精确整数仍由统计明细展示。
const compactTokens = new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3, useGrouping: false });
export function tokenLabel(value: number | null): string {
  return value === null ? '—' : compactTokens.format(value);
}
export function durationLabel(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`
    : seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}
export function roundsText(stats: SessionStats): string {
  const counts = stats.counts;
  if (!counts) return stats.incomplete ? '部分记录不可用，无法统计总轮次。' : '暂无回合记录。';
  return `共 ${counts.total} 轮\n已完成 ${counts.completed} · 失败 ${counts.failed} · 已停止 ${counts.interrupted}${counts.unresolved?`\n${counts.unresolved} 轮暂无结果记录`:''}`;
}
export function statisticsText(stats: SessionStats): string {
  const exact = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString();
  const { tokens, counts } = stats;
  const lines = [
    `累计 Token：${exact(tokens?.total)}`, `输入：${exact(tokens?.input)}`, `输出：${exact(tokens?.output)}`,
    `输入中已缓存：${exact(tokens?.cachedInput)}`, `缓存写入：${exact(tokens?.cacheWriteInput)}`, `输出中推理：${exact(tokens?.reasoningOutput)}`,
    '', `记录回合数：${exact(counts?.total)}`,
    counts ? `已完成 ${counts.completed} · 失败 ${counts.failed} · 已停止 ${counts.interrupted}` : stats.incomplete ? '回合统计：记录不完整' : '回合统计：暂无记录',
    `最近轮耗时：${durationLabel(stats.lastDurationMs)}`,
    `已记录执行时长：${durationLabel(stats.recordedDurationMs)}（${stats.timedTurns} 轮有耗时记录）`
  ];
  if (stats.inherited) lines.push('包含分叉继承的历史记录');
  if (stats.incomplete) lines.push('部分记录损坏、缺少回合标识或存在历史回滚，无法确认完整计数');
  return lines.join('\n');
}
