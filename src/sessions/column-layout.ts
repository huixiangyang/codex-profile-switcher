import { createElement, Columns3, RotateCcw } from 'lucide';
import { columns, columnWidth, defaultColumnLayout, maxColumnWidth, resolveColumns, type ColumnId, type ColumnLayoutPreferences } from './columns';
import type { PanelAction } from './types';

interface Resize { id: ColumnId; before: ColumnLayoutPreferences; widths: Partial<Record<ColumnId, number>>; initial: number; x: number; pointer?: number; changed: boolean }
export class ColumnLayout {
  private preferences = defaultColumnLayout();
  private confirmed = defaultColumnLayout();
  private pending?: string;
  private resize?: Resize;
  private menuPoint?: { x: number; y: number };
  private returnFocus?: HTMLElement;
  private checks = new Map<ColumnId, HTMLInputElement>();
  private handles = new Map<ColumnId, HTMLElement>();
  private mode = document.createElement('p');
  private button = document.getElementById('columns-button') as HTMLButtonElement;
  private menu = document.getElementById('column-menu')!;
  private sheet = document.getElementById('column-layout-style')!;
  private main = document.querySelector('main')!;
  constructor(private send: (action: PanelAction) => void) {
    this.button.append(createElement(Columns3));
    this.button.addEventListener('click', () => this.menu.hidden ? this.openMenu(this.button.getBoundingClientRect().left, this.button.getBoundingClientRect().bottom, this.button) : this.closeMenu(true));
    const heading = document.createElement('strong'); heading.textContent = '列显示'; heading.className = 'column-menu-heading';
    this.mode.className = 'column-menu-mode';
    const options = document.createElement('div'); options.className = 'column-menu-options';
    for (const column of columns) {
      const label = document.createElement('label'); label.className = 'column-option';
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = column.id; input.disabled = column.id === 'title';
      const text = document.createElement('span'); text.textContent = column.label;
      label.append(input, text); if (input.disabled) { const locked = document.createElement('small'); locked.textContent = '固定'; label.append(locked); }
      options.append(label); this.checks.set(column.id, input);
      input.addEventListener('change', () => {
        const visible = new Set(this.resolved().visible);
        if (input.checked) visible.add(column.id); else visible.delete(column.id);
        this.commit({ ...this.preferences, visible: columns.filter(c => visible.has(c.id)).map(c => c.id) });
      });
      const handle = document.querySelector<HTMLElement>(`[data-resize="${column.id}"]`)!;
      this.handles.set(column.id, handle);
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault(); this.closeMenu(false); this.begin(column.id, event.clientX, event.pointerId);
        handle.setPointerCapture(event.pointerId); handle.focus({ preventScroll: true });
      });
      handle.addEventListener('pointermove', event => {
        if (this.resize?.pointer !== event.pointerId) return;
        this.adjust(this.resize.initial + event.clientX - this.resize.x);
      });
      handle.addEventListener('pointerup', event => {
        if (this.resize?.pointer !== event.pointerId) return;
        this.finish(); if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      });
      handle.addEventListener('pointercancel', () => this.cancel());
      handle.addEventListener('lostpointercapture', () => { if (this.resize?.pointer !== undefined) this.cancel(); });
      handle.addEventListener('dblclick', event => {
        event.preventDefault(); const widths = { ...this.preferences.widths }; delete widths[column.id]; this.commit({ ...this.preferences, widths });
      });
      handle.addEventListener('keydown', event => {
        if (event.key === 'Escape') { this.cancel(); event.preventDefault(); return; }
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); if (!this.resize) this.begin(column.id);
        const width = this.resize!.widths[column.id]!;
        this.adjust(event.key === 'Home' ? column.min : event.key === 'End' ? maxColumnWidth : width + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 32 : 8));
      });
      handle.addEventListener('keyup', event => { if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key) && this.resize?.pointer === undefined) this.finish(); });
      handle.addEventListener('blur', () => { if (this.resize?.pointer === undefined) this.finish(); });
    }
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'column-reset';
    const resetText = document.createElement('span'); resetText.textContent = '恢复默认布局'; reset.append(createElement(RotateCcw), resetText);
    reset.addEventListener('click', () => { this.commit(defaultColumnLayout()); this.closeMenu(true); });
    this.menu.append(heading, this.mode, options, reset);
    const head = document.querySelector('thead')!;
    head.addEventListener('contextmenu', event => { event.preventDefault(); this.openMenu(event.clientX, event.clientY, event.target instanceof HTMLElement && event.target.tabIndex >= 0 ? event.target : this.button); });
    head.addEventListener('keydown', event => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      event.preventDefault(); const target = event.target as HTMLElement, rect = target.getBoundingClientRect(); this.openMenu(rect.left, rect.bottom, target);
    });
    document.addEventListener('pointerdown', event => { if (!this.menu.contains(event.target as Node) && !this.button.contains(event.target as Node)) this.closeMenu(false); });
    this.menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); this.closeMenu(true); }
      if (event.key !== 'Tab') return;
      const targets = [...this.menu.querySelectorAll<HTMLElement>('input:not(:disabled),button')];
      if (event.shiftKey && document.activeElement === targets[0]) { event.preventDefault(); targets.at(-1)!.focus(); }
      else if (!event.shiftKey && document.activeElement === targets.at(-1)) { event.preventDefault(); targets[0].focus(); }
    });
    window.addEventListener('keydown', event => { if (event.key === 'Escape' && this.resize) this.cancel(); });
    window.addEventListener('blur', () => { this.closeMenu(false); this.cancel(); });
    window.addEventListener('resize', () => { this.closeMenu(false); this.cancel(); this.apply(); });
    new ResizeObserver(() => this.apply()).observe(this.main);
    this.apply();
  }
  receive(layout: ColumnLayoutPreferences, ack?: string): void {
    this.confirmed = structuredClone(layout);
    if (this.pending && this.pending !== ack) return;
    this.pending = undefined;
    if (this.resize) return;
    this.preferences = structuredClone(layout); this.apply();
  }
  private resolved() {
    const style = getComputedStyle(this.main);
    const available = this.main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return resolveColumns(this.resize ? { ...this.preferences, widths: this.resize.widths } : this.preferences, innerWidth, available);
  }
  private apply(): void {
    const result = this.resolved();
    // 只有枚举列名及有界数字进入 nonce 样式，不允许用户提供 CSS 或选择器。
    let css = `#sessions-table{width:${result.width}px;min-width:0;}`;
    for (const column of columns) {
      const visible = result.visible.includes(column.id), width = result.widths[column.id] ?? column.min;
      css += visible ? `#sessions-table col[data-column="${column.id}"]{width:${width}px;}` : `#sessions-table [data-column="${column.id}"]{display:none;}`;
      this.checks.get(column.id)!.checked = visible;
      this.handles.get(column.id)!.setAttribute('aria-valuenow', String(width));
      this.handles.get(column.id)!.setAttribute('aria-valuetext', `${width} 像素`);
      this.handles.get(column.id)!.title = `${column.label}：${width}px（最小 ${column.min}px）。拖动调整，双击恢复此列默认宽度；方向键微调。`;
    }
    this.mode.textContent = this.preferences.visible === null ? '默认：随面板宽度收起辅助列' : '自定义：所选列保持显示';
    if (this.menuPoint) {
      const x = Math.max(8, Math.min(this.menuPoint.x, innerWidth - this.menu.offsetWidth - 8));
      const y = Math.max(8, Math.min(this.menuPoint.y, innerHeight - this.menu.offsetHeight - 8));
      css += `#column-menu{left:${x}px;top:${y}px;}`;
    }
    if (this.sheet.textContent !== css) this.sheet.textContent = css;
  }
  private commit(layout: ColumnLayoutPreferences): void {
    this.preferences = structuredClone(layout); this.pending = crypto.randomUUID(); this.apply();
    this.send({ action: 'layout', layout: structuredClone(layout), requestId: this.pending });
  }
  private begin(id: ColumnId, x = 0, pointer?: number): void {
    const result = this.resolved();
    // 拖动时固定其他可见列，防止自动填充的标题列反向移动，造成把手跟不上指针。
    this.resize = { id, before: structuredClone(this.preferences), widths: { ...this.preferences.widths, ...Object.fromEntries(Object.entries(result.widths).map(([id, width]) => [id, columnWidth(id as ColumnId, width)])) }, initial: result.widths[id]!, x, pointer, changed: false };
    document.body.classList.add('resizing-columns');
  }
  private adjust(width: number): void {
    if (!this.resize) return;
    const next = columnWidth(this.resize.id, width); this.resize.widths[this.resize.id] = next; this.resize.changed = next !== this.resize.initial; this.apply();
  }
  private finish(): void {
    const drag = this.resize; if (!drag) return;
    this.resize = undefined; document.body.classList.remove('resizing-columns');
    if (drag.changed) this.commit({ ...drag.before, widths: drag.widths }); else { this.preferences = this.pending ? drag.before : this.confirmed; this.apply(); }
  }
  private cancel(): void {
    if (!this.resize) return;
    const drag = this.resize;
    this.preferences = this.pending ? drag.before : this.confirmed;
    this.resize = undefined;
    const handle = this.handles.get(drag.id)!;
    if (drag.pointer !== undefined && handle.hasPointerCapture(drag.pointer)) handle.releasePointerCapture(drag.pointer);
    document.body.classList.remove('resizing-columns'); this.apply();
  }
  private openMenu(x: number, y: number, from: HTMLElement): void {
    this.cancel(); this.returnFocus = from; this.menuPoint = { x, y }; this.menu.hidden = false; this.button.setAttribute('aria-expanded', 'true'); this.apply();
    this.menu.querySelector<HTMLInputElement>('input:not(:disabled)')!.focus({ preventScroll: true });
  }
  closeMenu(restoreFocus = false): void {
    if (this.menu.hidden) return;
    this.menu.hidden = true; this.menuPoint = undefined; this.button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) (this.returnFocus?.getClientRects().length ? this.returnFocus : this.button).focus({ preventScroll: true });
  }
}
