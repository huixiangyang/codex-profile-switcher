import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { SessionTable } from '../src/sessions/table';
import type { Session } from '../src/sessions/types';

// A deliberately small DOM substitute for the table's node/focus contract, not
// browser or native-host acceptance. Moving/removing a focused subtree blurs it.
class ElementFixture {
  children: ElementFixture[] = [];
  parentElement: ElementFixture | null = null;
  dataset: Record<string, string> = {};
  className = ''; title = ''; disabled = false; scrollTop = 0; scrollLeft = 0;
  private content = '';
  private attributes = new Map<string, string>();
  constructor(readonly ownerDocument: DocumentFixture, readonly tagName: string) {}
  get classList() {
    return {
      contains: (name: string) => this.className.split(/\s+/).includes(name),
      toggle: (name: string, force?: boolean) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        const added = force ?? !classes.has(name);
        if (added) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(' '); return added;
      }
    };
  }
  get textContent(): string { return this.content + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.replaceChildren(); this.content = value; }
  get firstElementChild() { return this.children[0] ?? null; }
  get nextElementSibling(): ElementFixture | null {
    const siblings = this.parentElement?.children;
    return siblings?.[siblings.indexOf(this) + 1] ?? null;
  }
  get isConnected(): boolean { return this === this.ownerDocument.body || !!this.parentElement?.isConnected; }
  contains(element: ElementFixture | null): boolean { return element === this || this.children.some(child => child.contains(element)); }
  setAttribute(name: string, value: string) { if (name === 'class') this.className = value; else this.attributes.set(name, value); }
  getAttribute(name: string) {
    if (name === 'class') return this.className;
    if (name.startsWith('data-')) return this.dataset[name.slice(5)] ?? null;
    return this.attributes.get(name) ?? null;
  }
  remove() {
    if (!this.parentElement) return;
    if (this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body;
    this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null;
  }
  insertBefore(element: ElementFixture, next: ElementFixture | null) {
    if (element === next) return element;
    element.remove();
    const index = next ? this.children.indexOf(next) : this.children.length;
    assert.ok(index >= 0, 'insertBefore reference must belong to this parent');
    this.children.splice(index, 0, element); element.parentElement = this; return element;
  }
  appendChild(element: ElementFixture) { return this.insertBefore(element, null); }
  append(...elements: ElementFixture[]) { elements.forEach(element => this.appendChild(element)); }
  prepend(...elements: ElementFixture[]) { [...elements].reverse().forEach(element => this.insertBefore(element, this.firstElementChild)); }
  replaceChildren(...elements: ElementFixture[]) { [...this.children].forEach(child => child.remove()); this.content = ''; this.append(...elements); }
  matches(selector: string): boolean {
    return selector.split(',').some(part => {
      const value = part.trim(), tag = value.match(/^[a-z]+/i)?.[0];
      if (tag && this.tagName !== tag.toLowerCase()) return false;
      if ([...value.matchAll(/\.([\w-]+)/g)].some(([, name]) => !this.classList.contains(name))) return false;
      return [...value.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)].every(([, name, expected]) =>
        expected === undefined ? this.getAttribute(name) !== null : this.getAttribute(name) === expected);
    });
  }
  closest(selector: string): ElementFixture | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  querySelectorAll(selector: string): ElementFixture[] {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  focus(options?: { preventScroll?: boolean }) {
    this.ownerDocument.focusCalls.push({ element: this, options });
    if (this.isConnected && !this.disabled) this.ownerDocument.activeElement = this;
  }
}
class DocumentFixture {
  body = new ElementFixture(this, 'body');
  activeElement = this.body;
  foreground = true;
  focusCalls: { element: ElementFixture; options?: { preventScroll?: boolean } }[] = [];
  hasFocus() { return this.foreground; }
  createElement(tag: string) { return new ElementFixture(this, tag); }
  createElementNS(_namespace: string, tag: string) { return this.createElement(tag); }
}
const session = (id: string): Session => ({ id, title: `Session ${id}`, cwd: '/fixture/project', cwdLabel: 'project', createdAt: 1, updatedAt: 2,
  model: '', provider: '', state: 'finished', stateAt: 2, stateReason: 'lifecycle', turns: [], organization: {favorite:true,tags:['交付','计划']},
  stats: {tokens:null,counts:null,lastDurationMs:null,recordedDurationMs:null,timedTurns:0,inherited:false,incomplete:false} });
