// 只在临时副本中应用补丁，不触碰已安装扩展、个人配置或运行中的窗口。
import { build } from 'esbuild';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

if (!process.argv[2]) throw new Error('请提供已安装的 openai.chatgpt 扩展目录；脚本只校验其临时副本。');
const source = path.resolve(process.argv[2]);
const temp = await mkdtemp(path.join(os.tmpdir(), 'codex-repair-verify-'));
try {
  const bundle = path.join(temp, 'repair.cjs');
  await build({ entryPoints: ['src/repair.ts'], bundle: true, platform: 'node', target: 'node20', format: 'cjs', outfile: bundle });
  const { codexRepair, repairCodex, sha256 } = createRequire(import.meta.url)(bundle);
  const copy = path.join(temp, 'extension');
  await mkdir(copy);
  await writeFile(path.join(copy, 'package.json'), await readFile(path.join(source, 'package.json')));
  const hashes = new Map();
  for (const entry of codexRepair.files) {
    const content = await readFile(path.join(source, entry.file));
    hashes.set(entry.file, sha256(content));
    await mkdir(path.dirname(path.join(copy, entry.file)), { recursive: true });
    await writeFile(path.join(copy, entry.file), content);
  }
  const storage = path.join(temp, 'storage');
  await repairCodex(copy, storage);
  for (const entry of codexRepair.files) {
    const checked = spawnSync(process.execPath, ['--check', path.join(copy, entry.file)], { encoding: 'utf8' });
    if (checked.status !== 0) throw new Error(`修复后语法检查失败：${entry.file}`);
  }
  if ((await repairCodex(copy, storage)).changed) throw new Error('重复应用不是幂等操作。');
  await repairCodex(copy, storage, true);
  for (const entry of codexRepair.files) {
    if (sha256(await readFile(path.join(copy, entry.file))) !== hashes.get(entry.file)) throw new Error('还原后的副本与原文件不同。');
    if (sha256(await readFile(path.join(source, entry.file))) !== hashes.get(entry.file)) throw new Error('已安装扩展在验证期间被外部修改。');
  }
  console.log(`Codex ${codexRepair.version}：两个真实文件的哈希匹配、修复、语法检查、重复应用和逐字节还原均通过。`);
  console.log('已安装扩展未修改；未验证真实窗口交互、模型发送或 Electron 崩溃恢复。');
} finally { await rm(temp, { recursive: true, force: true }); }
