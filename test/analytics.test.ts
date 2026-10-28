import test from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { aggregate, cacheRate, sumKnown, filterSessions, durationDistribution, tokenComposition, isAnalysisMessage, type AnalysisAction, type AnalysisSession, type AnalysisState, type AnalysisTurn } from '../src/sessions/analytics';
import { AnalysisPanel } from '../src/sessions/analytics-panel';
import { SessionPanel } from '../src/sessions/controller';
import { LocalSessionRecords } from '../src/sessions/records';
import type { Session } from '../src/sessions/types';
import { state as host } from './vscode-stub';
import { LiveSessions } from '../src/live/channel';
import { newTurn } from '../src/sessions/turns';

function session(id:string,input:number|null,cached:number|null,total:number|null,inherited=false):AnalysisSession {
  return {id,title:`会话 ${id}`,cwd:`/workspace/${id}`,cwdLabel:id,createdAt:1,updatedAt:2,model:'model',provider:'provider',state:'finished',stateAt:2,stateReason:'lifecycle',
    stats:{tokens:{input,output:null,total,cachedInput:cached,cacheWriteInput:null,reasoningOutput:null},counts:null,lastDurationMs:null,recordedDurationMs:null,timedTurns:0,inherited,incomplete:false}};
}
test('会话分析保留未知和零；分叉不重复汇总，缓存按有效配对加权，耗时只统计明确记录',()=>{
  const rows=[session('a',100,80,120),session('b',900,90,1000),session('missing',null,5,30),session('fork',10000,9000,20000,true)];
  rows[0].stats.counts={total:3,completed:2,failed:1,interrupted:0,unresolved:0};rows[0].stats.recordedDurationMs=60000;rows[0].stats.timedTurns=3;
  const summary=aggregate(rows);assert.equal(summary.tokens.total.value,1150);assert.equal(summary.tokens.input.value,1000);assert.equal(summary.tokens.output.value,null);
  assert.equal(summary.cache.value,.17);assert.equal(summary.cache.known,2);assert.equal(summary.inherited,1);assert.equal(summary.counts?.total,3);assert.equal(summary.duration.value,60000);
  assert.deepEqual(sumKnown([null,undefined]),{value:null,known:0});assert.deepEqual(sumKnown([0,null]),{value:0,known:1});
  assert.equal(cacheRate([session('zero',0,0,0)]).value,null);assert.equal(cacheRate([session('invalid',100,101,100)]).known,0);
  assert.deepEqual(tokenComposition(rows).parts,[]);
  rows[0].stats.tokens!.output=20;rows[1].stats.tokens!.output=100;
  const composition=tokenComposition(rows.slice(0,2));assert.equal(composition.total,1120);assert.deepEqual(composition.parts.map(part=>part.value),[830,170,120]);
  rows[0].stats.tokens!.cachedInput=null;assert.deepEqual(tokenComposition(rows.slice(0,2)).parts.map(part=>part.value),[1000,120]);
  const zero=session('zero',0,0,0);zero.stats.tokens!.output=0;assert.equal(tokenComposition([zero]).total,0);
  assert.equal(filterSessions(rows,'会话 A','/workspace/a').length,1);assert.equal(filterSessions(rows,'','/workspace/').length,0);
  const turns=[0,100,1000,2000,null].map((durationMs,i)=>({durationMs,outcome:'completed',id:String(i)} as AnalysisTurn));
  turns.push({durationMs:9000,outcome:'unresolved'} as AnalysisTurn);
  assert.deepEqual(durationDistribution(turns),{count:4,min:0,max:2000,median:550,p95:2000});
  assert.equal(isAnalysisMessage({action:'detail',id:''}),false);assert.equal(isAnalysisMessage({action:'review',id:'a',turnId:4}),false);
});

test('分析使用当前编辑器组的单一标签；重开复用、隐藏不推送、无效会话不能进入详情',async t=>{
  let receiver:(value:unknown)=>void=()=>{},disposed=()=>{},visibility=()=>{},created=0,revealed=0;
  const messages:{state:AnalysisState}[]=[],actions:unknown[]=[];
  const panel={visible:true,viewColumn:2,iconPath:undefined as unknown,webview:{html:'',asWebviewUri:(uri:vscode.Uri)=>uri,cspSource:'vscode-webview:',postMessage:(value:{state:AnalysisState})=>{messages.push(value);return Promise.resolve(true);},onDidReceiveMessage:(fn:typeof receiver)=>{receiver=fn;return {dispose(){}};}},
    reveal(){revealed++;},onDidChangeViewState(fn:()=>void){visibility=fn;return {dispose(){}};},onDidDispose(fn:()=>void){disposed=fn;return {dispose(){}};},dispose(){disposed();}};
  t.mock.method(vscode.window,'createWebviewPanel',(_type:string,_title:string,column:vscode.ViewColumn)=>{created++;assert.equal(column,vscode.ViewColumn.Active);return panel;});
  const view=new AnalysisPanel(vscode.Uri.file('/extension'),id=>({scope:0,workspace:'workspace',updatedAt:1,loading:false,supported:true,sessions:[session('a',1,0,1)],selectedId:id}),async action=>{actions.push(action);});
  view.open();view.open('a');assert.equal(created,1);assert.equal(revealed,1);assert.equal(messages.at(-1)?.state.selectedId,'a');
  const before=messages.length;receiver({action:'detail',id:'outside'});assert.equal(messages.length,before);
  panel.visible=false;view.update();assert.equal(messages.length,before);panel.visible=true;visibility();assert.deepEqual(actions.at(-1),{action:'refresh'});
  receiver({action:'overview'});assert.equal(messages.at(-1)?.state.selectedId,undefined);
  receiver({action:'ready'});assert.ok(panel.webview.html.includes('analytics.js'));assert.ok(!panel.webview.html.includes('unsafe-inline'));
  view.dispose();view.open();assert.equal(created,2);view.dispose();
});

