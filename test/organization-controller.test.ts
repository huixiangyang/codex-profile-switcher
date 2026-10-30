import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { SessionPanel } from '../src/sessions/controller';
import { SessionView } from '../src/sessions/view';
import { LocalSessionRecords } from '../src/sessions/records';
import { isViewMessage, type PanelAction, type Session, type ViewState } from '../src/sessions/types';
import { state as host } from './vscode-stub';

const row = (id: string): Session => ({ id, title: `private ${id}`, cwd: '/test/project', cwdLabel: 'project', createdAt: 1, updatedAt: 2,
  model: 'model', provider: 'provider', state: 'finished', stateAt: 2, stateReason: 'lifecycle', turns: [],
  stats: { tokens: {total: 42, input: 40, output: 2, cachedInput: 0, cacheWriteInput: null, reasoningOutput: null},
    counts: null, lastDurationMs: null, recordedDurationMs: null, timedTurns: 0, inherited: false, incomplete: false } });

test('组织和导出消息验证来源世代、标识和有限范围', () => {
  for (const value of [null, {action:'favorite',id:'a',favorite:true}, {action:'favorite',scope:-1,id:'a',favorite:true},
    {action:'favorite',scope:0,id:'a',favorite:'yes'}, {action:'tags',scope:NaN,id:'a'}, {action:'export',scope:0,ids:[]},
    {action:'export',scope:0,ids:['a','a']}, {action:'export',scope:0,ids:[5]}, {action:'export',scope:0,ids:['x'.repeat(1025)]}]) assert.equal(isViewMessage(value), false);
  assert.equal(isViewMessage({action:'favorite',scope:0,id:'a',favorite:true}), true);
  assert.equal(isViewMessage({action:'tags',scope:0,id:'a'}), true);
  assert.equal(isViewMessage({action:'export',scope:0,ids:['a','b']}), true);
});

async function fixture(t: TestContext) {
  let current!: ViewState, action!: (value: PanelAction) => Promise<void>, changed!: (event: vscode.ConfigurationChangeEvent) => void;
  let home = '/fixture-a', available = true; const stored = new Map<string, unknown>();
  t.mock.method(SessionView.prototype, 'update', function(this: unknown) {
    const view = this as {state: () => ViewState; action: typeof action}; current = view.state(); action = view.action;
  });
  t.mock.method(vscode.workspace, 'onDidChangeConfiguration', (listener: typeof changed) => { changed = listener; return {dispose(){}}; });
  t.mock.method(LocalSessionRecords.prototype, 'list', async () => ({sessions:available?[row('same'),row('other')]:[],sourceAvailable:true}));
  const storage = { get: (key: string) => stored.get(key), update: async (key: string, value: unknown) => {stored.set(key, structuredClone(value));} };
  const context = {extensionUri:vscode.Uri.file('/extension'),subscriptions:[],workspaceState:storage} as unknown as vscode.ExtensionContext;
  const panel = new SessionPanel(context, () => home); t.after(() => panel.dispose()); await panel.start(); await host.commands.get('codexSessions.refresh')!();
  return { get state() { return current; }, action: (value: PanelAction) => action(value), stored, storage,
    async source(value: string) { home = value; changed({affectsConfiguration:()=>true}); await host.commands.get('codexSessions.refresh')!(); },
    async removeSessions() { available = false; await host.commands.get('codexSessions.refresh')!(); } };
}

