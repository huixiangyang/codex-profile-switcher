import { promises as fs } from 'node:fs';
import path from 'node:path';
import { canonicalPath, formatWorkingDirectory } from './catalog';
import { readAppended, type JsonlCache } from './jsonl';
import { RolloutSummary, consumeTitle, type TitleIndex } from './rollout';
import { decodePatch, type PatchBody } from './turns';
import { object } from '../live/json';
import type { Session } from './types';

async function rolloutFiles(directory: string, signal: AbortSignal): Promise<string[]> {
  signal.throwIfAborted();
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      try { files.push(...await rolloutFiles(file, signal)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(file);
  }
  return files;
}

export interface RecordList { sessions: Session[]; sourceAvailable: boolean; warning?: string; resetIds?: string[] }
export class LocalSessionRecords {
  private files = new Map<string, JsonlCache<RolloutSummary>>();
  private names?: JsonlCache<TitleIndex>;
  private abort = new AbortController();
  constructor(readonly home: string) {}
  async list(roots: string[]): Promise<RecordList> {
    const signal = this.abort.signal;
    const directory = path.join(this.home, 'sessions');
    let paths: string[];
    try { paths = await rolloutFiles(directory, signal); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.files.clear(); return { sessions: [], sourceAvailable: false }; }
      throw new Error('无法读取 Codex 会话目录，请检查配置目录和文件权限。');
    }
    let unreadable = 0;
    try {
      const previous = this.names; this.names = undefined;
      const next = await readAppended(path.join(this.home, 'session_index.jsonl'), previous, () => new Map(), consumeTitle, signal);
      if (!signal.aborted) this.names = next;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.names = undefined;
      else if (!signal.aborted) unreadable++;
    }
    const live = new Set(paths);
    for (const file of this.files.keys()) if (!live.has(file)) this.files.delete(file);
    let index = 0; const resetIds: string[] = [];
    // 初次流式扫描，之后只读取增长部分；限制并发以免影响用户的实际开发任务。
    await Promise.all(Array.from({ length: Math.min(4, paths.length) }, async () => {
      while (index < paths.length && !signal.aborted) {
        const file = paths[index++];
        try {
          // 读取器原地更新摘要；失败或取消后不能保留已消费但游标未提交的半成品。
          const previous = this.files.get(file); this.files.delete(file);
          const next = await readAppended(file, previous, () => new RolloutSummary(), (summary, line) => summary.consume(line), signal);
          if (previous && next.value !== previous.value) resetIds.push(previous.value.id);
          if (!signal.aborted) this.files.set(file, next);
        }
        catch (error) { if (!signal.aborted) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') unreadable++; this.files.delete(file); } }
      }
    }));
    if (signal.aborted) return { sessions: [], sourceAvailable: false };
    const canonicalRoots = await Promise.all(roots.map(canonicalPath));
    const directories = new Map<string, string>();
    await Promise.all([...new Set([...this.files.values()].map(cache => cache.value.cwd).filter(Boolean))].map(async cwd => directories.set(cwd, await canonicalPath(cwd))));
    const sessions: Session[] = [];
    for (const { value: record, cursor } of this.files.values()) {
      if (!record.interactive) continue;
      if (!record.id || !path.isAbsolute(record.cwd)) { if (cursor.offset) unreadable++; continue; }
      const label = formatWorkingDirectory(canonicalRoots, directories.get(record.cwd)!);
      if (label === undefined) continue;
      const named = this.names?.value.get(record.id);
      const snapshot = record.snapshot();
      sessions.push({ createdAt: record.createdAt, id: record.id, cwd: record.cwd, cwdLabel: label, title: named?.title || record.preview || '未命名会话',
        provider: record.provider, model: record.model, updatedAt: Math.max(record.updatedAt, cursor.mtimeMs / 1000, named?.updatedAt ?? 0), ...snapshot });
    }
    sessions.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    return { sessions, resetIds, sourceAvailable: true, warning: unreadable ? `${unreadable} 个本地记录文件暂时无法读取，列表可能不完整。` : undefined };
  }
  async patches(id: string, turnId: string): Promise<PatchBody[]> {
    const file = [...this.files].find(([, cache]) => cache.value.id === id)?.[0];
    if (!file) return [];
    const result = await readAppended(file, undefined, () => new Map<string, PatchBody>(), (items, line) => {
      if (!line.includes('FileChange')) return;
      try {
        const record = object(JSON.parse(line)), p = object(record?.payload);
        if (record?.type !== 'event_msg' || p?.type !== 'item_completed' || p.turn_id !== turnId) return;
        const body = decodePatch(p.item, typeof p.completed_at_ms === 'number' ? p.completed_at_ms : Date.parse(String(record.timestamp)), true);
        if (body) items.set(body.item.id, body);
      } catch { /* 损坏记录不作为补丁证据。 */ }
    }, this.abort.signal);
    return [...result.value.values()];
  }
  dispose(): void { this.abort.abort(); this.files.clear(); this.names = undefined; }
}
