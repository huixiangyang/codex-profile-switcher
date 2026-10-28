import test from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { openSession, supportsNavigation, navigationError, supportedCodexVersion } from '../src/sessions/navigation';
import { state } from './vscode-stub';

test('新版 Codex 使用当前窗口的侧栏 URI；版本不符时停止并指出两个版本', async t => {
  const before = state.extensionVersion;
  t.after(() => { state.extensionVersion = before; });
  const calls: { command: string; args: unknown[] }[] = [];
  t.mock.method(vscode.env, 'asExternalUri', async (uri: vscode.Uri) => {
    assert.equal(uri.scheme, 'vscode'); assert.equal(uri.authority, 'openai.chatgpt');
    assert.equal(uri.path, '/local/00000000-0000-4000-8000-000000000001');
    return vscode.Uri.from({scheme:uri.scheme,authority:uri.authority,path:uri.path,query:'windowId=fixture'});
  });
  t.mock.method(vscode.commands, 'executeCommand', async (command: string, ...args: unknown[]) => { calls.push({command,args}); });
  state.extensionVersion = supportedCodexVersion;
  assert.equal(supportsNavigation(), true); assert.equal(navigationError(), undefined);
  await openSession('00000000-0000-4000-8000-000000000001');
  assert.deepEqual(calls.map(call => call.command), ['vscode.open']);
  assert.equal((calls[0].args[0] as vscode.Uri).query, 'windowId=fixture');
  state.extensionVersion = '26.51007.21434';
  assert.equal(supportsNavigation(), false);
  assert.ok(navigationError()?.includes(state.extensionVersion)); assert.ok(navigationError()?.includes(supportedCodexVersion));
  await assert.rejects(openSession('unverified'), /请检查官方 Codex/); assert.equal(calls.length, 1);
  t.mock.method(vscode.extensions, 'getExtension', () => undefined);
  assert.equal(supportsNavigation(), false); await assert.rejects(openSession('missing'), /请先安装官方 Codex/);
});
