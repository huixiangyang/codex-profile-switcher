import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { isAnalysisMessage, type AnalysisAction, type AnalysisState } from './analytics';

export function analysisHtml(webview: vscode.Webview, extension: vscode.Uri): string {
  const nonce = randomUUID();
  const uri = (folder: string, file: string) => webview.asWebviewUri(vscode.Uri.joinPath(extension, folder, file));
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource};">
<link rel="stylesheet" href="${uri('resources','analytics.css')}"><title>会话分析</title></head><body>
<header class="topbar"><button id="overview" class="brand" title="返回工作区总览"></button><span id="workspace"></span><div class="top-actions"><span id="freshness" role="status"></span><button id="refresh" class="icon-button" aria-label="刷新统计" title="刷新统计"></button></div></header>
<main><div id="notice" role="status" hidden></div><section id="overview-page">
<div class="scope-bar"><span id="scope-summary" class="subtle"></span><label class="search"><span id="search-icon"></span><input id="query" type="search" placeholder="搜索会话、目录" aria-label="搜索分析会话"></label><select id="directory" aria-label="按工作目录筛选"><option value="">全部工作目录</option></select></div>
<div id="overview-content"></div></section><section id="detail-page" hidden></section></main>
<script nonce="${nonce}" src="${uri('dist','analytics.js')}"></script></body></html>`;
}

/** 每个 VS Code 窗口只保留一个分析标签；普通会话切换仍只打开官方侧栏。 */
export class AnalysisPanel {
  private panel?: vscode.WebviewPanel;
  private selectedId?: string;
  constructor(private extension: vscode.Uri, private state: (id?: string) => AnalysisState,
    private action: (message: AnalysisAction) => Promise<void>) {}
  open(id?: string): void {
    this.selectedId = id;
    if (this.panel) { this.panel.reveal(this.panel.viewColumn, false); this.update(); return; }
    const panel = vscode.window.createWebviewPanel('codexSessions.analytics', '会话分析', vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extension,'dist'), vscode.Uri.joinPath(this.extension,'resources')] });
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(this.extension, 'resources', 'analytics.svg');
    panel.webview.html = analysisHtml(panel.webview, this.extension);
    const messages = panel.webview.onDidReceiveMessage(message => {
      if (!isAnalysisMessage(message)) return;
      if (message.action === 'ready') this.update();
      else if (message.action === 'overview') { this.selectedId = undefined; this.update(); }
      else if (message.action === 'detail') {
        if (this.state().sessions.some(row => row.id === message.id)) { this.selectedId = message.id; this.update(); }
      } else void this.action(message);
    });
    const visibility = panel.onDidChangeViewState(() => { if (panel.visible) void this.action({action:'refresh'}); });
    panel.onDidDispose(() => { messages.dispose(); visibility.dispose(); if (this.panel === panel) { this.panel = undefined; this.selectedId = undefined; } });
    this.update();
  }
  resetSelection(): void { this.selectedId = undefined; }
  update(): void {
    if (this.panel?.visible) void this.panel.webview.postMessage({type:'analysis',state:this.state(this.selectedId)});
  }
  dispose(): void { this.panel?.dispose(); this.panel = undefined; }
}
