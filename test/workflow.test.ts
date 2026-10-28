import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionWorkflow } from '../src/sessions/workflow';
import { newTurn, decodePatch, setItem, evidenceVersion, renderPatch, maxPatchBytes } from '../src/sessions/turns';
import { LocalSessionRecords } from '../src/sessions/records';
import { reviewFileTarget } from '../src/sessions/review';
import { LiveSessions } from '../src/live/channel';
import type { Session } from '../src/sessions/types';
const sample = (): Session => ({ createdAt: 1, id:'s', title:'审阅', cwd:'/workspace', cwdLabel:'workspace', updatedAt:0, provider:'',model:'',state:'finished',stateAt:0,stateReason:'lifecycle',turns:[],stats:{tokens:null,counts:null,lastDurationMs:null,recordedDurationMs:null,timedTurns:0,inherited:false,incomplete:false} });
function storage() { let saved: unknown; let fail = false; return { get: <T>() => saved as T, update: async (_key: string, value: unknown) => { if(fail) throw new Error('write failed'); saved = structuredClone(value); }, fail: (value: boolean) => { fail=value; } }; }

test('基线、逐轮确认、重启、晚到改动和目录隔离；保存失败不改变审阅状态', async () => {
  const memory = storage(), flow = new SessionWorkflow(memory), session = sample();
  const old={...newTurn('old'),outcome:'completed' as const,endedAt:1}; session.turns=[old];
  await flow.enroll('/source',[session]); assert.equal(flow.pending('/source',session).length,0);
  const a={...newTurn('a'),outcome:'completed' as const,endedAt:2}, b={...newTurn('b'),outcome:'completed' as const,endedAt:3}; session.turns.push(a,b);
  await flow.enroll('/source',[session]); await flow.opened('/source',session);
  assert.equal(flow.pending('/source',session).length,2);
  await flow.mark('/source','s',a,true); assert.deepEqual(flow.pending('/source',session).map(t=>t.id),['b']);
  const restarted = new SessionWorkflow(memory); assert.equal(restarted.status('/source','s',a),'reviewed');
  const fixture=JSON.parse(await fs.readFile('test/fixtures/recorded-file-change.json','utf8'));
  const body=decodePatch(fixture.live.item,fixture.live.completedAtMs)!;
  setItem(a,body.item); assert.equal(restarted.status('/source','s',a),'updated');
  memory.fail(true); await assert.rejects(restarted.mark('/source','s',a,true)); assert.equal(restarted.status('/source','s',a),'updated');
  memory.fail(false); await restarted.mark('/source','s',a,true); setItem(a,body.item); assert.equal(restarted.status('/source','s',a),'reviewed');
  await restarted.mark('/source','s',a,false); assert.equal(restarted.status('/source','s',a),'pending');
  await restarted.enroll('/other',[session]); assert.equal(restarted.pending('/other',session).length,0);
  const failed={...newTurn('failed'),outcome:'failed' as const,endedAt:4}; session.turns.push(failed);
  assert.equal(restarted.state('/source',session).attention,'failure'); await restarted.opened('/source',session); assert.equal(restarted.state('/source',session).attention,null);
  setItem(failed,body.item); assert.ok(restarted.pending('/source',session).some(t=>t.id==='failed'));
  const live = new LiveSessions(); live.entries.set('s',{id:'s',state:'input',at:20,waitingSince:10});
  assert.equal(restarted.state('/source',session,live).attention,'waiting'); live.entries.clear(); assert.equal(restarted.state('/source',session,live).active,false);
});

test('真实落盘夹具与协议得到同一证据；按需恢复新增修改删除，不读当前代码拼补丁', async t => {
  const fixture=JSON.parse(await fs.readFile('test/fixtures/recorded-file-change.json','utf8'));
  const recorded=decodePatch(fixture.record.item,fixture.record.completed_at_ms,true)!;
  const streamed=decodePatch(fixture.live.item,fixture.live.completedAtMs)!;
  assert.equal(recorded.item.fingerprint,streamed.item.fingerprint);
  assert.doesNotMatch(renderPatch({path:'empty',kind:'add',diff:''}),/@@/);
  assert.match(renderPatch({path:'no-newline',kind:'add',diff:'one'}),/No newline at end of file/);
  assert.equal(recorded.patches.length,3); assert.match(renderPatch(recorded.patches.find(p=>p.kind==='update')!),/-old\n\+updated/);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-records-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const dir=path.join(root,'sessions'); await fs.mkdir(dir); const id=fixture.record.turn_id;
  const lines=[{type:'session_meta',timestamp:'2026-10-22T08:00:00Z',payload:{id:'s',cwd:root,source:'vscode'}},
    {type:'event_msg',timestamp:'2026-10-22T08:10:00Z',payload:{type:'task_started',turn_id:id}},
    {type:'event_msg',timestamp:'2026-10-22T08:10:04Z',payload:fixture.record},
    {type:'event_msg',timestamp:'2026-10-22T08:10:05Z',payload:{type:'task_complete',turn_id:id,duration_ms:5000}}];
  const file=path.join(dir,'s.jsonl'), content=lines.map(v=>JSON.stringify(v)+'\n').join(''); await fs.writeFile(file,content);
  const records=new LocalSessionRecords(root); t.after(()=>records.dispose());
  const result=await records.list([root]); const turn=result.sessions[0].turns[0];
  assert.equal(turn.items[0].fingerprint,streamed.item.fingerprint);
  assert.equal((await records.patches('s',id))[0].item.fingerprint,streamed.item.fingerprint);
  assert.equal(await fs.readFile(file,'utf8'),content); assert.match(evidenceVersion(turn),/^[a-f0-9]{64}$/);
  const huge=decodePatch({type:'fileChange',id:'large',status:'completed',changes:[{path:'/workspace/x',kind:{type:'add'},diff:'x'.repeat(maxPatchBytes+1)}]},1)!;
  assert.ok(huge.item.bytes>maxPatchBytes);
});

test('当前文件导航限制到工作区，拒绝符号链接越界与缺失文件', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-path-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const workspace=path.join(root,'workspace'); await fs.mkdir(workspace); await fs.writeFile(path.join(workspace,'ok.ts'),'user edit'); await fs.writeFile(path.join(root,'outside'),'private');
  await fs.symlink(path.join(root,'outside'),path.join(workspace,'link'));
  assert.equal(await reviewFileTarget(workspace,'ok.ts',[workspace,path.join(root,'missing-root')]),await fs.realpath(path.join(workspace,'ok.ts')));
  await assert.rejects(reviewFileTarget(workspace,'link',[workspace]),/工作区/);
  await assert.rejects(reviewFileTarget(workspace,'../outside',[workspace]),/工作区/);
  await assert.rejects(reviewFileTarget(workspace,'deleted',[workspace]),{code:'ENOENT'});
  assert.equal(await fs.readFile(path.join(workspace,'ok.ts'),'utf8'),'user edit');
});
