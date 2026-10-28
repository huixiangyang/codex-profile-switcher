import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { Readable } from 'node:stream';

/** 主链路仅复制有界分块；观测失败时停掉旁路，原始字节继续透传。 */
export function observeOutput(output: Readable, socket: string): () => void {
  let pending = 0, stopped = false;
  let worker: Worker;
  const stop = () => {
    if (stopped) return;
    stopped = true; output.off('data', consume); void worker?.terminate();
  };
  const consume = (chunk: Buffer) => {
    if (pending + chunk.length > 2 * 1024 * 1024) { stop(); return; }
    pending += chunk.length;
    try {
      // 复制独立缓冲再移交，不能转移正在转发的 Buffer，也不复制整块 Node 内存池。
      const copy = Uint8Array.from(chunk); worker.postMessage(copy, [copy.buffer]);
    } catch { stop(); }
  };
  try {
    worker = new Worker(path.join(__dirname, 'observer.cjs'), { workerData: { socket }, stdout: true, stderr: true });
    // Worker 永远不能向官方 JSONL 流输出日志。
    worker.stdout?.resume(); worker.stderr?.resume();
    worker.on('message', (size: number) => { pending -= size; });
    worker.on('error', stop); worker.on('exit', stop);
    output.on('data', consume);
  } catch { stop(); }
  return stop;
}
