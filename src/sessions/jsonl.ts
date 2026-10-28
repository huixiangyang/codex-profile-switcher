import { promises as fs } from 'node:fs';

interface Cursor { dev: number; ino: number; size: number; mtimeMs: number; offset: number }
export interface JsonlCache<T> { value: T; cursor: Cursor }

/** 只读完整行并原地更新摘要；调用方在失败时必须丢弃旧缓存。末尾半行不提交游标。 */
export async function readAppended<T>(
  file: string, previous: JsonlCache<T> | undefined, create: () => T,
  consume: (value: T, line: string) => void, signal: AbortSignal
): Promise<JsonlCache<T>> {
  signal.throwIfAborted();
  const current = await fs.stat(file);
  signal.throwIfAborted();
  if (previous && previous.cursor.dev === current.dev && previous.cursor.ino === current.ino
    && previous.cursor.size === current.size && previous.cursor.mtimeMs === current.mtimeMs) return previous;
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    const append = previous && previous.cursor.dev === stat.dev && previous.cursor.ino === stat.ino && stat.size > previous.cursor.size;
    const value = append ? previous.value : create();
    let offset = append ? previous.cursor.offset : 0;
    if (stat.size > offset) {
      const stream = handle.createReadStream({ start: offset, end: stat.size - 1, autoClose: false, signal, highWaterMark: 128 * 1024 });
      let fragments: Buffer[] = [], length = 0;
      for await (const chunk of stream) {
        const bytes = chunk as Buffer;
        let start = 0, end: number;
        while ((end = bytes.indexOf(10, start)) >= 0) {
          const tail = bytes.subarray(start, end);
          // 超长行只在闭合时合并一次，避免每个分块都复制已有整行。
          const line = (fragments.length ? Buffer.concat([...fragments, tail], length + tail.length) : tail).toString('utf8');
          offset += length + tail.length + 1;
          fragments = []; length = 0; start = end + 1;
          if (line.trim()) consume(value, line);
        }
        if (start < bytes.length) { const tail = bytes.subarray(start); fragments.push(tail); length += tail.length; }
      }
    }
    signal.throwIfAborted();
    return { value, cursor: { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, offset } };
  } finally { await handle.close(); }
}
