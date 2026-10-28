import { parentPort, workerData } from 'node:worker_threads';
import { createConnection, type Socket } from 'node:net';
import { observe } from './events';
import type { LiveEntry } from './protocol';
import { maxPatchBytes } from '../sessions/turns';

// 所有 JSON 解析及面板 I/O 都在 Worker 中，不能阻塞官方标准流的转发。
const entries = new Map<string, LiveEntry>();
let client: Socket | undefined;
let connectedOnce = false;
let fragments: Buffer[] = [], length = 0, skipping = false;
function send(message: unknown): void {
  if (!client || client.connecting || client.destroyed) return;
  if (client.writableLength > 1024 * 1024) { client.destroy(); return; }
  client.write(JSON.stringify(message) + '\n');
}
function snapshot(): void { send({ type: 'snapshot', entries: [...entries.values()] }); }
function connect(): void {
  client = createConnection(workerData.socket);
  client.on('connect', () => { connectedOnce = true; snapshot(); });
  client.on('error', () => client?.destroy());
  client.on('close', () => {
    client = undefined;
    // 已连接后断开即结束旁路，避免旧后端重连抢占新后端；原始通信不受影响。
    if (connectedOnce) parentPort!.close(); else setTimeout(connect, 2000).unref();
  });
}
connect();
setInterval(() => send({ type: 'heartbeat' }), 5000).unref();
parentPort!.on('message', (data: Uint8Array) => {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  let start = 0;
  while (start < bytes.length) {
    const end = bytes.indexOf(10, start), stop = end < 0 ? bytes.length : end;
    const part = bytes.subarray(start, stop);
    if (!skipping) {
      length += part.length;
      if (length > 1024 * 1024) {
        // 超限或损坏时清空观测，宁可退回记录状态也不能保留可能过期的“运行中”。
        const prefix = fragments[0]?.subarray(0, 512).toString('utf8') ?? '';
        const patchOnly = /^\s*\{\s*"method"\s*:\s*"turn\/diff\/updated"/.test(prefix)
          || /^\s*\{\s*"method"\s*:\s*"item\/completed"\s*,\s*"params"\s*:\s*\{\s*"item"\s*:\s*\{\s*"type"\s*:\s*"fileChange"/.test(prefix);
        fragments = []; skipping = true;
        if (!patchOnly) { entries.clear(); snapshot(); }
      } else fragments.push(part);
    }
    if (end < 0) break;
    if (!skipping && length) {
      try {
        const event = observe(Buffer.concat(fragments, length).toString('utf8'));
        if (event) {
          if (event.type === 'status') {
            if (event.state === null) entries.delete(event.id); else entries.set(event.id, { id: event.id, state: event.state, at: event.at });
          }
          // 超预算补丁只传摘要，运行状态仍然可用。
          if (event.type === 'patch' && event.body.item.bytes > maxPatchBytes) event.body.patches = [];
          if (entries.size > 4096) { entries.clear(); snapshot(); }
          else send({ type: 'event', event });
        }
      } catch { entries.clear(); snapshot(); }
    }
    fragments = []; length = 0; skipping = false; start = end + 1;
  }
  parentPort!.postMessage(data.byteLength);
});
