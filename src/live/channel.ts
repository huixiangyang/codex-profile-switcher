import { promises as fs } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import path from 'node:path';
import { windowSocketPath } from '../window';
import { object, threadId } from './json';
import { activeLiveState, liveEntry, liveState, type ActiveLiveState, type LiveEntry, type RuntimeEvent } from './protocol';
import { PatchCache, newTurn, mergeTurn, setItem, type TurnSummary, type PatchBody } from '../sessions/turns';

/** 独立的单向观察通道（摘要和有界补丁），没有查询、命令、批准响应或后端写入接口。 */
export class LiveSessions {
  readonly entries = new Map<string, LiveEntry>();
  readonly turns = new Map<string, Map<string, TurnSummary>>();
  readonly patches = new PatchCache();
  private activeTurns = new Map<string,string>();
  private eventListeners = new Set<(event: RuntimeEvent) => void>();
  onEvent(listener: (event: RuntimeEvent) => void): { dispose(): void } { this.eventListeners.add(listener); return { dispose: () => this.eventListeners.delete(listener) }; }
  forgetTurns(id: string): void { this.turns.delete(id); this.activeTurns.delete(id); }
  turnState(id:string,turnId:string):ActiveLiveState|undefined {
    const state=this.entries.get(id)?.state;
    return this.connected&&this.activeTurns.get(id)===turnId&&activeLiveState(state)?state:undefined;
  }
  connected = false;
  seenConnection = false;
  startedAt = 0;
  private server?: Server;
  private client?: Socket;
  private listeners = new Set<() => void>();
  private socket?: string;
  subscribe(listener: () => void): { dispose(): void } {
    this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) };
  }
  private changed(): void { for (const listener of this.listeners) listener(); }
  async start(storage: string): Promise<string> {
    const socket = windowSocketPath(storage, process.pid).replace(/\.sock$/, '.live.sock');
    this.socket = socket; this.startedAt = Date.now();
    await fs.mkdir(path.dirname(socket), { recursive: true, mode: 0o700 });
    await fs.rm(socket, { force: true });
    this.server = createServer(client => {
      this.client?.destroy(); this.client = client;
      this.entries.clear(); this.turns.clear(); this.activeTurns.clear(); this.patches.clear(); this.connected = false; this.seenConnection = true; this.changed();
      let buffer = '';
      client.setEncoding('utf8');
      client.setTimeout(15000, () => client.destroy());
      client.on('error', () => client.destroy());
      client.on('close', () => {
        if (this.client !== client) return;
        this.client = undefined; this.connected = false; this.entries.clear(); this.activeTurns.clear(); this.changed();
      });
      client.on('data', chunk => {
        if (this.client !== client) return;
        buffer += chunk;
        if (buffer.length > 1024 * 1024) { client.destroy(); return; }
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try {
            const m = object(JSON.parse(line));
            if (m?.type === 'snapshot' && Array.isArray(m.entries) && m.entries.length <= 4096 && m.entries.every(liveEntry)) {
              this.entries.clear();
              this.activeTurns.clear();
              for (const row of m.entries) this.entries.set(row.id, { id: row.id, state: row.state, at: row.at });
              this.connected = true; this.changed();
            } else if (m?.type === 'event' && object(m.event) && threadId(object(m.event)?.id)) {
              if (!this.connected) continue;
              this.consume(m.event as RuntimeEvent);
            } else if (m?.type !== 'heartbeat') { client.destroy(); return; }
          } catch { client.destroy(); return; }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(socket, () => { this.server!.removeListener('error', reject); resolve(); });
    });
    this.server.on('error', () => { this.client?.destroy(); });
    return socket;
  }
  private consume(event: RuntimeEvent): void {
    if (event.type === 'status') {
      if (event.state !== null && !liveState(event.state) || !Number.isFinite(event.at)) throw new Error('无效状态');
      const before = this.entries.get(event.id);
      const waiting = event.state === 'approval' || event.state === 'input' || event.state === 'approvalInput';
      if(!activeLiveState(event.state))this.activeTurns.delete(event.id);
      if (event.state === null) this.entries.delete(event.id);
      else this.entries.set(event.id, { id: event.id, state: event.state, at: event.at, ...(waiting ? { waitingSince: before?.waitingSince ?? event.at } : {}) });
    } else {
      const id = event.type === 'turn' ? event.turn?.id : event.type === 'patch' ? event.turnId : undefined;
      if (!threadId(id)) throw new Error('无效回合');
      let turns = this.turns.get(event.id);
      if (!turns) { turns = new Map(); this.turns.set(event.id, turns); }
      if (event.type === 'turn') {
        if (!['unresolved', 'completed', 'failed', 'interrupted'].includes(event.turn.outcome)) throw new Error('无效终态');
        const merged=mergeTurn(turns.get(id), { ...event.turn, items: [] });turns.set(id,merged);
        // 只有明确的 turn/started 才绑定当前轮；旧轮、补丁和文件时间都不能代替这个关联。
        if(event.turn.outcome==='unresolved'&&merged.outcome==='unresolved')this.activeTurns.set(event.id,id);
        else if(this.activeTurns.get(event.id)===id)this.activeTurns.delete(event.id);
      } else if (event.type === 'patch') {
        const body = event.body as PatchBody;
        if (!body?.item || !threadId(body.item.id) || typeof body.item.fingerprint !== 'string'
          || !Number.isFinite(body.item.bytes) || !Array.isArray(body.item.files) || !Array.isArray(body.patches)
          || body.item.files.some(f => typeof f.path !== 'string' || !['add','update','delete'].includes(f.kind))
          || body.patches.some(f => typeof f.path !== 'string' || typeof f.diff !== 'string' || !['add','update','delete'].includes(f.kind))) throw new Error('无效补丁');
        const turn = turns.get(id) ?? newTurn(id); setItem(turn, body.item); turns.set(id, turn); this.patches.put(body);
      }
      if (turns.size > 4096 || this.turns.size > 4096) throw new Error('观测数量超限');
    }
    for (const listener of this.eventListeners) listener(event);
    this.changed();
  }
  async dispose(): Promise<void> {
    this.listeners.clear(); this.eventListeners.clear(); this.turns.clear(); this.activeTurns.clear(); this.patches.clear(); this.client?.destroy(); this.client = undefined;
    this.entries.clear(); this.connected = false;
    if (this.server) await new Promise<void>(resolve => this.server!.close(() => resolve()));
    if (this.socket) await fs.rm(this.socket, { force: true });
  }
}
