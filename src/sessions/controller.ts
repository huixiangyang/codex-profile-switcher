import * as vscode from 'vscode';
import path from 'node:path';
import { LiveSessions } from '../live/channel';
import type { LiveMode } from '../live/protocol';
import { canonicalPath } from './catalog';
import { ColumnLayoutSettings } from './columns';
import { SessionOrganization, normalizeTag } from './organization';
import { exportSessionsCsv } from './export';
import { AnalysisPanel } from './analytics-panel';
import type { AnalysisState, AnalysisSession, AnalysisChange } from './analytics';
import { SessionWorkflow } from './workflow';
import { SessionReview, reviewFileTarget } from './review';
import { evidenceVersion, maxPatchBytes, type TurnSummary } from './turns';
import { LocalSessionRecords } from './records';
import { SessionView } from './view';
import { openSession, supportsNavigation, navigationError } from './navigation';
import type { PanelAction, Session, ViewState, ReviewDetail } from './types';

export class SessionPanel {
  private source = '';
  private workflow: SessionWorkflow;
  private columnLayout: ColumnLayoutSettings;
  private organization: SessionOrganization;
  private organizationPending = new Set<string>();
  private exporting = false;
  private reviewer = new SessionReview();
  private reviewSelection?: { id: string; turn: TurnSummary };
  private focusAttention = 0;
  private sessions: Session[] = [];
  private selectedId?: string;
  private sourceAvailable = false;
  private loading = false;
  private error?: string;
  private generation = 0;
  private refreshTask?: Promise<void>;
  private refreshAgain = false;
  private timer?: NodeJS.Timeout;
  private poll?: NodeJS.Timeout;
  private navigation: Promise<void> = Promise.resolve();
  private disposed = false;
  private watcher?: vscode.FileSystemWatcher;
  private records?: LocalSessionRecords;
  private view: SessionView;
  private analytics: AnalysisPanel;
  constructor(private context: vscode.ExtensionContext, private home: () => string, readonly live = new LiveSessions(), private liveMode: () => LiveMode = () => 'off') {
    this.workflow = new SessionWorkflow(context.workspaceState);
    this.columnLayout = new ColumnLayoutSettings(context.workspaceState);
    this.organization = new SessionOrganization(context.workspaceState);
    this.view = new SessionView(context.extensionUri, () => this.snapshot(), action => this.run(action));
    this.analytics = new AnalysisPanel(context.extensionUri, id => this.analysisSnapshot(id), action => this.run(action, async () => {
      if (action.action === 'review' && this.reviewSelection?.id === action.id && this.reviewSelection.turn.id === action.turnId)
        await vscode.commands.executeCommand('codexSessions.list.focus');
    }));
  }
  private activeLive(): LiveSessions | undefined { return ['connected', 'disconnected'].includes(this.liveMode()) ? this.live : undefined; }
  private summaryRows(): Session[] {
    const live = this.activeLive();
    return this.sessions.map(session => ({ ...session, turns: [], organization: this.organization.read(this.source, session.id), live: live?.entries.get(session.id), workflow: this.workflow.state(this.source, session, live) }));
  }
  private snapshot(): ViewState {
    return { scope: this.generation, organizationPending: this.sessions.filter(row => this.organizationPending.has(`${this.generation}:${row.id}`)).map(row => row.id), exporting: this.exporting, columnLayout: this.columnLayout.layout, columnLayoutAck: this.columnLayout.ack, liveMode: this.liveMode(), sourceAvailable: this.sourceAvailable, loading: this.loading, error: this.error ?? this.organization.error ?? this.columnLayout.error ?? navigationError(),
      supported: supportsNavigation(), selectedId: this.selectedId, focusAttention: this.focusAttention, review: this.reviewDetail(),
      sessions: this.summaryRows() };
  }
  private analysisSnapshot(id?: string): AnalysisState {
    const sessions: AnalysisSession[] = this.summaryRows().map(({turns: _turns, ...row}) => row);
    const record = this.sessions.find(row => row.id === id), session = sessions.find(row => row.id === id);
    const turns = record?.turns.map((turn, index) => {
      const changes=new Map<string,AnalysisChange>(),cwd=turn.cwd??record.cwd;
      // 同一文件的同类操作合并计数，新增、修改、删除仍保留各自的记录。
      for(const item of turn.items)for(const file of item.files){
        const fullPath=path.resolve(cwd,file.path),key=JSON.stringify([fullPath,file.kind,item.status]),old=changes.get(key);
        changes.set(key,{path:fullPath,label:path.relative(cwd,fullPath)||path.basename(fullPath),kind:file.kind,status:item.status,operations:(old?.operations??0)+1});
      }
      return {id:turn.id,ordinal:index+1,startedAt:turn.startedAt,endedAt:turn.endedAt,outcome:turn.outcome,durationMs:turn.durationMs,
        liveState:turn.outcome==='unresolved'?this.activeLive()?.turnState(record.id,turn.id):undefined,
        files:new Set([...changes.values()].map(file=>file.path)).size,operations:turn.items.reduce((n,item)=>n+item.files.length,0),changes:[...changes.values()],
        review:this.workflow.status(this.source,record.id,turn),canReview:turn.outcome!=='unresolved'};
    }) ?? [];
    return {scope:this.generation,workspace:(vscode.workspace.workspaceFolders ?? []).map(folder=>path.basename(folder.uri.fsPath)).join(' / '),
      updatedAt:Date.now(),loading:this.loading,error:this.error??navigationError(),supported:supportsNavigation(),sessions,selectedId:id,
      detail:record && session ? {session,turns,recordedFiles:new Set(record.turns.flatMap(turn=>turn.items.flatMap(item=>item.files.map(file=>path.resolve(turn.cwd ?? record.cwd,file.path))))).size} : undefined};
  }
  private reviewDetail(): ReviewDetail | undefined {
    const selected = this.reviewSelection, session = this.sessions.find(row => row.id === selected?.id);
    if (!selected || !session) return;
    const turns = this.workflow.turns(session, this.activeLive()).filter(t => t.outcome !== 'unresolved');
    const current = turns.find(turn => turn.id === selected.turn.id);
    const turn = selected.turn, version = evidenceVersion(turn), stale = !current || evidenceVersion(current) !== version;
    const files = new Map<string, ReviewDetail['files'][number]>();
    const tooLarge = turn.items.reduce((sum, item) => sum + item.bytes, 0) > maxPatchBytes;
    for (const item of turn.items) for (const file of item.files) {
      const old = files.get(file.path);
      const recorded = session.turns.find(t => t.id === turn.id)?.items.some(i => i.fingerprint === item.fingerprint);
      const available = !tooLarge && (!!recorded || !!this.live.patches.get(item.fingerprint)?.patches.length);
      files.set(file.path, { ...file, label: path.relative(turn.cwd ?? session.cwd, path.resolve(turn.cwd ?? session.cwd, file.path)) || path.basename(file.path), operations: (old?.operations ?? 0) + 1, status: item.status, available: available && (old?.available ?? true) });
    }
    return { id: session.id, title: session.title, turnId: turn.id, version, stale, outcome: turn.outcome,
      status: this.workflow.status(this.source, session.id, current ?? turn),
      turns: turns.map(t => ({ id: t.id, label: `${t.endedAt ? new Date(t.endedAt * 1000).toLocaleString() : '结束时间未知'} · ${t.id.slice(-6)}`, status: this.workflow.status(this.source, session.id, t) })),
      files: [...files.values()], note: stale ? '内容已更新，请重新读取。' : tooLarge ? '补丁超过 512 KiB，请在 Codex 侧栏查看。' : !turn.items.length ? '没有文件变更记录，可在 Codex 侧栏查看回复。'
        : session.stats.incomplete ? '部分历史记录不可用。' : '' };
  }
  async start(): Promise<void> {
    this.context.subscriptions.push(vscode.window.registerWebviewViewProvider('codexSessions.list', this.view),
      this.live.subscribe(() => { this.update(); this.scheduleRefresh(); }),
      this.live.onEvent(event => {
        if (this.source && this.liveMode() === 'connected' && event.type === 'turn') this.workflow.observed(this.source, event.id, event.turn.id);
      }),
      vscode.workspace.registerTextDocumentContentProvider('codex-session-review', this.reviewer));
    for (const action of ['open', 'refresh', 'next'] as const) this.context.subscriptions.push(
      vscode.commands.registerCommand(`codexSessions.${action}`, () => this.run({ action }))
    );
    this.context.subscriptions.push(
      vscode.commands.registerCommand('codexSessions.analytics', (id?: unknown) => this.run({action:'analytics', ...(typeof id==='string' && id ? {id} : {})})),
      vscode.commands.registerCommand('codexSessions.review', (id?: string) => this.run({ action: 'review', id: id ?? this.selectedId ?? '' })),
      vscode.commands.registerCommand('codexSessions.switch', (id: unknown) => {
        if (typeof id === 'string' && id) return this.run({ action: 'switch', id });
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.invalidate()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('codexProfiles.codexHome')) this.invalidate();
      })
    );
    // 不等待首次文件索引，避免阻塞原有 Profile 窗口启动配置服务。
    void this.refresh();
    this.poll = setInterval(() => { void this.refresh(); }, 15000);
  }
  update(): void { this.view.update(); this.analytics.update(); }
  private resetSource(): void {
    this.watcher?.dispose(); this.watcher = undefined;
    this.records?.dispose(); this.records = undefined;
    this.source = '';
    this.sessions = []; this.selectedId = undefined; this.reviewSelection = undefined; this.sourceAvailable = false;
    this.analytics.resetSelection();
  }
  private invalidate(): void {
    this.generation++; this.resetSource(); this.error = undefined; this.update();
    void this.refresh();
  }
  private async run(action: PanelAction, after?: () => Promise<void>): Promise<void> {
    if (this.disposed) return;
    try { await this.action(action); if (!this.disposed) await after?.(); } catch (error) { void vscode.window.showErrorMessage(`Codex 会话：${(error as Error).message}`); if (!this.disposed) this.update(); }
  }
  private scheduleRefresh(): void {
    if (this.timer || this.disposed) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, 750);
  }
  private refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.refreshAgain = true;
    // 同时只允许一个读取任务；期间的刷新合并为下一轮，命令等待最后一轮完成。
    this.refreshTask ??= this.drainRefreshes().finally(() => { this.refreshTask = undefined; });
    return this.refreshTask;
  }
  private async drainRefreshes(): Promise<void> {
    while (this.refreshAgain && !this.disposed) { this.refreshAgain = false; await this.load(); }
  }
  private async load(): Promise<void> {
    if (this.disposed) return;
    if (vscode.env.remoteName || process.platform === 'win32' || !vscode.workspace.isTrusted) {
      this.error = !vscode.workspace.isTrusted ? '信任当前工作区后，才能读取本地会话记录。' : '目前支持本机 macOS / Linux。';
      this.update(); return;
    }
    this.loading = true; this.error = undefined; this.update();
    let generation = this.generation;
    try {
      const roots = (vscode.workspace.workspaceFolders ?? []).filter(folder => folder.uri.scheme === 'file').map(folder => folder.uri.fsPath);
      if (!roots.length) { this.sessions = []; this.sourceAvailable = false; this.error = '请先打开文件夹或工作区。'; return; }
      const home = this.home();
      if (!this.records || this.records.home !== home) {
        if (this.records) generation = ++this.generation;
        this.resetSource();
        const source = await canonicalPath(home);
        if (this.disposed || generation !== this.generation) return;
        this.source = source;
        this.records = new LocalSessionRecords(home);
        this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(home), '{sessions/**/*.jsonl,session_index.jsonl}'));
        this.watcher.onDidCreate(() => this.scheduleRefresh());
        this.watcher.onDidChange(() => this.scheduleRefresh());
        this.watcher.onDidDelete(() => this.scheduleRefresh());
      }
      const result = await this.records.list(roots);
      if (this.disposed || generation !== this.generation) return;
      for (const id of result.resetIds ?? []) this.live.forgetTurns(id);
      this.sessions = result.sessions; this.sourceAvailable = result.sourceAvailable; this.error = result.warning;
      if (result.sourceAvailable) {
        try { await this.workflow.enroll(this.source, this.sessions.map(session => ({ ...session, turns: this.workflow.turns(session, this.activeLive()) })));  }
        catch (error) { this.error = `审阅状态未保存：${(error as Error).message}`; }
      }
      if (this.selectedId && !this.sessions.some(session => session.id === this.selectedId)) this.selectedId = undefined;
    } catch (error) {
      if (!this.disposed && generation === this.generation) { this.error = (error as Error).message; this.sourceAvailable = false; this.sessions = []; }
    } finally {
      this.loading = false;
      if (!this.disposed && generation === this.generation) this.update();
    }
  }
  private async action(message: PanelAction): Promise<void> {
    if (message.action === 'open') { await vscode.commands.executeCommand('codexSessions.list.focus'); await this.refresh(); }
    else if (message.action === 'analytics') {
      if (message.id && !this.sessions.some(row => row.id === message.id)) throw new Error('请选择当前工作区中的会话。');
      this.analytics.open(message.id); await this.refresh();
    }
    else if (message.action === 'configureLive') await vscode.commands.executeCommand('codexSessions.configureLive');
    else if (message.action === 'layout') { await this.columnLayout.save(message.layout, message.requestId); if (!this.disposed) this.update(); }
    else if (message.action === 'favorite' || message.action === 'tags') {
      this.validateScope(message.scope);
      if (!this.sessions.some(row => row.id === message.id)) throw new Error('会话不在当前工作区，请刷新列表。');
      const key = `${message.scope}:${message.id}`, source = this.source;
      if (this.organizationPending.has(key)) return;
      this.organizationPending.add(key); this.update();
      try {
        if (message.action === 'favorite') await this.organization.update(source, message.id, { favorite: message.favorite });
        else await this.editTags(source, message.scope, message.id);
      } finally { this.organizationPending.delete(key); if (!this.disposed) this.update(); }
    }
    else if (message.action === 'export') {
      this.validateScope(message.scope);
      if (this.exporting) return;
      const byId = new Map(this.summaryRows().map(row => [row.id, row]));
      if (!message.ids.length || new Set(message.ids).size !== message.ids.length || message.ids.some(id => !byId.has(id)))
        throw new Error('导出范围已变化，请重新筛选后导出。');
      // 只从宿主已校验的当前来源复制数据；后续刷新和弹窗不能改变这次导出的数值。
      const rows = structuredClone(message.ids.map(id => byId.get(id)!)), source = this.source;
      this.exporting = true; this.update();
      try { await exportSessionsCsv(rows, () => !this.disposed && message.scope === this.generation && source === this.source); }
      finally { this.exporting = false; if (!this.disposed) this.update(); }
    }
    else if (message.action === 'refresh') await this.refresh();
    else if (message.action === 'back') { this.reviewSelection = undefined; this.update(); }
    else if (message.action === 'next') {
      const rows = this.sessions.map(session => ({ session, state: this.workflow.state(this.source, session, this.activeLive()) }))
        .filter(row => row.state.attention).sort((a, b) => Number(a.state.attention === 'failure') - Number(b.state.attention === 'failure') || a.state.attentionAt - b.state.attentionAt);
      if (!rows.length) { void vscode.window.showInformationMessage('当前没有已确认的待处理会话。'); return; }
      const index = rows.findIndex(row => row.session.id === this.selectedId);
      this.reviewSelection = undefined; this.focusAttention++;
      await this.action({ action: 'switch', id: rows[(index + 1) % rows.length].session.id });
    } else if (message.action === 'review') {
      const session = this.sessions.find(row => row.id === message.id);
      if (!session) throw new Error('请选择当前工作区中的会话。');
      const turns = this.workflow.turns(session, this.activeLive());
      const turn = message.turnId ? turns.find(t => t.id === message.turnId) : this.workflow.pending(this.source, session, this.activeLive())[0] ?? turns.filter(t => t.outcome !== 'unresolved').at(-1);
      if (!turn || turn.outcome === 'unresolved') throw new Error('这轮还没有结果，暂时不能审阅。');
      this.reviewSelection = { id: session.id, turn: structuredClone(turn) }; this.update();
    } else if (message.action === 'mark' || message.action === 'patch' || message.action === 'file') {
      const selected = this.reviewSelection, session = this.sessions.find(row => row.id === message.id);
      if (!session || selected?.id !== message.id || selected.turn.id !== message.turnId || evidenceVersion(selected.turn) !== message.version) throw new Error('审阅目标已变化，请重新打开所选回合。');
      const turn = this.workflow.turns(session, this.activeLive()).find(turn => turn.id === message.turnId);
      if (!turn || evidenceVersion(turn) !== message.version) throw new Error('本轮证据已更新，请重新读取后再操作。');
      if (message.action === 'mark') {
        await this.workflow.mark(this.source, session.id, turn, message.reviewed); this.update();
      } else {
        if (!turn.items.some(item => item.files.some(file => file.path === message.path))) throw new Error('文件不属于所选回合。');
        if (message.action === 'file') {
          const roots = (vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file').map(f => f.uri.fsPath);
          const file = turn.items.flatMap(item => item.files).find(file => file.path === message.path)!;
          const generation = this.generation;
          const target = await reviewFileTarget(turn.cwd ?? session.cwd, file.movePath ?? file.path, roots);
          if (generation === this.generation) await vscode.window.showTextDocument(vscode.Uri.file(target), { preview: true });
        } else {
          if (turn.items.reduce((sum, item) => sum + item.bytes, 0) > maxPatchBytes) throw new Error('本轮补丁超过 512 KiB 预览限制。');
          const source = this.source, generation = this.generation;
          const bodies = await this.records!.patches(session.id, turn.id);
          if (generation !== this.generation || source !== this.source) return;
          for (const item of turn.items) { const body = this.live.patches.get(item.fingerprint); if (body) bodies.push(body); }
          await this.reviewer.open(selected.turn, message.path, bodies);
        }
      }
    } else if (message.action === 'switch') {
      const { id } = message, generation = this.generation;
      this.navigation = this.navigation.catch(() => {}).then(async () => {
        if (this.disposed || generation !== this.generation) return;
        if (!this.sessions.some(session => session.id === id)) throw new Error('会话不在当前工作区，请刷新列表。');
        await openSession(id);
        if (this.disposed || generation !== this.generation) return;
        this.selectedId = id;
        await this.workflow.opened(this.source, this.sessions.find(session => session.id === id)!, this.activeLive());
        this.update();
      });
      await this.navigation;
    }
  }
  private validateScope(scope: number): void {
    if (scope !== this.generation || !this.source || !this.sourceAvailable) throw new Error('会话来源已变化，请等待列表刷新后重试。');
  }
  private async editTags(source: string, scope: number, id: string): Promise<void> {
    const current = this.organization.read(source, id).tags;
    const tags = [...new Set(this.sessions.flatMap(row => this.organization.read(source, row.id).tags))].sort((a, b) => a.localeCompare(b));
    const items = [
      { label: '$(add) 新建标签…', description: '仅保存在本扩展中', tag: undefined as string | undefined },
      ...tags.map(tag => ({ label: tag, description: current.includes(tag) ? '已添加 · 选择移除' : '选择添加', tag }))
    ];
    const picked = await vscode.window.showQuickPick(items, { title: '会话标签', placeHolder: '选择已有标签进行添加／移除，或新建标签', matchOnDescription: true });
    if (!picked || this.disposed || scope !== this.generation || source !== this.source || !this.sessions.some(row => row.id === id)) return;
    let tag = picked.tag;
    if (tag === undefined) {
      const value = await vscode.window.showInputBox({ title: '新建会话标签', prompt: '最多 32 个字符，每个会话最多 10 个标签；仅存于本扩展', placeHolder: '例如：待跟进',
        validateInput: value => { try { normalizeTag(value); return undefined; } catch (error) { return (error as Error).message; } } });
      if (value === undefined || this.disposed || scope !== this.generation || source !== this.source || !this.sessions.some(row => row.id === id)) return;
      tag = normalizeTag(value);
      await this.organization.update(source, id, { addTag: tag });
    } else await this.organization.update(source, id, current.includes(tag) ? { removeTag: tag } : { addTag: tag });
  }
  async dispose(): Promise<void> {
    this.disposed = true; this.generation++;
    clearTimeout(this.timer); clearInterval(this.poll); this.resetSource();
    await this.refreshTask;
    await this.live.dispose(); this.reviewer.dispose(); await this.workflow.flush(); await this.columnLayout.flush(); await this.organization.flush();
    this.analytics.dispose();
  }
}
