import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ExtensionContext } from 'vscode';
import { state } from './vscode-stub';
import { activate, deactivate } from '../src/extension';
import { binaryRelativePath, launcherPath } from '../src/launcher';
import { readWindowSpec } from '../src/window';

test('工作区选择独立保存、重载恢复、默认隔离，只有接管和停用修改全局入口', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-extension-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  t.after(deactivate);
  const home = path.join(dir, 'home'); const storage = path.join(dir, 'storage');
  await fs.mkdir(home);
  await fs.writeFile(path.join(home, 'good.config.toml'), 'model_provider = "relay"');
  await fs.writeFile(path.join(home, 'other.config.toml'), 'model_provider = "other"');
  await fs.writeFile(path.join(home, 'broken.config.toml'), '[incomplete');
  const base = 'model = "untouched"\n'; await fs.writeFile(path.join(home, 'config.toml'), base);
  state.extensionPath = path.join(dir, 'openai.chatgpt-test');
  const binary = path.join(state.extensionPath, binaryRelativePath());
  await fs.mkdir(path.dirname(binary), { recursive: true }); await fs.writeFile(binary, '#!/bin/sh\n', { mode: 0o700 });
  state.values.set('codexProfiles.codexHome', home);
  state.values.set('chatgpt.cliExecutable', '/previous/startup');
  const projectA = new Map<string, unknown>(); const projectB = new Map<string, unknown>();
  const context = (values: Map<string, unknown>) => ({
    globalStorageUri: { fsPath: storage }, asAbsolutePath: (file: string) => path.resolve(file), subscriptions: [],
    workspaceState: { get: (key: string) => values.get(key), update: async (key: string, value: unknown) => { values.set(key, value); } }
  }) as unknown as ExtensionContext;
  await activate(context(projectA));
  assert.equal(state.updates.length, 0);
  state.choice = 'broken'; await state.commands.get('codexProfiles.switch')!();
  assert.equal(state.updates.length, 0);
  state.choice = 'good'; await state.commands.get('codexProfiles.switch')!();
  assert.equal(state.updates.length, 1);
  assert.match(state.status.text, /good · 待重载/);
  assert.equal(JSON.parse(await fs.readFile(path.join(storage, 'previous-startup.json'), 'utf8')).cliExecutable, '/previous/startup');
  // 保存之后本次宿主仍提供旧选择，重载才启用新值。
  assert.equal((await readWindowSpec(storage, process.pid)).profile, null);
  await deactivate();
  await activate(context(projectA));
  assert.equal((await readWindowSpec(storage, process.pid)).profile, 'good');
  assert.doesNotMatch(state.status.text, /待重载/);
  await deactivate();
  await activate(context(projectB));
  assert.equal((await readWindowSpec(storage, process.pid)).profile, null);
  state.choice = 'other'; await state.commands.get('codexProfiles.switch')!();
  assert.equal(state.updates.length, 1);
  await deactivate();
  await activate(context(projectA));
  assert.equal((await readWindowSpec(storage, process.pid)).profile, 'good');
  await state.commands.get('codexProfiles.reset')!();
  assert.equal(state.updates.length, 1);
  assert.equal(state.values.get('chatgpt.cliExecutable'), launcherPath(storage));
  assert.equal((projectA.get('windowSelection') as { profile: string | null }).profile, null);
  assert.equal((projectB.get('windowSelection') as { profile: string }).profile, 'other');
  await state.commands.get('codexProfiles.disconnect')!();
  assert.equal(state.updates.length, 1);
  state.confirmDisconnect = true;
  await state.commands.get('codexProfiles.disconnect')!();
  assert.equal(state.values.get('chatgpt.cliExecutable'), undefined);
  assert.equal(state.updates.length, 2);
  assert.equal(await fs.readFile(path.join(home, 'config.toml'), 'utf8'), base);
});