function fixture(t: TestContext) {
  const document = new DocumentFixture(), previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {value:document,configurable:true});
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); });
  const main = document.createElement('main'), body = document.createElement('tbody'), fallback = document.createElement('input');
  document.body.append(fallback,main); main.append(body);
  // The optional third parameter is the caller-owned empty-list focus target.
  const table = new SessionTable(body as unknown as HTMLElement, main as unknown as HTMLElement, fallback as unknown as HTMLElement);
  const button = (id: string, action: string) => body.querySelector(`tr[data-id="${id}"]`)!.querySelector(`.${action}`)!;
  return {document,main,body,fallback,table,button};
}

test('table reorder preserves the same favorite button, selected session and scroll', t => {
  const f = fixture(t), rows = ['a','b','c'].map(session); f.table.update(rows,true,'a');
  const favorite = f.button('c','row-favorite'); favorite.focus(); f.main.scrollTop=40; f.main.scrollLeft=12;
  f.table.update([rows[2],rows[0],rows[1]],true,'a');
  assert.ok(f.document.activeElement === favorite);
  assert.equal(f.body.querySelector('tr.selected')?.dataset.id,'a');
  assert.deepEqual([f.main.scrollTop,f.main.scrollLeft],[40,12]);
  assert.deepEqual(f.document.focusCalls.at(-1)?.options,{preventScroll:true});
});

test('filtered row removal keeps keyboard work on the next surviving action without selecting it', t => {
  const f = fixture(t), rows = ['a','b','c'].map(session); f.table.update(rows,true,'a');
  f.button('b','row-favorite').focus(); f.table.update([rows[2],rows[0]],true,'a');
  assert.ok(f.document.activeElement === f.button('c','row-favorite'));
  assert.equal(f.body.querySelector('tr.selected')?.dataset.id,'a');
  f.table.update([rows[0]],true,'a');
  assert.ok(f.document.activeElement === f.button('a','row-favorite'));
  f.button('a','row-tags').focus(); f.table.update([],true,'a');
  assert.ok(f.document.activeElement === f.fallback);
  assert.equal(f.body.children.length,0);
});

test('removing the last focused row uses the previous action; disabled title falls back to filters', t => {
  const f = fixture(t), rows = ['a','b','c'].map(session); f.table.update(rows,true,'a');
  f.button('c','row-review').focus(); f.table.update([rows[0],rows[1]],true,'a');
  assert.ok(f.document.activeElement === f.button('b','row-review'));
  f.button('b','session-title').focus(); f.table.update([rows[0]],false,'a');
  assert.ok(f.document.activeElement === f.fallback);
  assert.equal(f.body.querySelector('tr.selected')?.dataset.id,'a');
});

test('tag removal keeps the same action and names current tags for assistive technology', t => {
  const f = fixture(t), rows = ['a','b'].map(session); f.table.update(rows,true,'a');
  const tags = f.button('a','row-tags'), label = tags.getAttribute('aria-label')!;
  for (const name of rows[0].organization!.tags) assert.ok(label.includes(name));
  assert.ok(label.includes(rows[0].title));
  tags.focus(); f.table.update([rows[1]],true,'a');
  assert.ok(f.document.activeElement === f.button('b','row-tags'));
  assert.equal(f.body.querySelector('tr.selected'),null);
});

test('background refresh and focus outside the table never claim keyboard focus', t => {
  const f = fixture(t), rows = ['a','b'].map(session); f.table.update(rows,true,'a');
  f.button('a','row-favorite').focus(); f.document.focusCalls=[]; f.document.foreground=false;
  f.table.update([rows[1]],true,'a');
  assert.equal(f.document.focusCalls.length,0);
  f.document.foreground=true; f.fallback.focus(); f.document.focusCalls=[];
  f.table.update([],true,'a');
  assert.ok(f.document.activeElement === f.fallback); assert.equal(f.document.focusCalls.length,0);
});
