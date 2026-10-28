import { createElement, ChartNoAxesCombined, RefreshCw, Search, ArrowUpRight, ArrowLeft, ChevronLeft, ChevronRight, FileDiff, LoaderCircle } from 'lucide';
import { aggregate, cacheRate, durationDistribution, filterSessions, tokenComposition, type AnalysisState, type AnalysisSession, type AnalysisMessage, type AnalysisDetail, type AnalysisTurn } from './analytics';
import { tokenLabel, durationLabel } from './statistics';
import type { SessionStats } from './types';
import { outcomeLabels,reviewLabels,sessionStatusLabel,sessionStatusHint,turnStatusLabel } from './status';

interface Preferences { query:string; cwd:string; sort:string; page:number; turnPage:number; detailId?:string; selectedTurn?:string; chartPage:number; scope?:number }
declare function acquireVsCodeApi(): { getState(): Partial<Preferences> | undefined; setState(value:Preferences): void; postMessage(message:AnalysisMessage): void };
const api = acquireVsCodeApi(), saved = api.getState();
const preferences: Preferences = {query:saved?.query ?? '',cwd:saved?.cwd ?? '',sort:saved?.sort ?? 'tokens',page:saved?.page??0,turnPage:saved?.turnPage??0,detailId:saved?.detailId,selectedTurn:saved?.selectedTurn,chartPage:saved?.chartPage??0,scope:saved?.scope};
let state: AnalysisState = {scope:0,workspace:'',updatedAt:0,loading:true,supported:true,sessions:[]};
let seenScope=preferences.scope, shownId: string | undefined, overviewScroll=0, directorySignature='';
const $ = <T extends HTMLElement>(id:string) => document.getElementById(id) as T;
const send = (message:AnalysisMessage) => api.postMessage(message);
const exact = (value:number|null|undefined) => value == null ? '—' : value.toLocaleString('zh-CN');
const percentage = (value:number|null) => value === null ? '—' : `${(value*100).toFixed(1)}%`;
const date = (seconds:number|null) => seconds ? new Date(seconds*1000).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
function el<K extends keyof HTMLElementTagNameMap>(tag:K, className='', text?:string):HTMLElementTagNameMap[K] {
  const node=document.createElement(tag); node.className=className; if(text!==undefined) node.textContent=text; return node;
}
function button(label:string, action:()=>void, className='text-button', icon?:Parameters<typeof createElement>[0]):HTMLButtonElement {
  const node=el('button',className); node.type='button'; if(icon) node.append(createElement(icon)); node.append(el('span','',label)); node.addEventListener('click',action); return node;
}
function metric(label:string,value:string,note:string,full?:number|null):HTMLElement {
  const node=el('div','metric'); const number=el('strong','metric-value',value); if(full!=null) number.title=exact(full);
  node.append(el('span','metric-label',label),number);if(note)node.append(el('span','metric-note',note));return node;
}
function section(title:string,meta?:string):HTMLElement {
  const node=el('section','analysis-section'), head=el('div','section-heading'); head.append(el('h2','',title));
  if(meta) head.append(el('span','subtle',meta)); node.append(head); return node;
}
function empty(text:string):HTMLElement { return el('p','empty-state',text); }
function bar(label:string,value:number|null,max:number,className='',onClick?:()=>void,format=tokenLabel):HTMLElement {
  const row=el('div',`bar-row ${className}`), labelNode=onClick?button(label,onClick,'bar-link'):el('span','bar-label',label);
  const progress=el('progress'); progress.max=Math.max(1,max); progress.value=value ?? 0; progress.setAttribute('aria-label',`${label}：${exact(value)}`);
  const valueNode=el('span','bar-number',format(value)); valueNode.title=exact(value);
  row.append(labelNode,progress,valueNode);row.title=`${label}：${format(value)}`;return row;
}
const svgNS='http://www.w3.org/2000/svg';
function svgNode<K extends keyof SVGElementTagNameMap>(tag:K,attrs:Record<string,string|number>={}):SVGElementTagNameMap[K] {
  const node=document.createElementNS(svgNS,tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));return node;
}
function tokenChart(rows:AnalysisSession[]):HTMLElement {
  const composition=tokenComposition(rows),block=section('Token 用量',`${composition.known}/${rows.length} 条记录`),layout=el('div','token-layout');
  const svg=svgNode('svg',{viewBox:'0 0 128 128',role:'img','aria-label':`输入与输出用量 ${exact(composition.total)}`});svg.classList.add('donut');
  const track=svgNode('circle',{cx:64,cy:64,r:48,class:'donut-track'});svg.append(track);
  let offset=0;const circumference=2*Math.PI*48;
  for(const part of composition.parts){
    const length=composition.total?part.value/composition.total*circumference:0;
    const ring=svgNode('circle',{cx:64,cy:64,r:48,class:part.key,'stroke-dasharray':`${length} ${circumference-length}`,'stroke-dashoffset':-offset,transform:'rotate(-90 64 64)'});
    const title=svgNode('title');title.textContent=`${part.label} ${exact(part.value)}`;ring.append(title);svg.append(ring);offset+=length;
  }
  const value=svgNode('text',{x:64,y:63,class:'donut-value','text-anchor':'middle'});value.textContent=tokenLabel(composition.total);
  const label=svgNode('text',{x:64,y:80,class:'donut-label','text-anchor':'middle'});label.textContent='输入 + 输出';svg.append(value,label);
  const legend=el('div','token-legend');
  for(const part of composition.parts){
    const row=el('div','legend-row'),dot=el('span',`legend-dot ${part.key}`),number=el('strong','',tokenLabel(part.value));number.title=exact(part.value);
    row.append(dot,el('span','',part.label),number,el('span','legend-share',composition.total?percentage(part.value/composition.total):'—'));legend.append(row);
  }
  if(!composition.parts.length)legend.append(empty('暂无输入、输出记录'));
  layout.append(svg,legend);block.append(layout);return block;
}
function outcomeStrip(counts:SessionStats['counts'],coverage?:string):HTMLElement {
  const strip=el('div','outcome-strip');if(coverage)strip.title=coverage;
  for(const key of ['completed','failed','interrupted'] as const){const item=el('span',`outcome-item ${key}`);item.append(el('i','legend-dot'),el('span','',outcomeLabels[key]),el('strong','',exact(counts?.[key])));strip.append(item);}
  return strip;
}
function pagination(total:number,page:number,size:number,onChange:(next:number)=>void):HTMLElement {
  const pages=Math.max(1,Math.ceil(total/size)), footer=el('div','pagination');
  footer.append(el('span','subtle',`${total? page*size+1:0}–${Math.min(total,(page+1)*size)} / ${total}`));
  const prev=button('上一页',()=>onChange(page-1),'text-button',ChevronLeft),next=button('下一页',()=>onChange(page+1),'text-button',ChevronRight);
  prev.disabled=page===0;next.disabled=page>=pages-1;footer.append(prev,el('span','page-number',`${page+1} / ${pages}`),next);return footer;
}
function table(headers:string[]):{wrapper:HTMLElement;body:HTMLTableSectionElement} {
  const wrapper=el('div','table-scroll'), table=el('table'), head=el('thead'),row=el('tr'),body=el('tbody');
  for(const title of headers) {const th=el('th','',title);th.scope='col';row.append(th);}head.append(row);table.append(head,body);wrapper.append(table);return {wrapper,body};
}
function cell(text:string, className='',title?:string):HTMLTableCellElement {const td=el('td',className,text);if(title)td.title=title;return td;}
function persist():void { api.setState(preferences); }
function redraw():void { persist();render(); }

