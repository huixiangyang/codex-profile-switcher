import test from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { state } from './vscode-stub';
import { SessionPanel } from '../src/sessions/controller';
import { SessionView } from '../src/sessions/view';
import { LocalSessionRecords, type RecordList } from '../src/sessions/records';
import type { ViewState } from '../src/sessions/types';

test('配置切换后旧读取失败不覆盖新状态；刷新命令等待合并后的读取', async t => {
  const snapshots: ViewState[] = [];
  let onConfiguration!: (event: vscode.ConfigurationChangeEvent) => void;
  let rejectRead!: (error: Error) => void;
  let reading!: () => void;
  const started = new Promise<void>(resolve => { reading = resolve; });
  t.mock.method(vscode.workspace, 'onDidChangeConfiguration', (listener: typeof onConfiguration) => {
    onConfiguration = listener; return { dispose() {} };
  });
  t.mock.method(SessionView.prototype, 'update', function(this: unknown) {
    // 只观察送往 Webview 的状态快照，不修改控制器内部状态。
    snapshots.push((this as { state: () => ViewState }).state());
  });
  t.mock.method(LocalSessionRecords.prototype, 'list', function(this: LocalSessionRecords) {
    if (this.home === '/old-home') {
      reading(); return new Promise<RecordList>((_resolve, reject) => { rejectRead = reject; });
    }
    return Promise.resolve({ sessions: [], sourceAvailable: true });
  });
  let home = '/old-home';
  const panel = new SessionPanel({ extensionUri: vscode.Uri.file('/extension'), subscriptions: [], workspaceState: {get:()=>undefined,update:async()=>{}} } as unknown as vscode.ExtensionContext, () => home);
  t.after(() => panel.dispose());
  await panel.start(); await started;
  home = '/new-home';
  onConfiguration({ affectsConfiguration: () => true });
  const refreshed = state.commands.get('codexSessions.refresh')!();
  rejectRead(new Error('旧目录读取失败'));
  await refreshed;
  assert.ok(!snapshots.some(snapshot => snapshot.error === '旧目录读取失败'));
  assert.equal(snapshots.at(-1)?.sourceAvailable, true);
  assert.equal(snapshots.at(-1)?.loading, false);
});
