import * as vscode from 'vscode';
import { columns, maxColumnWidth } from './columns';
import { randomUUID } from 'node:crypto';
import { isViewMessage, type PanelAction, type ViewState } from './types';

export class SessionView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  constructor(private extensionUri: vscode.Uri, private state: () => ViewState, private action: (action: PanelAction) => Promise<void>) {}
  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const webview = view.webview;
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist'), vscode.Uri.joinPath(this.extensionUri, 'resources')] };
    const nonce = randomUUID();
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'sessions.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'sessions.css'));
    webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource};">
<link rel="stylesheet" href="${style}"><style id="column-layout-style" nonce="${nonce}"></style><title>Codex 会话</title></head><body>
<header id="list-header"><div class="summary"><div id="filters" class="filters" role="group" aria-label="会话筛选"></div><select id="filter-select" aria-label="会话筛选"></select><button id="source" class="source" title="配置当前窗口的实时状态监听" aria-label="配置实时状态监听"><span id="source-icon" aria-hidden="true"></span><span id="source-label">本地记录</span></button></div>
<div class="toolbar"><label class="search"><span id="search-icon"></span><input id="search" type="search" placeholder="搜索标题、目录、标签" aria-label="搜索标题、目录、标签"></label><button id="export" class="icon-button" title="导出当前筛选的会话为 CSV" aria-label="导出当前筛选为 CSV"></button><button id="analytics" class="icon-button" title="在编辑区打开会话分析" aria-label="打开会话分析"></button><button id="next" class="icon-button" title="下一条待处理会话" aria-label="下一条待处理会话"></button><button id="refresh" class="icon-button" title="刷新会话" aria-label="刷新会话"></button></div></header>
<div id="organization-tools" class="organization-tools" role="group" aria-label="收藏与标签筛选"><button id="favorites-only" class="organization-filter" aria-pressed="false" title="只显示收藏；待处理队列仍按原优先级排序"><span id="favorites-icon" aria-hidden="true"></span><span>仅收藏</span></button><select id="tag-filter" aria-label="按标签筛选"><option value="">全部标签</option></select><span id="organization-hint">收藏优先 · 标签仅存于本扩展</span></div>
<div id="notice" role="status" hidden></div><main><section id="list"><div id="count" class="match-count" hidden></div><table id="sessions-table" aria-label="Codex 会话列表"><colgroup>${columns.map(column => `<col class="${column.id}-col" data-column="${column.id}">`).join('')}</colgroup><thead><tr>${columns.map(column => `<th scope="col" aria-label="${column.label}" class="${column.id}-cell" data-column="${column.id}" title="${column.help}"><span class="column-label"><span>${column.label}</span>${column.id === 'title' ? '<button id="columns-button" class="column-settings-button" title="配置列（也可右键表头）" aria-label="配置列" aria-haspopup="dialog" aria-expanded="false" aria-controls="column-menu"></button>' : ''}</span><span class="column-resizer" data-resize="${column.id}" role="separator" aria-orientation="vertical" aria-label="调整${column.label}列宽" aria-valuemin="${column.min}" aria-valuemax="${maxColumnWidth}" tabindex="0" title="拖动调整列宽；双击恢复此列默认宽度；方向键微调"></span></th>`).join('')}</tr></thead><tbody id="sessions"></tbody></table><div id="empty" class="empty" hidden><span id="empty-icon" aria-hidden="true"></span><span id="empty-label"></span></div></section><section id="review" hidden aria-label="回合审阅"></section></main>
<div id="column-menu" class="column-menu" role="dialog" aria-label="列设置" hidden></div>
<script nonce="${nonce}" src="${script}"></script></body></html>`;
    const subscription = webview.onDidReceiveMessage(message => {
      if (!isViewMessage(message)) return;
      if (message.action === 'ready') { this.update(); return; }
      void this.action(message);
    });
    view.onDidDispose(() => { subscription.dispose(); if (this.view === view) this.view = undefined; });
    view.onDidChangeVisibility(() => { if (view.visible) void this.action({ action: 'refresh' }); });
    this.update();
  }
  update(): void { if (this.view) void this.view.webview.postMessage({ type: 'state', state: this.state() }); }
}