function overview():void {
  const rows=filterSessions(state.sessions,preferences.query,preferences.cwd), summary=aggregate(rows), root=$('overview-content');
  root.replaceChildren();
  $('scope-summary').textContent=[`${rows.length} 条会话`,rows.some(row=>row.live)?`${summary.active} 进行中`:'',summary.waiting?`${summary.waiting} 待批准/回复`:'',summary.pending?`${summary.pending} 待审阅`:''].filter(Boolean).join(' · ');
  const metrics=el('div','metrics');
  metrics.append(metric('Token',tokenLabel(summary.tokens.total.value),`${summary.tokens.total.known}/${summary.eligible}`,summary.tokens.total.value),
    metric('输入',tokenLabel(summary.tokens.input.value),'',summary.tokens.input.value),metric('输出',tokenLabel(summary.tokens.output.value),'',summary.tokens.output.value),
    metric('缓存命中',percentage(summary.cache.value),''),
    metric('回合',exact(summary.counts?.total),`${summary.counted} 条会话`,summary.counts?.total),
    metric('执行耗时',durationLabel(summary.duration.value),`${summary.timedTurns} 轮`,summary.duration.value));
  metrics.children[0].setAttribute('title',`${summary.tokens.total.known}/${summary.eligible} 条独立会话有用量记录`);
  metrics.children[3].setAttribute('title',`${summary.cache.known} 条有效记录的缓存输入总量 / 输入总量；按输入量加权。`);
  root.append(metrics);
  if(summary.inherited)root.append(el('p','scope-note',`汇总不含 ${summary.inherited} 条分叉会话，避免重复计算继承记录。`));
  if(!rows.length){root.append(empty(state.loading?'正在读取会话记录…':'当前范围没有会话，试试清空搜索或更换工作目录。'));return;}
  const layout=el('div','overview-layout'),charts=el('aside','analysis-sidebar'),eligible=rows.filter(row=>!row.stats.inherited),time=section('会话耗时','前 5 条');
  const timed=eligible.filter(row=>row.stats.recordedDurationMs!==null).sort((a,b)=>b.stats.recordedDurationMs!-a.stats.recordedDurationMs!).slice(0,5);
  for(const row of timed)time.append(bar(row.title,row.stats.recordedDurationMs,timed[0].stats.recordedDurationMs!,'duration',()=>send({action:'detail',id:row.id}),durationLabel));
  if(!timed.length)time.append(empty('暂无耗时记录'));
  time.append(outcomeStrip(summary.counts,`${summary.counted} 条会话的完整回合记录`));
  charts.append(tokenChart(eligible),time);
  const list=section('会话',`${rows.length} 条`);list.classList.add('session-list');
  const sort=el('select');sort.setAttribute('aria-label','会话排序');
  for(const [value,label] of [['tokens','Token 从高到低'],['duration','执行时长从高到低'],['turns','回合从多到少'],['updated','最近更新']]){const option=el('option','',label);option.value=value;sort.append(option);}
  sort.value=preferences.sort;sort.dataset.focus='sort';sort.addEventListener('change',()=>{preferences.sort=sort.value;preferences.page=0;redraw();});list.querySelector('.section-heading')!.append(sort);
  const value=(row:AnalysisSession)=>preferences.sort==='duration'?row.stats.recordedDurationMs:preferences.sort==='turns'?row.stats.counts?.total:preferences.sort==='updated'?row.updatedAt:row.stats.tokens?.total;
  rows.sort((a,b)=>(value(b)??-1)-(value(a)??-1)||b.updatedAt-a.updatedAt||a.id.localeCompare(b.id));
  preferences.page=Math.min(preferences.page,Math.max(0,Math.ceil(rows.length/30)-1));
  const grid=table(['会话 / 工作目录','当前状态','总 Token','缓存命中率','回合','执行时长','']);
  for(const row of rows.slice(preferences.page*30,(preferences.page+1)*30)){
    const tr=el('tr'),name=el('td','name-cell'),link=button(row.title,()=>send({action:'detail',id:row.id}),'session-link');
    link.dataset.focus=`detail-${row.id}`;const meta=el('div','row-meta',row.cwdLabel);name.append(link,meta);name.title=row.cwd;
    if(row.stats.inherited)meta.append(el('span','record-tag','继承历史'));
    if(row.stats.incomplete)meta.append(el('span','record-tag','记录不全'));
    const status=cell(sessionStatusLabel(row),`status-text ${row.live?.state==='running'?'live-running':''}`,sessionStatusHint(row));
    if(row.live?.state==='running')status.prepend(createElement(LoaderCircle));
    const open=button('打开',()=>send({action:'switch',id:row.id}),'text-button',ArrowUpRight);open.disabled=!state.supported;open.title='在官方 Codex 侧栏打开';
    const action=el('td');action.append(open);
    tr.append(name,status,cell(tokenLabel(row.stats.tokens?.total??null),'number',exact(row.stats.tokens?.total)),cell(percentage(cacheRate([row]).value),'number'),cell(exact(row.stats.counts?.total),'number'),cell(durationLabel(row.stats.recordedDurationMs),'number'),action);grid.body.append(tr);
  }
  list.append(grid.wrapper,pagination(rows.length,preferences.page,30,next=>{preferences.page=next;redraw();}));layout.append(list,charts);root.append(layout);
}

