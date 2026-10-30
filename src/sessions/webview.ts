import { createElement, Search, RefreshCw, ListTodo, Files, Radio, CircleAlert, Clock3, Inbox, ChartNoAxesCombined, Star, Download } from 'lucide';
import { liveModeLabels } from '../live/protocol';
import { ColumnLayout } from './column-layout';
import { defaultColumnLayout } from './columns';
import { ReviewView } from './review-view';
import { SessionTable } from './table';
import { matchesSessionStatus, matchesSessionFilters, favoritesFirst, type SessionFilter } from './organization';
import type { ViewMessage, ViewState, Session } from './types';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): { query?: string } | undefined; setState(state: unknown): void };
const api = acquireVsCodeApi();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let query = api.getState()?.query ?? '';
type Filter = SessionFilter;
let filter: Filter = 'all';
let onlyFavorites = false, tag = '', scope: number | undefined;
let exportIds: string[] = [];
const pendingOrganization = new Set<string>();
const acknowledgedOrganization = new Set<string>();
let ordered: string[] = [], focusAttention = 0, wasReview = false, listScroll = 0, listScrollLeft = 0;
let sourceMode = '';
const filterLabels: Record<Filter, string> = { all: '全部', active: '进行中', attention: '待处理', review: '待审阅' };
const matches = matchesSessionStatus;
let state: ViewState = { columnLayout: defaultColumnLayout(), liveMode: 'off', sourceAvailable: false, loading: false, supported: true, sessions: [] };
const columnLayout = new ColumnLayout(send);
const detail = new ReviewView($('review'), send);
const table = new SessionTable($('sessions'), document.querySelector('main')!);
function send(message: ViewMessage): void { api.postMessage(message); }
for (const [value, label] of Object.entries(filterLabels)) {
  const button = document.createElement('button'); button.dataset.filter = value;
  const name = document.createElement('span'); name.textContent = label;
  const count = document.createElement('span'); count.className = 'filter-count'; count.textContent = '0';
  button.append(name, count);
  button.addEventListener('click', () => { filter = value as Filter; ordered = []; render(); }); $('filters').append(button);
  const option = document.createElement('option'); option.value = value; option.textContent = label; $('filter-select').append(option);
}
$('filter-select').addEventListener('change', event => { filter = (event.target as HTMLSelectElement).value as Filter; ordered = []; render(); });
$('favorites-icon').append(createElement(Star));
$('favorites-only').addEventListener('click', () => { onlyFavorites = !onlyFavorites; render(); });
$('tag-filter').addEventListener('change', event => { tag = (event.target as HTMLSelectElement).value; render(); });
$('export').append(createElement(Download));
$('export').addEventListener('click', () => {
  if (!exportIds.length || state.exporting || $('export').getAttribute('aria-disabled') === 'true') return;
  $('export').setAttribute('aria-disabled', 'true');
  send({ action: 'export', scope: state.scope ?? 0, ids: [...exportIds] });
});
$('next').append(createElement(ListTodo)); $('next').addEventListener('click', () => send({ action: 'next' }));
$('analytics').append(createElement(ChartNoAxesCombined)); $('analytics').addEventListener('click', () => send({action:'analytics'}));
$('empty-icon').append(createElement(Inbox));
$('search-icon').append(createElement(Search)); $('refresh').append(createElement(RefreshCw));
$<HTMLInputElement>('search').value = query;
$('search').addEventListener('input', event => { query = (event.target as HTMLInputElement).value; api.setState({ query }); render(); });
$('source').addEventListener('click', () => send({ action: 'configureLive' }));
$('refresh').addEventListener('click', () => send({ action: 'refresh' }));
$('sessions').addEventListener('click', event => {
  const organization = (event.target as Element).closest<HTMLButtonElement>('[data-favorite], [data-tags]');
  if (organization) {
    event.stopPropagation();
    const id = organization.dataset.favorite ?? organization.dataset.tags!, row = state.sessions.find(row => row.id === id);
    if (!row || organization.getAttribute('aria-disabled') === 'true' || pendingOrganization.has(id)) return;
    pendingOrganization.add(id); organization.setAttribute('aria-disabled', 'true');
    send(organization.dataset.favorite ? { action: 'favorite', scope: state.scope ?? 0, id, favorite: !row.organization?.favorite } : { action: 'tags', scope: state.scope ?? 0, id });
    return;
  }
  const analysis = (event.target as Element).closest<HTMLElement>('[data-analysis]');
  if (analysis?.dataset.analysis) { event.stopPropagation(); send({action:'analytics',id:analysis.dataset.analysis}); return; }
  const review = (event.target as Element).closest<HTMLElement>('[data-review]');
  if (review?.dataset.review) { event.stopPropagation(); send({ action: 'review', id: review.dataset.review }); return; }
  const row = (event.target as Element).closest<HTMLElement>('tr[data-id]');
  if (row?.dataset.id && state.supported) send({ action: 'switch', id: row.dataset.id });
});
$('sessions').addEventListener('keydown', event => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.session-title')];
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (current >= 0) { event.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))].focus(); }
});
function render(): void {
  if (scope !== state.scope) { scope = state.scope; ordered = []; tag = ''; pendingOrganization.clear(); acknowledgedOrganization.clear(); }
  columnLayout.receive(state.columnLayout, state.columnLayoutAck);
  if (state.review) columnLayout.closeMenu();
  if ((state.focusAttention ?? 0) !== focusAttention) {
    focusAttention = state.focusAttention ?? 0; filter = 'attention'; onlyFavorites = false; tag = ''; query = ''; api.setState({ query }); $<HTMLInputElement>('search').value = ''; ordered = [];
  }
  for (const value of Object.keys(filterLabels) as Filter[]) {
    const count = state.sessions.filter(session => matches(session, value)).length;
    const label = `${filterLabels[value]} ${count}`;
    const button = document.querySelector<HTMLButtonElement>(`[data-filter="${value}"]`)!;
    const badge = button.querySelector<HTMLElement>('.filter-count')!;
    if (badge.textContent !== String(count)) badge.textContent = String(count);
    button.setAttribute('aria-label', `${filterLabels[value]}，${count} 个会话`);
    button.setAttribute('aria-pressed', String(value === filter));
    const option = [...$<HTMLSelectElement>('filter-select').options].find(option => option.value === value)!; option.textContent = label;
  }
  $<HTMLSelectElement>('filter-select').value = filter;
  const visible = state.sessions.filter(item => matches(item, filter));
  const compare = filter === 'attention'
    ? (a: Session, b: Session) => Number(a.workflow?.attention === 'failure') - Number(b.workflow?.attention === 'failure') || (a.workflow?.attentionAt ?? 0) - (b.workflow?.attentionAt ?? 0)
    : (a: Session, b: Session) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
  visible.sort(compare);
  const ids = new Set(visible.map(item => item.id)); ordered = ordered.filter(id => ids.has(id));
  const byId = new Map(visible.map(item => [item.id, item]));
  for (const item of visible) if (!ordered.includes(item.id)) {
    const position = ordered.findIndex(id => compare(item, byId.get(id)!) < 0);
    ordered.splice(position < 0 ? ordered.length : position, 0, item.id);
  }
  const positions = new Map(ordered.map((id, index) => [id, index]));
  const tags = [...new Set(state.sessions.flatMap(row => row.organization?.tags ?? []))].sort((a, b) => a.localeCompare(b));
  // 保留当前标签即使暂时没有会话匹配，避免刷新静默扩大导出范围。
  if (tag && !tags.includes(tag)) tags.push(tag);
  const select = $<HTMLSelectElement>('tag-filter');
  if (JSON.stringify([...select.options].map(option => option.value)) !== JSON.stringify(['', ...tags])) {
    select.replaceChildren(...['', ...tags].map(value => { const option = document.createElement('option'); option.value = value; option.textContent = value || '全部标签'; return option; }));
  }
  select.value = tag;
  $('favorites-only').setAttribute('aria-pressed', String(onlyFavorites));
  const rows = favoritesFirst(visible.filter(item => matchesSessionFilters(item, { status: filter, query, onlyFavorites, tag })).sort((a,b)=>positions.get(a.id)!-positions.get(b.id)!), filter);
  exportIds = rows.map(row => row.id);
  $('export').setAttribute('aria-disabled', String(!rows.length || !!state.exporting));
  $('export').title = state.exporting ? '正在准备 CSV 导出…' : `导出当前筛选的 ${rows.length} 个会话为 CSV`;
  $('organization-hint').textContent = filter === 'attention' ? '待处理仍按原优先级排序' : '收藏优先 · 标签仅存于本扩展';
  $('count').hidden = !query && !onlyFavorites && !tag; $('count').textContent = `匹配 ${rows.length} 条`;
  const mode = state.liveMode ?? 'off';
  $('source-label').textContent = mode === 'off' && !state.sourceAvailable ? '未发现记录' : liveModeLabels[mode];
  $('source').dataset.mode = mode;
  if (sourceMode !== mode) {
    sourceMode = mode;
    const icon = mode === 'connected' ? Radio : mode === 'disconnected' || mode === 'unsupported' ? CircleAlert : mode === 'reload' || mode === 'connecting' ? Clock3 : Files;
    $('source-icon').replaceChildren(createElement(icon));
  }
  $('source').title = mode === 'connected' ? '仅覆盖经过当前窗口后端的状态事件；点击关闭监听' : mode === 'reload' ? '设置已保存，请在任务结束后重载当前窗口' : mode === 'disconnected' ? '监听未连接或已断开，当前显示本地记录；请在任务结束后重载恢复，点击可关闭监听' : '点击配置当前窗口的实时状态监听';
  $('refresh').classList.toggle('loading', state.loading);
  const notice = $('notice');
  const message = state.error ?? (!state.sourceAvailable && !state.loading ? '尚未发现本地会话记录。请检查 Codex 配置目录；无需接管后端启动入口。' : '');
  notice.hidden = !message;
  if (notice.textContent !== message) notice.textContent = message;
  const main = document.querySelector('main')!;
  if (state.review && !wasReview) { listScroll = main.scrollTop; listScrollLeft = main.scrollLeft; }
  $('list').hidden = !!state.review; $('list-header').hidden = !!state.review; $('organization-tools').hidden = !!state.review;
  detail.update(state.review);
  if (!state.review) { table.update(rows, state.supported, state.selectedId, [...new Set([...(state.organizationPending ?? []), ...pendingOrganization])]); if (wasReview) { main.scrollTop = listScroll; main.scrollLeft = listScrollLeft; } }
  wasReview = !!state.review;
  $('empty').hidden = rows.length > 0;
  $('empty-label').textContent = state.loading ? '正在读取会话…' : query ? '没有匹配的会话' : filter === 'attention' && mode !== 'connected' ? '实时等待状态不可用；当前没有其他已确认的待处理项。' : filter === 'review' ? '没有待审阅的新回合' : filter === 'active' && mode !== 'connected' ? '开启实时监听后可查看进行中的会话' : '暂无匹配会话';
}
window.addEventListener('message', event => { if (event.data?.type === 'state') { state = event.data.state;
  for (const id of pendingOrganization) {
    if (state.organizationPending?.includes(id)) acknowledgedOrganization.add(id);
    else if (acknowledgedOrganization.has(id) || !state.sessions.some(row => row.id === id)) { pendingOrganization.delete(id); acknowledgedOrganization.delete(id); }
  }
  render(); } });
send({ action: 'ready' });
