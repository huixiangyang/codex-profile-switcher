import { createElement, Circle, CircleAlert, CircleStop, Check, LoaderCircle, ShieldQuestion, CircleHelp, FileDiff, ChartNoAxesCombined, Star, Tag } from 'lucide';
import { columns } from './columns';
import type { Session } from './types';
import { sessionStatusLabel, sessionStatusHint } from './status';
import { tokenLabel, durationLabel, statisticsText, roundsText } from './statistics';

const metrics = [['input', '入', '输入'], ['output', '出', '输出'], ['cachedInput', '缓', '缓存输入'], ['total', '总', '总计']] as const;
const relative = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto', style: 'short' });
function time(seconds: number): string {
  if (!seconds) return '—';
  const age = Math.max(0, Date.now() / 1000 - seconds);
  return age < 60 ? '刚刚' : age < 3600 ? relative.format(-Math.floor(age / 60), 'minute')
    : age < 86400 ? relative.format(-Math.floor(age / 3600), 'hour') : relative.format(-Math.floor(age / 86400), 'day');
}
function text(element: HTMLElement, value: string): void { if (element.textContent !== value) element.textContent = value; }
function attribute(element: HTMLElement, name: string, value: string): void { if (element.getAttribute(name) !== value) element.setAttribute(name, value); }
function cell(className = ''): HTMLTableCellElement {
  const td = document.createElement('td'); td.className = className; return td;
}
function updateCell(cell: HTMLTableCellElement, value: string, tooltip = value): void {
  text(cell, value); attribute(cell, 'title', tooltip);
}

