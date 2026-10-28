// 仅生成隔离的浏览器验收夹具，不启动 VS Code、不读取用户记录或调用模型。
import {build} from 'esbuild';
import {mkdir,writeFile,readFile,copyFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const root=process.cwd(),out=path.join(root,'artifacts/analytics-ui');await mkdir(out,{recursive:true});
await build({entryPoints:['src/sessions/analytics-panel.ts','src/sessions/view.ts'],bundle:true,platform:'node',format:'cjs',outdir:out,outExtension:{'.js':'.cjs'},alias:{vscode:path.join(root,'test/vscode-stub.ts')}});
const require=createRequire(import.meta.url),{analysisHtml}=require(path.join(out,'analytics-panel.cjs')),{SessionView}=require(path.join(out,'view.cjs'));
const now=Date.now(), rows=[
  ['题库接口权限重构','arc-halo',110000,18400,82000,12,'running'],
  ['手机控制联调','arc-home',42600,8600,32000,8,'approval'],
  ['会话面板交互','codex-profile-switcher',68400,12300,48000,16,'input'],
  ['错误回写检查','arc-halo',18100,4200,12000,5,null],
  ['厨房媒体处理','arc-home/services/media',92000,15600,64000,10,'idle'],
  ['发布与安装说明','codex-profile-switcher',28600,6800,18000,7,null],
  ['规划与审计','arc-halo',52400,9100,36000,9,null],
  ['权限重构 · 分叉试验','arc-halo',110000,18400,82000,12,null],
  ['新建会话','arc-home',null,null,null,0,null],
  ['零用量记录','codex-profile-switcher',0,0,0,2,null]
];
const details={},sessions=rows.map(([title,cwd,input,output,cachedInput,count,live],i)=>{
  const turns=Array.from({length:count},(_,j)=>({id:`turn-${i}-${j}`,ordinal:j+1,startedAt:now/1000-(count-j)*600,endedAt:j===count-1&&live&&live!=='idle'?null:now/1000-(count-j)*600+120,
    outcome:j===count-1&&live&&live!=='idle'?'unresolved':i===6&&j===count-1?'failed':i===3&&j===count-1?'interrupted':j===count-2?'failed':j===2?'interrupted':'completed',
    liveState:j===count-1&&live&&live!=='idle'?live:undefined,
    durationMs:i===9?0:j===count-1&&live&&live!=='idle'?null:30000+(j*7919%170000),files:j%4,operations:j%4,changes:Array.from({length:j%4},(_,k)=>({path:'/workspace/'+cwd+'/'+['src/auth.ts','src/router.ts','test/auth.test.ts'][k],label:['src/auth.ts','src/router.ts','test/auth.test.ts'][k],kind:k===2?'add':'update',status:'completed',operations:1})),review:j>=count-2?'pending':j%2?'reviewed':'baseline',canReview:!(j===count-1&&live&&live!=='idle')}));
  const session={id:'s'+i,title,cwd:'/workspace/'+cwd,cwdLabel:cwd,createdAt:now/1000-count*1200,updatedAt:now/1000-i*200,model:'gpt-6.1-sol',provider:'relay',state:!turns.length?'empty':turns.at(-1).outcome==='unresolved'?'unclosed':turns.at(-1).outcome==='completed'?'finished':turns.at(-1).outcome,stateAt:now/1000-i*200,stateReason:'lifecycle',
    live:live?{id:'s'+i,state:live,at:now}:undefined,workflow:{active:!!live&&live!=='idle',attention:live==='approval'||live==='input'?'waiting':i===6?'failure':null,attentionAt:now-i*1000,pending:i===0?2:i===4?1:0},
    stats:{tokens:input===null?null:{input,output,cachedInput,total:input+output,cacheWriteInput:i===0?null:0,reasoningOutput:output===null?null:Math.floor(output*.2)},
      counts:i===6||!count?null:{total:count,completed:turns.filter(t=>t.outcome==='completed').length,failed:turns.filter(t=>t.outcome==='failed').length,interrupted:turns.filter(t=>t.outcome==='interrupted').length,unresolved:turns.filter(t=>t.outcome==='unresolved').length},
      lastDurationMs:turns.at(-1)?.durationMs??null,recordedDurationMs:turns.length?turns.reduce((n,t)=>n+(t.durationMs??0),0):null,timedTurns:turns.filter(t=>t.durationMs!==null).length,inherited:i===7,incomplete:i===6}};
  details[session.id]={session,turns,recordedFiles:Math.min(count,7)};return session;
});
const data={scope:0,workspace:'yhx',updatedAt:now,loading:false,supported:true,sessions};
await writeFile(path.join(out,'fixture.json'),JSON.stringify({data,details},null,2));
const bootstrap=`const fixture=${JSON.stringify({data,details})};
const state=fixture.data;let selected,appended=false;const scenario=new URLSearchParams(location.search).get('scenario');
if(scenario==='offline'){for(const session of state.sessions){delete session.live;session.workflow.active=false;if(session.workflow.attention==='waiting')session.workflow.attention=null;}for(const detail of Object.values(fixture.details))for(const turn of detail.turns)delete turn.liveState;}
if(scenario==='long'){const d=fixture.details.s0;d.turns=Array.from({length:86},(_,i)=>({...d.turns[i%11],id:'long-'+i,ordinal:i+1}));d.session.stats.counts={total:86,completed:78,failed:8,interrupted:0,unresolved:0};}
window.acquireVsCodeApi=()=>({getState:()=>({}),setState(){},postMessage(message){
  if(message.action==='detail')selected=message.id;if(message.action==='overview')selected=undefined;
  if(message.action==='switch'||message.action==='review')state.error='夹具收到 '+message.action+'：'+message.id+(message.turnId?' / '+message.turnId:'');
  if(message.action==='refresh'){state.error=undefined;state.updatedAt=Date.now();}
  if(scenario==='append'&&message.action==='refresh'&&!appended){const d=fixture.details.s0;d.turns.push({...d.turns[0],id:'appended',ordinal:13,startedAt:Date.now()/1000,endedAt:Date.now()/1000,durationMs:12500});d.session.stats.counts.total++;d.session.stats.counts.completed++;appended=true;}
  const current=scenario==='empty'?{...state,sessions:[]}:state;
  const id=selected??(scenario==='fork'?'s7':scenario==='missing'?'deleted':scenario==='zero'?'s9':scenario==='long'||scenario==='append'?'s0':undefined);
  setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'analysis',state:{...current,selectedId:id,detail:fixture.details[id]}}})),0);
}});`;
await writeFile(path.join(out,'fixture.js'),bootstrap);
const extension={scheme:'file',authority:'',path:root};
const webview={cspSource:"'self'",asWebviewUri:uri=>'/'+path.basename(uri.path)};
let html=analysisHtml(webview,extension), nonce=html.match(/nonce="([^"]+)"/)[1];
html=html.replace('<script nonce=',`<script nonce="${nonce}" src="fixture.js"></script><script nonce=`);
const palettes={light:{bg:'#fafaf8',fg:'#333831',muted:'#6e756b',accent:'#53765d',hover:'#f0f1ed',warning:'#946329',error:'#ae5d59',button:'#53765d'},dark:{bg:'#202221',fg:'#e5e7e2',muted:'#a0a69d',accent:'#a2bea8',hover:'#2a2e29',warning:'#d3b084',error:'#db9690',button:'#53765d'},contrast:{bg:'#000',fg:'#fff',muted:'#fff',accent:'#ff0',hover:'#222',warning:'#ff0',error:'#fff',button:'#000'}};
for(const [name,c] of Object.entries(palettes)){
  const css=`:root{--vscode-editor-background:${c.bg};--vscode-panel-background:${c.bg};--vscode-foreground:${c.fg};--vscode-descriptionForeground:${c.muted};--vscode-textLink-foreground:${c.accent};--vscode-list-hoverBackground:${c.hover};--vscode-focusBorder:${c.accent};--vscode-editorWarning-foreground:${c.warning};--vscode-errorForeground:${c.error};--vscode-button-background:${c.button};--vscode-button-foreground:#fff;--vscode-font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;--vscode-contrastBorder:${name==='contrast'?'#fff':'transparent'};color-scheme:${name==='light'?'light':'dark'};}`;
  await writeFile(path.join(out,name+'.css'),css);
  await writeFile(path.join(out,name+'.html'),html.replace('</head>',`<link rel="stylesheet" href="${name}.css"></head>`).replace('<body>',`<body class="vscode-${name==='contrast'?'high-contrast':name}">`));
}
for(const file of ['analytics.js','sessions.js'])await copyFile(path.join(root,'dist',file),path.join(out,file));
for(const file of ['analytics.css','sessions.css'])await copyFile(path.join(root,'resources',file),path.join(out,file));
let bottom='';new SessionView(extension,()=>({sessions:[]}),async()=>{}).resolveWebviewView({webview:{...webview,options:{},set html(value){bottom=value;},postMessage(){},onDidReceiveMessage(){return {dispose(){}};}},onDidDispose(){},onDidChangeVisibility(){}});
nonce=bottom.match(/nonce="([^"]+)"/)[1];
bottom=bottom.replace('</head>','<link rel="stylesheet" href="light.css"></head>').replace('<script nonce=',`<script nonce="${nonce}" src="bottom-fixture.js"></script><script nonce=`);
await writeFile(path.join(out,'bottom.html'),bottom);
await writeFile(path.join(out,'bottom-fixture.js'),`const state=${JSON.stringify({...data,columnLayout:{version:1,visible:null,widths:{}},sourceAvailable:true,liveMode:'connected',selectedId:'s0',sessions:sessions.map(s=>({...s,turns:[]}))})};if(new URLSearchParams(location.search).get('scenario')==='offline'){state.liveMode='disconnected';for(const row of state.sessions){delete row.live;row.workflow.active=false;if(row.workflow.attention==='waiting')row.workflow.attention=null;}}window.acquireVsCodeApi=()=>({getState:()=>({}),setState(){},postMessage(m){if(m.action==='analytics')state.error='分析入口：'+(m.id??'工作区');if(m.action==='switch')state.selectedId=m.id;setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state}})),0);}});`);
await writeFile(path.join(out,'bottom-frame.html'),'<html><body style="margin:0"><iframe src="bottom.html" title="底部面板" style="width:360px;height:260px;border:0"></iframe></body></html>');
console.log(`Preview files: ${out}`);