test('分析与底部面板共用当前源；只发送所选会话的逐轮摘要，工作区变化清除旧详情',async t=>{
  const row:Session={...session('a',10,8,12),cwd:'/test/project',turns:[{id:'turn-a',outcome:'completed',durationMs:0,startedAt:1,endedAt:2,items:[{id:'item',at:2,status:'completed',bytes:1,fingerprint:'fixture',files:[{path:'src/a.ts',kind:'update'},{path:'./src/a.ts',kind:'update'}]}]}]};
  let listener:()=>void=()=>{},snapshot:AnalysisState|undefined,selected:string|undefined,available=true;
  let analysisAction:(action:AnalysisAction)=>Promise<void>=async()=>{};const commands:string[]=[];
  t.mock.method(vscode.commands,'executeCommand',async (name:string)=>{commands.push(name);});
  t.mock.method(vscode.workspace,'onDidChangeWorkspaceFolders',(fn:()=>void)=>{listener=fn;return {dispose(){}};});
  t.mock.method(LocalSessionRecords.prototype,'list',async()=>({sessions:available?[row]:[],sourceAvailable:true}));
  t.mock.method(AnalysisPanel.prototype,'open',function(this:unknown,id?:string){selected=id;const owner=this as {state:(id?:string)=>AnalysisState;action:typeof analysisAction};snapshot=owner.state(id);analysisAction=owner.action;});
  t.mock.method(AnalysisPanel.prototype,'update',function(this:unknown){snapshot=(this as {state:(id?:string)=>AnalysisState}).state(selected);});
  t.mock.method(AnalysisPanel.prototype,'resetSelection',()=>{selected=undefined;});
  const context={extensionUri:vscode.Uri.file('/extension'),subscriptions:[],workspaceState:{get:()=>undefined,update:async()=>{}}} as unknown as vscode.ExtensionContext;
  const live=new LiveSessions();let enabled=true;
  t.mock.method(live,'turnState',(_id:string,turnId:string)=>turnId==='historical-unclosed'?undefined:'input');
  const panel=new SessionPanel(context,()=>'/fixture-home',live,()=>enabled?'connected':'off');t.after(()=>panel.dispose());await panel.start();await host.commands.get('codexSessions.refresh')!();
  await (host.commands.get('codexSessions.analytics')! as (id?:string)=>Promise<void>)('a');
  assert.equal(snapshot?.detail?.turns[0].durationMs,0);assert.equal(snapshot?.detail?.turns[0].files,1);assert.equal(snapshot?.detail?.turns[0].operations,2);assert.equal(snapshot?.detail?.recordedFiles,1);
  assert.deepEqual(snapshot?.detail?.turns[0].changes,[{path:'/test/project/src/a.ts',label:'src/a.ts',kind:'update',status:'completed',operations:2}]);
  assert.ok(!('turns' in snapshot!.sessions[0]));assert.ok(!JSON.stringify(snapshot).includes('fixture"'));
  row.turns.push(newTurn('active-turn'),newTurn('historical-unclosed'));await host.commands.get('codexSessions.refresh')!();
  assert.equal(snapshot?.detail?.turns[0].liveState,undefined);assert.equal(snapshot?.detail?.turns[1].liveState,'input');assert.equal(snapshot?.detail?.turns[2].liveState,undefined);
  enabled=false;await host.commands.get('codexSessions.refresh')!();assert.equal(snapshot?.detail?.turns[1].liveState,undefined);
  await analysisAction({action:'review',id:'a',turnId:'turn-a'});assert.deepEqual(commands,['codexSessions.list.focus']);
  await analysisAction({action:'review',id:'a',turnId:'removed'});assert.equal(commands.length,1);
  available=false;listener();await host.commands.get('codexSessions.refresh')!();assert.equal(snapshot?.detail,undefined);assert.equal(snapshot?.selectedId,undefined);assert.equal(snapshot?.sessions.length,0);
});