function chooseTurn(detail:AnalysisDetail,id:string,focus=false):void {
  const index=detail.turns.findIndex(turn=>turn.id===id);if(index<0)return;
  preferences.selectedTurn=id;preferences.chartPage=Math.floor(index/40);preferences.turnPage=Math.floor((detail.turns.length-1-index)/30);redraw();
  if(focus)[...document.querySelectorAll<SVGElement>('[data-turn]')].find(node=>node.dataset.turn===id)?.focus({preventScroll:true});
}
function turnChart(detail:AnalysisDetail):HTMLElement {
  const turns=detail.turns,block=section('回合耗时'),count=Math.ceil(turns.length/40);
  preferences.chartPage=Math.min(preferences.chartPage,Math.max(0,count-1));
  const start=preferences.chartPage*40,sample=turns.slice(start,start+40),controls=el('div','chart-controls');
  const prev=button('前 40 轮',()=>{preferences.chartPage--;redraw();},'text-button',ChevronLeft);
  const next=button('后 40 轮',()=>{preferences.chartPage++;redraw();},'text-button',ChevronRight);
  prev.disabled=preferences.chartPage===0;next.disabled=preferences.chartPage>=count-1;
  controls.append(prev,el('span','subtle',`${turns.length?start+1:0}–${start+sample.length} / ${turns.length}`),next);block.querySelector('.section-heading')!.append(controls);
  if(!sample.length){block.append(empty('暂无回合记录'));return block;}
  const svg=svgNode('svg',{viewBox:'0 0 920 130',preserveAspectRatio:'none',role:'group','aria-label':'回合耗时，点击或按 Enter 查看该轮明细'});svg.classList.add('turn-chart');
  // 坐标标签使用 HTML 字号，不随 SVG 缩放，窄分区里仍保持 12px 可读性。
  const axis=el('div','chart-axis');axis.setAttribute('aria-hidden','true');
  const max=Math.max(1,...sample.map(turn=>turn.durationMs??0)),step=900/sample.length;
  for(const [i,turn] of sample.entries()){
    const group=svgNode('g',{role:'button',tabindex:0,'aria-label':`第 ${turn.ordinal} 轮，${turnStatusLabel(turn)}，${durationLabel(turn.durationMs)}`,'aria-pressed':String(turn.id===preferences.selectedTurn),'data-turn':turn.id,'data-focus':`chart-${turn.id}`,class:turn.id===preferences.selectedTurn?'selected':''});
    const hit=svgNode('rect',{x:10+i*step,y:5,width:step,height:125,rx:3,class:'hit-area'});
    const height=turn.durationMs===null?3:Math.max(2,turn.durationMs/max*108),width=Math.min(40,step*.65);
    const rect=svgNode('rect',{x:10+i*step+(step-width)/2,y:126-height,width,height,rx:2,class:`bar ${turn.outcome} ${turn.durationMs===null?'missing':''}`});
    const title=svgNode('title');title.textContent=`#${turn.ordinal} · ${turnStatusLabel(turn)} · ${durationLabel(turn.durationMs)}`;
    group.append(hit,rect,title);
    group.addEventListener('click',()=>chooseTurn(detail,turn.id));
    group.addEventListener('keydown',event=>{
      if(['Enter',' '].includes(event.key)){event.preventDefault();chooseTurn(detail,turn.id,true);}
      if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const index=turns.findIndex(row=>row.id===turn.id),target=turns[index+(event.key==='ArrowLeft'?-1:1)];if(target)chooseTurn(detail,target.id,true);}
    });
    svg.append(group);
    axis.append(el('span','',sample.length<=16||i%Math.ceil(sample.length/10)===0||i===sample.length-1?String(turn.ordinal):''));
  }
  const known=sample.filter(turn=>turn.durationMs!==null),legend=el('div','chart-legend');
  legend.append(el('span','subtle',`最高 ${durationLabel(known.length?Math.max(...known.map(turn=>turn.durationMs!)):null)}`),el('span','subtle','空心：无耗时记录'));
  block.append(svg,axis,legend);return block;
}
function turnInspector(detail:AnalysisDetail):HTMLElement {
  const turn=detail.turns.find(turn=>turn.id===preferences.selectedTurn),block=section(turn?`回合 #${turn.ordinal}`:'回合明细');block.id='turn-inspector';
  if(!turn){
    block.append(empty(detail.turns.length?'所选回合已从记录中移除':'暂无回合记录'));
    if(detail.turns.length)block.append(button('查看最新回合',()=>chooseTurn(detail,detail.turns.at(-1)!.id),'text-button'));
    return block;
  }
  const label=el('span',`outcome-label ${turn.outcome} ${turn.liveState==='running'?'live-running':''}`,turnStatusLabel(turn));
  if(turn.liveState==='running')label.prepend(createElement(LoaderCircle));
  block.querySelector('.section-heading')!.append(label);
  const facts=el('dl','turn-facts');
  for(const [label,value] of [['执行耗时',durationLabel(turn.durationMs)],['开始',date(turn.startedAt)],['结束',date(turn.endedAt)],['文件 / 操作',`${turn.files} / ${turn.operations}`]])facts.append(el('dt','',label),el('dd','',value));
  block.append(facts);
  const changes=el('div','turn-changes');
  for(const file of turn.changes){
    const row=el('div','change-row'),name=el('span','change-path',file.label);name.title=file.path;
    const kind=el('span',`change-kind ${file.kind}`,{add:'新增',update:'修改',delete:'删除'}[file.kind]);
    const count=el('span','subtle',`×${file.operations}`);count.title=file.status==='completed'?'操作完成':file.status;
    row.append(kind,name,count);if(file.status!=='completed')row.append(el('span','change-status',file.status));changes.append(row);
  }
  if(!turn.changes.length)changes.append(el('p','subtle','本轮未记录文件操作'));
  block.append(changes);
  if(turn.canReview){const footer=el('div','inspector-footer'),review=button('审阅本轮',()=>send({action:'review',id:detail.session.id,turnId:turn.id}),'text-button',FileDiff);review.dataset.focus=`inspect-${turn.id}`;footer.append(el('span','subtle',reviewLabels[turn.review]),review);block.append(footer);}
  block.title=`回合 ID：${turn.id}`;return block;
}
function detail(value:AnalysisDetail):void {
  const root=$('detail-page'),{session,turns}=value,stats=session.stats,distribution=durationDistribution(turns);root.replaceChildren();
  if(preferences.detailId!==session.id){preferences.detailId=session.id;preferences.selectedTurn=undefined;preferences.chartPage=0;preferences.turnPage=0;}
  if(!preferences.selectedTurn&&turns.length){preferences.selectedTurn=turns.at(-1)!.id;preferences.chartPage=Math.floor((turns.length-1)/40);}
  const toolbar=el('div','detail-toolbar'),name=el('span','thread-name',session.title);name.title=session.title;
  toolbar.append(button('会话',()=>send({action:'overview'}),'back-link',ArrowLeft),name);
  const cwd=el('span','inline-meta directory-caption',session.cwdLabel);cwd.title=session.cwd;toolbar.append(cwd);
  for(const text of [session.model||'模型未记录',session.provider||'Provider 未记录'])toolbar.append(el('span','inline-meta',text));
  const status=el('span','inline-meta',sessionStatusLabel(session));status.title=sessionStatusHint(session);toolbar.append(status);
  toolbar.title=`创建 ${date(session.createdAt)} · 记录更新 ${date(session.updatedAt)}`;
  const open=button('打开 Codex',()=>send({action:'switch',id:session.id}),'primary-button',ArrowUpRight);open.disabled=!state.supported;toolbar.append(open);root.append(toolbar);
  if(stats.inherited||stats.incomplete)root.append(el('p','scope-note',[stats.inherited?'包含继承历史，不计入跨会话汇总。':'',stats.incomplete?'历史不完整，完整轮次未知。':''].filter(Boolean).join(' ')));
  const metrics=el('div','metrics');metrics.append(metric('Token',tokenLabel(stats.tokens?.total??null),'',stats.tokens?.total),metric('输入',tokenLabel(stats.tokens?.input??null),'',stats.tokens?.input),metric('输出',tokenLabel(stats.tokens?.output??null),'',stats.tokens?.output),metric('缓存命中',percentage(cacheRate([session]).value),''),metric('回合',exact(stats.counts?.total),stats.counts===null?`${turns.length} 条可读取`:''),metric('执行耗时',durationLabel(stats.recordedDurationMs),`${stats.timedTurns} 轮`,stats.recordedDurationMs));root.append(metrics);
  const dashboard=el('div','detail-dashboard'),usage=tokenChart([session]);usage.classList.add('detail-usage');
  const extras=el('div','extra-metrics');extras.append(el('span','',`缓存写入 ${exact(stats.tokens?.cacheWriteInput)}`),el('span','',`推理输出 ${exact(stats.tokens?.reasoningOutput)}`));extras.title='推理输出已包含在输出中。';usage.append(extras);
  const trend=turnChart(value),numbers=el('div','duration-metrics');
  numbers.append(metric('中位数',durationLabel(distribution.median),''),metric('P95',durationLabel(distribution.p95),''),metric('最长',durationLabel(distribution.max),''),metric('涉及文件',exact(value.recordedFiles),''));
  numbers.title=`${distribution.count} 轮有耗时记录；P95 按最近秩法计算，文件按完整路径去重。`;trend.append(numbers,outcomeStrip(stats.counts));dashboard.append(usage,trend,turnInspector(value));root.append(dashboard);
  const list=section('回合记录',`${turns.length} 条`);list.classList.add('turn-list');
  const grid=table(['回合','开始','结果','耗时','文件 / 操作','审阅','']);
  preferences.turnPage=Math.min(preferences.turnPage,Math.max(0,Math.ceil(turns.length/30)-1));
  for(const turn of [...turns].reverse().slice(preferences.turnPage*30,(preferences.turnPage+1)*30)){
    const tr=el('tr',turn.id===preferences.selectedTurn?'selected':''),name=el('td','turn-name'),select=button(`#${turn.ordinal}`,()=>chooseTurn(value,turn.id),'text-button');select.dataset.focus=`turn-${turn.id}`;select.title=turn.id;name.append(select);
    const action=el('td');if(turn.canReview){const review=button('审阅',()=>send({action:'review',id:session.id,turnId:turn.id}),'text-button',FileDiff);review.dataset.focus=`review-${turn.id}`;action.append(review);}
    const result=cell(turnStatusLabel(turn),`outcome-${turn.outcome} ${turn.liveState==='running'?'live-running':''}`);
    if(turn.liveState==='running')result.prepend(createElement(LoaderCircle));
    tr.append(name,cell(date(turn.startedAt)),result,cell(durationLabel(turn.durationMs),'number'),cell(`${turn.files} / ${turn.operations}`,'number'),cell(turn.canReview?reviewLabels[turn.review]:'—'),action);grid.body.append(tr);
  }
  list.append(turns.length?grid.wrapper:empty('暂无回合记录'),pagination(turns.length,preferences.turnPage,30,next=>{preferences.turnPage=next;redraw();}));root.append(list);persist();
}
function render():void {
  const focused=document.hasFocus()?document.activeElement as HTMLElement|null:null,focusKey=focused?.dataset.focus,scroll=window.scrollY;
  $('workspace').textContent=state.workspace||'当前工作区';
  $('freshness').textContent=state.loading?'正在刷新…':state.updatedAt?`更新于 ${new Date(state.updatedAt).toLocaleTimeString('zh-CN')}`:'等待记录';
  $('refresh').classList.toggle('loading',state.loading);
  $('notice').hidden=!state.error;$('notice').textContent=state.error??'';
  const detailMode=!!state.selectedId;
  $('overview-page').hidden=detailMode;$('detail-page').hidden=!detailMode;
  if(detailMode){if(state.detail)detail(state.detail);else{$('detail-page').replaceChildren(button('返回工作区总览',()=>send({action:'overview'}),'back-link',ArrowLeft),empty(state.loading?'正在读取所选会话…':'该会话已移出当前工作区或记录已被删除。'));}}
  else {
    const directories=[...new Map(state.sessions.map(row=>[row.cwd,row.cwdLabel])).entries()].sort((a,b)=>a[1].localeCompare(b[1]));
    const signature=JSON.stringify(directories);
    if(signature!==directorySignature){directorySignature=signature;const select=$<HTMLSelectElement>('directory');select.replaceChildren();const all=el('option','','全部工作目录');all.value='';select.append(all);for(const [value,label] of directories){const option=el('option','',label);option.value=value;select.append(option);}if(preferences.cwd&&!directories.some(([cwd])=>cwd===preferences.cwd))preferences.cwd='';select.value=preferences.cwd;}
    overview();
  }
  if(focusKey){const next=[...document.querySelectorAll<HTMLElement>('[data-focus]')].find(el=>el.dataset.focus===focusKey);next?.focus({preventScroll:true});}
  window.scrollTo(0,scroll);
}
$('overview').append(createElement(ChartNoAxesCombined),el('span','','会话分析'));
$('overview').addEventListener('click',()=>send({action:'overview'}));
$('refresh').append(createElement(RefreshCw));$('refresh').addEventListener('click',()=>send({action:'refresh'}));
$('search-icon').append(createElement(Search));
$<HTMLInputElement>('query').value=preferences.query;
$('query').addEventListener('input',()=>{preferences.query=$<HTMLInputElement>('query').value;preferences.page=0;redraw();});
$('directory').addEventListener('change',()=>{preferences.cwd=$<HTMLSelectElement>('directory').value;preferences.page=0;redraw();});
window.addEventListener('message',event=>{
  if(event.data?.type!=='analysis')return;
  const next=event.data.state as AnalysisState;
  if(seenScope!==undefined&&seenScope!==next.scope){Object.assign(preferences,{query:'',cwd:'',page:0,turnPage:0,detailId:undefined,selectedTurn:undefined,chartPage:0});$<HTMLInputElement>('query').value='';directorySignature='';overviewScroll=0;}
  seenScope=next.scope;preferences.scope=next.scope;
  if(!shownId&&next.selectedId)overviewScroll=window.scrollY;
  const changed=shownId!==next.selectedId;
  shownId=next.selectedId;state=next;render();persist();
  if(changed)window.scrollTo(0,next.selectedId?0:overviewScroll);
});
send({action:'ready'});
