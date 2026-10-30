import type { Memento } from 'vscode';
import type { Session } from './types';

export interface SessionOrganizationValue { favorite: boolean; tags: string[] }
export interface OrganizationChange { favorite?: boolean; addTag?: string; removeTag?: string }
export type SessionFilter = 'all' | 'active' | 'attention' | 'review';
export interface SessionFilters { status: SessionFilter; query: string; onlyFavorites: boolean; tag: string }

export const maxSessionTags = 10;
export const maxTagLength = 32;
const storageKey = 'sessionOrganization';
interface SavedEntry extends SessionOrganizationValue { source: string; id: string }
interface SavedOrganization { version: 1; entries: SavedEntry[] }
const keyOf = (source: string, id: string) => JSON.stringify([source, id]);
const empty = (): SessionOrganizationValue => ({ favorite: false, tags: [] });

/** Tags are case-sensitive, NFC-normalized labels, not paths or a global registry. */
export function normalizeTag(value: string): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw new Error('标签不能包含控制字符。');
  const tag = value.trim().normalize('NFC');
  if (!tag || [...tag].length > maxTagLength) throw new Error(`标签须为 1–${maxTagLength} 个字符。`);
  return tag;
}

export function isOrganizationChange(value: unknown): value is OrganizationChange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const change = value as Record<string, unknown>, keys = Object.keys(change);
  if (!keys.length || keys.some(key => !['favorite', 'addTag', 'removeTag'].includes(key))) return false;
  if ('favorite' in change && typeof change.favorite !== 'boolean') return false;
  try {
    for (const key of ['addTag', 'removeTag']) if (key in change) {
      if (typeof change[key] !== 'string') return false;
      normalizeTag(change[key]);
    }
  } catch { return false; }
  return true;
}

function isSavedOrganization(value: unknown): value is SavedOrganization {
  if (!value || typeof value !== 'object') return false;
  const saved = value as Partial<SavedOrganization>;
  if (saved.version !== 1 || !Array.isArray(saved.entries)) return false;
  const keys = new Set<string>();
  return saved.entries.every(entry => {
    if (!entry || typeof entry !== 'object' || typeof entry.source !== 'string' || !entry.source
      || typeof entry.id !== 'string' || !entry.id || typeof entry.favorite !== 'boolean'
      || !Array.isArray(entry.tags) || entry.tags.length > maxSessionTags) return false;
    try {
      if (!entry.tags.every(tag => typeof tag === 'string' && normalizeTag(tag) === tag)
        || new Set(entry.tags).size !== entry.tags.length) return false;
    } catch { return false; }
    const key = keyOf(entry.source, entry.id);
    if (keys.has(key)) return false;
    keys.add(key); return true;
  });
}

/** Plugin-only workspace metadata. Never writes a Codex index, rollout, or config file. */
export class SessionOrganization {
  readonly error?: string;
  private entries = new Map<string, SavedEntry>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private storage: Pick<Memento, 'get' | 'update'>) {
    const saved = storage.get<unknown>(storageKey);
    if (saved === undefined) return;
    if (!isSavedOrganization(saved)) {
      this.error = '收藏和标签记录格式无法读取，未覆盖原记录。';
      return;
    }
    for (const entry of saved.entries) this.entries.set(keyOf(entry.source, entry.id), structuredClone(entry));
  }

  read(source: string, id: string): SessionOrganizationValue {
    const entry = this.entries.get(keyOf(source, id));
    return entry ? { favorite: entry.favorite, tags: [...entry.tags] } : empty();
  }

  update(source: string, id: string, change: OrganizationChange): Promise<void> {
    // Capture the request now; calculate its result only after earlier writes settle.
    const requested = { ...change };
    const operation = this.queue.then(async () => {
      if (this.error) throw new Error(this.error);
      if (!source || !id || !isOrganizationChange(requested)) throw new Error('无效的收藏或标签修改。');
      const key = keyOf(source, id), value = this.read(source, id);
      if (requested.favorite !== undefined) value.favorite = requested.favorite;
      if (requested.removeTag !== undefined) value.tags = value.tags.filter(tag => tag !== normalizeTag(requested.removeTag!));
      if (requested.addTag !== undefined) {
        const tag = normalizeTag(requested.addTag);
        if (!value.tags.includes(tag)) {
          if (value.tags.length >= maxSessionTags) throw new Error(`每个会话最多 ${maxSessionTags} 个标签。`);
          value.tags.push(tag);
        }
      }
      const next = new Map(this.entries);
      if (value.favorite || value.tags.length) next.set(key, { source, id, ...value });
      else next.delete(key);
      const saved: SavedOrganization = { version: 1, entries: [...next.values()].map(entry => structuredClone(entry)) };
      await this.storage.update(storageKey, saved);
      this.entries = next;
    });
    // A failed operation rejects its caller but must not prevent the next explicit edit.
    this.queue = operation.catch(() => {});
    return operation;
  }

  async flush(): Promise<void> { await this.queue; }
}

export function matchesSessionStatus(session: Session, status: SessionFilter): boolean {
  return status === 'all' || (status === 'active' ? !!session.workflow?.active
    : status === 'attention' ? !!session.workflow?.attention : (session.workflow?.pending ?? 0) > 0);
}

export function matchesSessionFilters(session: Session, filters: SessionFilters): boolean {
  const organization = session.organization;
  return matchesSessionStatus(session, filters.status)
    && (!filters.onlyFavorites || !!organization?.favorite)
    && (!filters.tag || !!organization?.tags.includes(filters.tag))
    && `${session.title} ${session.cwdLabel} ${session.cwd} ${(organization?.tags ?? []).join(' ')}`
      .toLocaleLowerCase().includes(filters.query.toLocaleLowerCase());
}

/** Stable partition only: the attention queue deliberately keeps its existing priority. */
export function favoritesFirst(rows: Session[], status: SessionFilter): Session[] {
  if (status === 'attention') return [...rows];
  return [...rows.filter(row => row.organization?.favorite), ...rows.filter(row => !row.organization?.favorite)];
}
