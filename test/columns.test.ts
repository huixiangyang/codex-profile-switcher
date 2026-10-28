import test from 'node:test';
import assert from 'node:assert/strict';
import { ColumnLayoutSettings, columnWidth, columns, defaultColumnLayout, isColumnLayout, resolveColumns } from '../src/sessions/columns';
import { isViewMessage } from '../src/sessions/types';

test('默认列保持响应式；手选列不再自动隐藏，宽度有可读下限，标题不能关闭', () => {
  assert.deepEqual(resolveColumns(defaultColumnLayout(), 540, 524).visible, ['title','status','tokens','rounds']);
  assert.equal(resolveColumns(defaultColumnLayout(), 822, 806).widths.tokens, 136);
  const custom = { ...defaultColumnLayout(), visible: columns.map(column=>column.id) };
  const result = resolveColumns(custom, 540, 524);
  assert.equal(result.visible.length, 8); assert.ok(result.width > 524);
  assert.equal(columnWidth('tokens', 40), 136);
  assert.equal(columnWidth('title', 99999), 4096);
  assert.equal(isColumnLayout({version:1,visible:['tokens'],widths:{}}), false);
  assert.equal(isColumnLayout({version:1,visible:['title','title'],widths:{}}), false);
  assert.equal(isColumnLayout({version:1,visible:null,widths:{tokens:NaN}}), false);
  assert.equal(isViewMessage({action:'layout',layout:custom,requestId:'request-1'}), true);
  assert.equal(isViewMessage({action:'layout',layout:{version:1,visible:null,widths:{unknown:100}},requestId:'request-1'}), false);
  assert.equal(isViewMessage({action:'layout',layout:custom}), false);
});

test('布局按工作区保存与重载；写入串行，失败保留已保存状态，恢复默认可持久化', async () => {
  const values = new Map<string, unknown>(); let fail = false;
  const storage = {get:<T>(key:string)=>values.get(key) as T|undefined,update:async(key:string,value:unknown)=>{if(fail)throw new Error('fixture error');values.set(key,structuredClone(value));}};
  const a = new ColumnLayoutSettings(storage);
  const custom = { ...defaultColumnLayout(), visible:['title','tokens'] as const, widths:{title:280,tokens:180} };
  const preferences = { ...custom, visible:[...custom.visible] };
  await a.save(preferences,'first');
  const reloaded = new ColumnLayoutSettings(storage); assert.deepEqual(reloaded.layout,preferences);
  const other = new ColumnLayoutSettings({get:()=>undefined,update:async()=>{}}); assert.deepEqual(other.layout,defaultColumnLayout());
  fail = true; await a.save({...preferences,widths:{tokens:220}},'failed');
  assert.deepEqual(a.layout,preferences); assert.equal(a.ack,'failed'); assert.match(a.error!,/保存失败/);
  fail = false;
  await Promise.all([a.save({...preferences,widths:{title:320}},'second'),a.save(defaultColumnLayout(),'reset')]);
  await a.flush(); assert.equal(a.ack,'reset'); assert.equal(a.error,undefined);
  assert.deepEqual(new ColumnLayoutSettings(storage).layout,defaultColumnLayout());
});
