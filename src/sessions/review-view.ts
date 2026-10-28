import { createElement, ArrowLeft, FileDiff, ArrowUpRight, Check, RotateCcw, RefreshCw } from 'lucide';
import type { PanelAction, ReviewDetail } from './types';
import { outcomeLabels, reviewLabels } from './status';
export class ReviewView {
  private signature = '';
  constructor(private root: HTMLElement, private send: (action: PanelAction) => void) {}
  update(detail?: ReviewDetail): void {
    this.root.hidden = !detail;
    if (!detail) { this.signature = ''; return; }
    const signature = JSON.stringify(detail);
    if (signature === this.signature) return;
    this.signature = signature;
    const focus = document.hasFocus() && this.root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.control : undefined;
    this.root.replaceChildren();
    const button = (label: string, icon: Parameters<typeof createElement>[0], action: PanelAction, control: string) => {
      const b = document.createElement('button'); b.className = 'review-button'; b.title = label; b.setAttribute('aria-label', label); b.dataset.control = control;
      b.append(createElement(icon)); b.addEventListener('click', () => this.send(action)); return b;
    };
    const head = document.createElement('div'); head.className = 'review-heading';
    const title = document.createElement('strong'); title.textContent = detail.title; title.title = detail.title;
    const status = document.createElement('span'); status.className = 'review-status';
    status.dataset.status = detail.stale ? 'updated' : detail.status;
    status.textContent = detail.stale ? reviewLabels.updated : reviewLabels[detail.status];
    head.append(button('返回会话列表', ArrowLeft, { action: 'back' }, 'back'), title, status,
      button('打开官方会话', ArrowUpRight, { action: 'switch', id: detail.id }, 'chat'));
    const bar = document.createElement('div'); bar.className = 'review-actions';
    const select = document.createElement('select'); select.setAttribute('aria-label', '选择审阅回合'); select.dataset.control = 'turn';
    for (const turn of detail.turns) { const option = document.createElement('option'); option.value = turn.id; option.textContent = `${turn.label} · ${reviewLabels[turn.status]}`; select.append(option); }
    select.value = detail.turnId; select.addEventListener('change', () => this.send({ action: 'review', id: detail.id, turnId: select.value }));
    const mark = button(detail.status === 'reviewed' ? '撤销审阅' : '标记本轮已审阅', detail.status === 'reviewed' ? RotateCcw : Check,
      { action: 'mark', id: detail.id, turnId: detail.turnId, version: detail.version, reviewed: detail.status !== 'reviewed' }, 'mark');
    const text = document.createElement('span'); text.textContent = detail.status === 'reviewed' ? '撤销审阅' : '标记已审阅'; mark.append(text); mark.disabled = detail.stale; mark.classList.add(detail.status === 'reviewed' ? 'secondary-action' : 'primary-action');
    bar.append(select, button('重新读取本轮', RefreshCw, { action: 'review', id: detail.id, turnId: detail.turnId }, 'reload'), mark);
    const note = document.createElement('p'); note.className = 'review-note'; note.setAttribute('role', 'status');
    note.textContent = `${outcomeLabels[detail.outcome]}${detail.note?` · ${detail.note}`:''}`;
    note.classList.toggle('needs-attention', detail.stale || detail.outcome === 'failed' || detail.outcome === 'interrupted');
    const files = document.createElement('div'); files.className = 'review-files';
    detail.files.forEach((file, index) => {
      const row = document.createElement('div'); row.className = 'review-file';
      const tag = document.createElement('span'); tag.className = `file-kind ${file.kind}`; tag.textContent = { add: '新增', update: '修改', delete: '删除' }[file.kind];
      const open = button('查看本轮已记录补丁', FileDiff, { action: 'patch', id: detail.id, turnId: detail.turnId, version: detail.version, path: file.path }, `patch-${index}`);
      open.classList.add('patch-link');
      // 目录与文件名分层展示，仍保留完整路径与原有打开行为。
      const name = document.createElement('span'); name.className = 'file-path';
      const split = file.label.lastIndexOf('/') + 1;
      const directory = document.createElement('span'); directory.className = 'file-directory'; directory.textContent = file.label.slice(0, split);
      const filename = document.createElement('span'); filename.className = 'file-name'; filename.textContent = file.label.slice(split);
      name.append(directory, filename); name.title = `${file.path}\n${file.operations} 次记录操作 · ${file.status}`; open.append(name); open.disabled = !file.available || detail.stale;
      if (!file.available) open.title = '补丁过大或已不可用，请在官方会话中查看。';
      row.append(tag, open, button('打开当前文件', ArrowUpRight, { action: 'file', id: detail.id, turnId: detail.turnId, version: detail.version, path: file.path }, `file-${index}`)); files.append(row);
    });
    this.root.append(head, bar, note, files);
    if (focus) [...this.root.querySelectorAll<HTMLElement>('[data-control]')].find(el => el.dataset.control === focus)?.focus({ preventScroll: true });
  }
}
