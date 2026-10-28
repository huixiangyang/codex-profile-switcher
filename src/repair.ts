import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './launcher';

export interface Replacement { before: string; after: string }
export interface RepairSpec {
  version: string;
  files: { file: string; sha256: string; replacements: Replacement[] }[];
}

// 只接受排查时核验过的完整文件；升级后必须重新审查，不猜测压缩后的变量名。
export const codexRepair: RepairSpec = {
  version: '26.5928.31416',
  files: [{
    file: 'out/extension.js',
    sha256: '550b03e76ac5a83cb25788aa3240ba445d0e7c7d4e76af8331442687529617ef',
    replacements: [{
      before: '"queued-follow-up-send-lock-release":async({conversationId:e,messageId:r,lockId:n,sent:o})=>{this.queuedFollowUpSendLocks.release({conversationId:e,messageId:r,lockId:n,sent:o})}',
      after: '"queued-follow-up-send-lock-release":async({conversationId:e,messageId:r,lockId:n,sent:o})=>{this.queuedFollowUpSendLocks.release({conversationId:e,messageId:r,lockId:n,sent:o});return{success:!0}}'
    }]
  }, {
    file: 'webview/assets/app-initial-f1c3ec6698cf.js',
    sha256: 'bf564381f3a6943717b8caada9e038d5f2c144d0fff6462ab0a1dc3d4ed72afb',
    replacements: [{
      // 禁止拾取其他窗口的共享队列；保留本窗口刚接收的普通新消息。
      before: 'this.execution==null||this.pending.has(e)||this.automaticTurnDeferrals.has(e)||this.options.getStreamRole(e)?.role===`follower`',
      after: 'this.execution==null||this.pending.has(e)||this.automaticTurnDeferrals.has(e)||this.options.getStreamRole(e)?.role===`follower`||this.options.getStreamRole(e)?.role!==`owner`&&!this.accepted.get(e)?.has(this.#s(e)?.id)'
    }, {
      // 执行入口再检查所有权；本窗口提交仍须通过上游的所有权检查。
      before: 'if(n==null&&this.options.getStreamRole(e)?.role!==`owner`&&!t.canAcquireOwnership(e)||',
      after: 'if(n==null&&this.options.getStreamRole(e)?.role!==`owner`&&(!this.accepted.get(e)?.has(this.#s(e)?.id)||!t.canAcquireOwnership(e))||'
    }]
  }]
};

export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function replaceExactly(source: string, replacements: Replacement[], restore = false): string {
  for (const replacement of replacements) {
    const [before, after] = restore ? [replacement.after, replacement.before] : [replacement.before, replacement.after];
    const index = source.indexOf(before);
    if (index < 0 || source.indexOf(before, index + before.length) >= 0) {
      throw new Error('Codex 修复位置不唯一或已变化，未写入文件。');
    }
    source = source.slice(0, index) + after + source.slice(index + before.length);
  }
  return source;
}

interface RepairFile {
  file: string; current: string; original: string; patched: string; mode: number;
}

async function readRegular(file: string): Promise<{ content: string; mode: number }> {
  const info = await fs.lstat(file);
  if (!info.isFile()) throw new Error('Codex 修复目标必须是普通文件，未写入文件。');
  return { content: await fs.readFile(file, 'utf8'), mode: info.mode & 0o777 };
}

async function planRepair(root: string, spec: RepairSpec): Promise<RepairFile[]> {
  const metadata = JSON.parse((await readRegular(path.join(root, 'package.json'))).content);
  if (metadata.publisher !== 'openai' || metadata.name !== 'chatgpt' || metadata.version !== spec.version) {
    throw new Error(`当前仅提供官方 Codex ${spec.version} 的定向修复；此版本不受支持，未写入文件。`);
  }
  const files: RepairFile[] = [];
  for (const entry of spec.files) {
    const { content: current, mode } = await readRegular(path.join(root, entry.file));
    let original = current;
    if (sha256(original) !== entry.sha256) {
      try { original = replaceExactly(current, entry.replacements, true); }
      catch { throw new Error(`Codex 文件校验失败（${entry.file}），未写入文件。`); }
      if (sha256(original) !== entry.sha256) throw new Error(`Codex 文件校验失败（${entry.file}），未写入文件。`);
    }
    files.push({ file: entry.file, current, original, patched: replaceExactly(original, entry.replacements), mode });
  }
  return files;
}

// 使用内核管理的 TCP 监听锁，进程退出时自动释放；不遗留需要手工清理的锁文件。
// 回环端口只用于互斥，不接收命令，也不传输配置或扩展内容。
async function lockRepair(root: string): Promise<() => Promise<void>> {
  const { createServer } = await import('node:net');
  const server = createServer(client => client.destroy());
  const port = 40000 + (parseInt(sha256(root).slice(0, 8), 16) % 20000);
  await new Promise<void>((resolve, reject) => {
    server.once('error', () => reject(new Error('Codex 修复互斥端口被占用，请等待其他窗口完成修复后重试。')));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
  return () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

export async function repairCodex(
  extensionRoot: string, storage: string, restore = false, spec: RepairSpec = codexRepair
): Promise<{ changed: boolean; backup: string }> {
  const root = await fs.realpath(extensionRoot);
  const unlock = await lockRepair(root);
  try {
    // 所有文件先校验，再备份，再写入。异常中断留下的混合状态可重试或还原。
    const files = await planRepair(root, spec);
    const backup = path.join(storage, 'codex-repairs', `${spec.version}-${sha256(root).slice(0, 24)}`);
    const changes = files.filter(file => file.current !== (restore ? file.original : file.patched));
    if (!changes.length) return { changed: false, backup };
    await fs.mkdir(backup, { recursive: true, mode: 0o700 });
    for (const file of files) {
      const saved = path.join(backup, path.basename(file.file));
      try {
        if (sha256((await readRegular(saved)).content) !== sha256(file.original)) {
          throw new Error('Codex 修复备份校验失败，未写入扩展文件。');
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (restore || file.current !== file.original) throw new Error('找不到可信的 Codex 原文件备份，未写入扩展文件。');
        await atomicWrite(saved, file.original);
      }
    }
    await atomicWrite(path.join(backup, 'manifest.json'), JSON.stringify({
      version: spec.version, extensionRoot: root,
      files: files.map(file => ({ file: file.file, original: sha256(file.original), patched: sha256(file.patched) }))
    }, null, 2));
    const written: RepairFile[] = [];
    try {
      for (const file of changes) {
        const target = path.join(root, file.file);
        if (sha256((await readRegular(target)).content) !== sha256(file.current)) {
          throw new Error('Codex 文件在修复期间发生变化，停止写入。');
        }
        await atomicWrite(target, restore ? file.original : file.patched, file.mode);
        written.push(file);
      }
      for (const file of files) {
        if (sha256((await readRegular(path.join(root, file.file))).content) !== sha256(restore ? file.original : file.patched)) {
          throw new Error('Codex 修复后的文件校验失败。');
        }
      }
    } catch (error) {
      let incomplete = false;
      for (const file of written.reverse()) {
        try {
          const target = path.join(root, file.file);
          // 不覆盖同时发生的官方升级或第三方改动。
          if (sha256((await readRegular(target)).content) !== sha256(restore ? file.original : file.patched)) throw new Error();
          await atomicWrite(target, file.current, file.mode);
        } catch { incomplete = true; }
      }
      if (incomplete) throw new Error(`Codex 修复中断且部分文件无法回滚，请保留备份并重新安装官方扩展。备份：${backup}`);
      throw error;
    }
    return { changed: true, backup };
  } finally { await unlock(); }
}
