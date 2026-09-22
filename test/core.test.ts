import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { parse } from 'smol-toml';
import { profileArgs, readProfile, listProfiles, profilePath } from '../src/profiles';
import { createLauncher, resolveBinary } from '../src/launcher';
import { serveWindow, readWindowSpec } from '../src/window';

test('profile 参数保留嵌套字面键、数组、Unicode、换行和日期', () => {
  const profile = parse(`model_provider = 'example'\nnote = "你好\\nworld"\ndate = 2026-09-22\n[projects."/tmp/a.b"]\ntrust_level = 'trusted'\n[[hooks.Stop]]\ncommand = 'printf "a; b"'\n`);
  const args = profileArgs(profile);
  const restored = args.filter((_, i) => i % 2 === 1).reduce((all, value) => Object.assign(all, parse(value)), {});
  assert.deepEqual(restored, profile);
  assert.throws(() => profilePath('/tmp', '../escape'));
});

test('扫描保留错误项但不回显原始配置；拒绝损坏 profile', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-profiles-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'valid.config.toml'), 'model_provider = "relay"');
  await fs.writeFile(path.join(dir, 'bad.config.toml'), 'token = "SECRET_SENTINEL');
  await fs.writeFile(path.join(dir, 'config.toml'), 'model = "base"');
  const profiles = await listProfiles(dir);
  assert.deepEqual(profiles.map(x => x.name), ['bad', 'valid']);
  assert.ok(profiles[0].error);
  assert.ok(!JSON.stringify(profiles).includes('SECRET_SENTINEL'));
  await assert.rejects(readProfile(dir, 'bad'), /TOML/);
});

test('优先使用当前扩展追加到 PATH 的配套程序，支持升级', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-binary-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const old = path.join(dir, 'openai.chatgpt-old/bin/macos-aarch64/codex');
  const latest = path.join(dir, 'openai.chatgpt-new/bin/macos-aarch64/codex');
  for (const file of [old, latest]) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, '#!/bin/sh\n', { mode: 0o700 }); }
  const spec = { version: 2 as const, profile: 'relay', codexHome: dir, binary: old };
  assert.equal(await resolveBinary(spec, `/usr/bin:${path.dirname(latest)}`), latest);
});

test('实际启动脚本透传 stdio、参数、退出信号，并处理含空格和引号的路径', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex ' launcher-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home');
  await fs.mkdir(home);
  await fs.writeFile(path.join(home, 'relay.config.toml'), 'model_provider = "relay"\nmodel_reasoning_effort = "high"');
  const binary = path.join(dir, 'codex');
  await fs.writeFile(binary, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({args:process.argv.slice(2),home:process.env.CODEX_HOME})+'\\n');\nprocess.stdin.pipe(process.stdout);\nprocess.on('SIGTERM',()=>process.exit(42));\n`, { mode: 0o700 });
  const spec = { version: 2 as const, profile: 'relay', codexHome: home, binary };
  const storage = path.join(dir, 'storage');
  const executable = await createLauncher(storage, path.resolve('dist/bridge.cjs'), process.execPath);
  const child = spawn(executable, ['app-server', '--analytics-default-enabled'], { stdio: ['pipe', 'pipe', 'pipe'] });
  // 模拟官方扩展先启动、切换器随后激活的真实顺序。
  await new Promise(resolve => setTimeout(resolve, 150));
  const stop = await serveWindow(storage, spec);
  t.after(stop);
  assert.deepEqual(await readWindowSpec(storage, process.pid), spec);
  await assert.rejects(readWindowSpec(storage, 0, 100), /所属窗口/);
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  child.stderr.setEncoding('utf8'); let stderr = ''; child.stderr.on('data', data => { stderr += data; });
  child.stdout.setEncoding('utf8');
  let output = '';
  const waitFor = async (needle: string) => {
    const deadline = Date.now() + 5000;
    while (!output.includes(needle)) {
      if (Date.now() > deadline || child.exitCode !== null) throw new Error(`启动或 stdio 失败：${stderr}`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  child.stdout.on('data', data => { output += data; });
  await waitFor('\n');
  const startup = JSON.parse(output.split('\n')[0]);
  assert.deepEqual(startup.args, ['-c', 'model_provider="relay"', '-c', 'model_reasoning_effort="high"', 'app-server', '--analytics-default-enabled']);
  assert.equal(startup.home, home);
  child.stdin.write('protocol-message\n');
  await waitFor('protocol-message\n');
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  assert.equal((await exited)[0], 42);
  assert.equal(stderr, '');
});

test('两个窗口并行使用同一入口：各自配置独立，窗口 A 恢复默认不改变窗口 B', { timeout: 15000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-windows-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home'); const storage = path.join(dir, 'storage');
  await fs.mkdir(home);
  await fs.writeFile(path.join(home, 'alpha.config.toml'), 'model_provider = "alpha"');
  await fs.writeFile(path.join(home, 'beta.config.toml'), 'model_provider = "beta"');
  const binary = path.join(dir, 'codex');
  await fs.writeFile(binary, `#!${process.execPath}\nconst report=()=>process.stdout.write(JSON.stringify(process.argv.slice(2))+'\\n');\nreport(); process.stdin.on('data',report); process.on('SIGTERM',()=>process.exit(0));\n`, { mode: 0o700 });
  await createLauncher(storage, path.resolve('dist/bridge.cjs'), process.execPath);
  const start = async (profile: string | null) => {
    const host = spawn(process.execPath, [path.resolve('.test-build/window-host.cjs'), storage, JSON.stringify({ version: 2, profile, codexHome: home, binary })], { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = createInterface({ input: host.stdout })[Symbol.asyncIterator]();
    const read = async () => {
      const line = await lines.next();
      assert.ok(!line.done, '窗口后端不应提前退出');
      return JSON.parse(line.value) as string[];
    };
    const stop = async () => {
      if (host.exitCode !== null || host.signalCode !== null) return;
      const exited = once(host, 'exit');
      host.kill('SIGTERM');
      const timer = setTimeout(() => host.kill('SIGKILL'), 2000);
      try { await exited; } finally { clearTimeout(timer); }
    };
    t.after(stop);
    return { host, read, stop, args: await read() };
  };
  const [a, b] = await Promise.all([start('alpha'), start('beta')]);
  assert.deepEqual(a.args, ['-c', 'model_provider="alpha"', 'app-server']);
  assert.deepEqual(b.args, ['-c', 'model_provider="beta"', 'app-server']);
  await a.stop();
  const defaultA = await start(null);
  assert.deepEqual(defaultA.args, ['app-server']);
  b.host.stdin.write('check\n');
  assert.deepEqual(await b.read(), b.args);
  await Promise.all([defaultA.stop(), b.stop()]);
});