class SessionRow {
  readonly element = document.createElement('tr');
  private button = document.createElement('button');
  private title = document.createElement('span');
  private review = document.createElement('button');
  private badge = document.createElement('span');
  private favorite = document.createElement('button');
  private tags = document.createElement('button');
  private tagLabel = document.createElement('span');
  private status = cell();
  private cwd = cell('cwd-cell');
  private model = cell('model-cell');
  private tokens = cell('tokens-cell');
  private rounds = cell('rounds-cell');
  private duration = cell('duration-cell');
  private updated = cell('time-cell');
  private values = metrics.map(() => document.createElement('span'));
  private recordState?: string;
  constructor(id: string) {
    this.element.dataset.id = id; this.button.dataset.id = id; this.button.className = 'session-title';
    this.button.append(this.title);
    const titleCell = cell('title-cell organized-title-cell');
    const layout = document.createElement('div'); layout.className = 'title-layout';
    const analysis = document.createElement('button'); analysis.className = 'row-analysis'; analysis.dataset.analysis = id;
    analysis.title = '查看单会话分析'; analysis.setAttribute('aria-label','查看单会话分析'); analysis.append(createElement(ChartNoAxesCombined));
    this.review.className = 'row-review'; this.review.dataset.review = id; this.review.title = '审阅回合'; this.review.setAttribute('aria-label', '审阅回合');
    this.review.append(createElement(FileDiff)); this.badge.className = 'review-badge'; this.review.append(this.badge);
    layout.append(this.button, analysis, this.review);
    const organization = document.createElement('div'); organization.className = 'row-organization';
    this.favorite.className = 'row-favorite'; this.favorite.dataset.favorite = id; this.favorite.append(createElement(Star));
    this.tags.className = 'row-tags'; this.tags.dataset.tags = id; this.tags.append(createElement(Tag), this.tagLabel);
    organization.append(this.favorite, this.tags); titleCell.append(layout, organization);
    const breakdown = document.createElement('div'); breakdown.className = 'token-breakdown';
    // 单字标签收窄列宽，四项仍直接可见；数值与整列悬停继续提供精确明细。
    metrics.forEach(([key, label, meaning], i) => {
      const metric = document.createElement('span'); metric.className = 'token-metric'; metric.dataset.token = key;
      const kind = document.createElement('span'); kind.className = 'token-kind'; kind.textContent = label; kind.title = meaning;
      this.values[i].className = 'token-value'; metric.append(kind, this.values[i]); breakdown.append(metric);
    });
    this.tokens.append(breakdown);
    const cells = [titleCell, this.status, this.cwd, this.model, this.tokens, this.rounds, this.duration, this.updated];
    cells.forEach((cell, index) => { cell.dataset.column = columns[index].id; });
    this.element.append(...cells);
  }
  update(session: Session, supported: boolean, selected: boolean, pending: boolean): void {
    const favorite = !!session.organization?.favorite, tags = session.organization?.tags ?? [];
    attribute(this.favorite, 'aria-pressed', String(favorite));
    attribute(this.favorite, 'aria-label', `${favorite ? '取消收藏' : '收藏会话'}：${session.title}`);
    this.favorite.title = favorite ? '取消收藏' : '收藏会话';
    attribute(this.favorite, 'aria-disabled', String(pending)); attribute(this.tags, 'aria-disabled', String(pending));
    text(this.tagLabel, tags.length ? tags.join(' · ') : '标签');
    attribute(this.tags, 'aria-label', `编辑标签：${session.title}`);
    attribute(this.tags, 'title', tags.length ? `标签：${tags.join('、')}；点击添加／移除` : '添加会话标签');
    this.tags.classList.toggle('has-tags', tags.length > 0);
    this.element.classList.toggle('selected', selected);
    text(this.badge, session.workflow?.pending ? String(session.workflow.pending) : '');
    this.review.classList.toggle('has-pending', !!session.workflow?.pending);
    this.review.title = session.workflow?.pending ? `待审阅 · ${session.workflow.pending} 轮` : '审阅回合';
    this.review.setAttribute('aria-label', this.review.title);
    this.button.disabled = !supported; text(this.title, session.title);
    attribute(this.button, 'title', `${session.title}\n工作目录：${session.cwd}`);
    const live = session.live, label = sessionStatusLabel(session);
    const state = live ? `live-${live.state}` : session.state;
    attribute(this.button, 'aria-label', `${session.title}，${label}，工作目录 ${session.cwdLabel}`);
    if (this.recordState !== state) {
      this.recordState = state;
      this.status.className = `status ${state}`;
      const content = document.createElement('span'); content.textContent = label;
      const icon = live ? live.state === 'running' ? LoaderCircle : live.state === 'approval' ? ShieldQuestion
        : live.state === 'input' || live.state === 'approvalInput' ? CircleHelp : live.state === 'error' ? CircleAlert : Circle
        : session.state === 'failed' ? CircleAlert : session.state === 'interrupted' ? CircleStop : Check;
      if(label!=='—')content.prepend(createElement(icon));
      this.status.replaceChildren(content);
    }
    attribute(this.status, 'title', sessionStatusHint(session));
    updateCell(this.cwd, session.cwdLabel, session.cwd);
    updateCell(this.model, session.model || session.provider || '—', [session.provider, session.model].filter(Boolean).join(' · '));
    const detail = statisticsText(session.stats);
    attribute(this.tokens, 'title', detail); attribute(this.tokens, 'aria-label', detail);
    metrics.forEach(([key], i) => text(this.values[i], tokenLabel(session.stats.tokens?.[key] ?? null)));
    updateCell(this.rounds, session.stats.counts ? session.stats.counts.total.toLocaleString() : '—', roundsText(session.stats));
    updateCell(this.duration, durationLabel(session.stats.lastDurationMs), detail);
    updateCell(this.updated, time(session.updatedAt), session.updatedAt ? new Date(session.updatedAt * 1000).toLocaleString() : '更新时间未知');
  }
}

export class SessionTable {
  private rows = new Map<string, SessionRow>();
  constructor(private body: HTMLElement, private scroller: HTMLElement) {}
  update(sessions: Session[], supported: boolean, selectedId?: string, pending: string[] = []): void {
    const focused = document.hasFocus() && this.body.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const { scrollTop, scrollLeft } = this.scroller;
    const visible = new Set(sessions.map(session => session.id));
    for (const [id, row] of this.rows) if (!visible.has(id)) { row.element.remove(); this.rows.delete(id); }
    let next = this.body.firstElementChild;
    for (const session of sessions) {
      let row = this.rows.get(session.id);
      if (!row) { row = new SessionRow(session.id); this.rows.set(session.id, row); }
      row.update(session, supported, selectedId === session.id, pending.includes(session.id));
      if (row.element !== next) this.body.insertBefore(row.element, next);
      next = row.element.nextElementSibling;
    }
    // 重排可能让当前按钮失焦；仅在面板原本持有焦点时恢复，后台刷新不抢编辑器焦点。
    if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
    this.scroller.scrollTop = scrollTop; this.scroller.scrollLeft = scrollLeft;
  }
}