test('收藏写入失败不改变快照、可重试；写入中切换来源不会污染同 ID 的会话', async t => {
  const f = await fixture(t); const scope = f.state.scope!;
  let fail = true, release!: () => void, started!: () => void;
  const writing = new Promise<void>(resolve => { started = resolve; });
  t.mock.method(f.storage, 'update', async (key: string, value: unknown) => {
    if (key !== 'sessionOrganization') { f.stored.set(key,value); return; }
    if (fail) throw new Error('fixture disk full');
    started(); await new Promise<void>(resolve => {release=resolve;}); f.stored.set(key,structuredClone(value));
  });
  await f.action({action:'favorite',scope,id:'same',favorite:true});
  assert.equal(f.state.sessions[0].organization?.favorite, false); assert.deepEqual(f.state.organizationPending, []);
  assert.ok(host.notifications.some(message => message.includes('fixture disk full')));
  fail = false;
  const save = f.action({action:'favorite',scope,id:'same',favorite:true}); await writing;
  assert.deepEqual(f.state.organizationPending,['same']); assert.equal(f.state.sessions[0].organization?.favorite,false);
  await f.source('/fixture-b'); assert.notEqual(f.state.scope,scope); assert.deepEqual(f.state.organizationPending,[]);
  release(); await save; assert.equal(f.state.sessions[0].organization?.favorite,false);
  await f.action({action:'favorite',scope,id:'same',favorite:true}); assert.equal(f.state.sessions[0].organization?.favorite,false);
  await f.source('/fixture-a'); assert.equal(f.state.sessions[0].organization?.favorite,true);
});

test('标签原生选择器可创建、复用和移除；取消与来源切换不写入', async t => {
  const f = await fixture(t);
  let choice = 'new', input: string | undefined = '  计划  ';
  t.mock.method(vscode.window,'showQuickPick',async (items: {tag?:string}[]) => choice==='cancel' ? undefined : choice==='new' ? items[0] : items.find(item=>item.tag===choice));
  t.mock.method(vscode.window,'showInputBox',async () => input);
  const tags = (id='same') => f.action({action:'tags',scope:f.state.scope!,id});
  await tags(); assert.deepEqual(f.state.sessions[0].organization?.tags,['计划']);
  choice='计划'; await tags('other'); assert.deepEqual(f.state.sessions[1].organization?.tags,['计划']);
  await tags(); assert.deepEqual(f.state.sessions[0].organization?.tags,[]);
  choice='new'; input=undefined; const before=JSON.stringify(f.stored.get('sessionOrganization'));
  await tags(); assert.equal(JSON.stringify(f.stored.get('sessionOrganization')),before);
  choice='cancel'; await tags(); assert.equal(JSON.stringify(f.stored.get('sessionOrganization')),before);
  t.mock.method(vscode.window,'showQuickPick',async (items: unknown[]) => { await f.source('/fixture-b'); return items[0]; });
  input='stale'; await tags(); assert.equal(JSON.stringify(f.stored.get('sessionOrganization')),before);
  t.mock.method(vscode.window,'showQuickPick',async (items: unknown[]) => { await f.removeSessions(); return items[0]; });
  await tags(); assert.equal(JSON.stringify(f.stored.get('sessionOrganization')),before);
  assert.deepEqual(f.state.sessions,[]);
});

test('CSV 仅接受当前宿主会话范围，快照固定，重复导出受控，来源切换取消保存', async t => {
  const f = await fixture(t); let writes = 0, choose!: (items: unknown[]) => void, dialogs=0;
  t.mock.method(vscode.window,'showQuickPick',async () => {dialogs++; return new Promise(resolve=>{choose=resolve;});});
  t.mock.method(vscode.window,'showSaveDialog',async () => vscode.Uri.file('/exports/sessions.csv'));
  t.mock.method(vscode.workspace.fs,'writeFile',async (_uri:vscode.Uri,bytes:Uint8Array) => {
    writes++; const content=Buffer.from(bytes).toString(); assert.equal(content.split('\r\n').length,3); assert.ok(!content.includes('private'));
  });
  await f.action({action:'export',scope:f.state.scope!,ids:['unknown']}); assert.equal(dialogs,0);
  await f.action({action:'export',scope:f.state.scope!,ids:['same','same']}); assert.equal(dialogs,0);
  const first = f.action({action:'export',scope:f.state.scope!,ids:['same']});
  assert.equal(f.state.exporting,true); assert.equal(dialogs,1);
  await f.action({action:'export',scope:f.state.scope!,ids:['other']}); assert.equal(dialogs,1);
  choose([]); await first; assert.equal(writes,1); assert.equal(f.state.exporting,false);
  const stale = f.action({action:'export',scope:f.state.scope!,ids:['same']});
  await f.source('/fixture-b'); choose([]); await stale;
  assert.equal(writes,1); assert.equal(f.state.exporting,false);
});
