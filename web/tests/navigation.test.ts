import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import test from 'node:test';

// Exercise the real controller without a browser/server. The dialog mock queues
// close events like the platform and rejects showModal on an open nonmodal dialog.
const source = stripTypeScriptTypes(readFileSync(new URL('../src/scripts/navigation.ts', import.meta.url), 'utf8')).replace('export {};', '');
function setup(isMobile = true, blockedStorage = false) {
  const pending: (() => void)[] = [];
  const document: any = {activeElement: null};
  class Element extends EventTarget {
    dataset: Record<string, string> = {};
    attributes = new Map<string, string>();
    open = false;
    modal = false;
    children: Element[] = [];
    title = '';
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    focus() { document.activeElement = this; }
    contains(node: Element) { return this === node || this.children.includes(node); }
    querySelectorAll(selector: string) { return selector === 'a' ? [link] : this.children; }
    getClientRects() { return [{}]; }
    getBoundingClientRect() { return {left:0, right:320, top:0, bottom:900}; }
    close() { if (!this.open) return; this.open = this.modal = false; pending.push(() => this.dispatchEvent(new Event('close'))); }
    show() { this.open = true; this.modal = false; }
    showModal() { if (this.open && !this.modal) throw new Error('InvalidStateError'); this.open = this.modal = true; }
    // Deliberately no matches(':modal'): state must not depend on support for
    // that selector, which arrived later than the native dialog API in Safari.
  }
  const root = new Element(), dialog = new Element(), toggle = new Element(), close = new Element(), link = new Element();
  dialog.open = true;
  dialog.children = [close, link];
  const elements: Record<string, Element> = {'[data-workspace]':root, '#workspace-navigation':dialog, '#toggle-navigation':toggle, '#close-navigation':close};
  document.querySelector = (selector: string) => elements[selector];
  const classes = new Set<string>();
  document.documentElement = {classList:{toggle(name: string, enabled: boolean) { if (enabled) classes.add(name); else classes.delete(name); }}};
  document.body = new Element();
  const window = new EventTarget();
  const media = Object.assign(new EventTarget(), {matches:isMobile});
  const storage = new Map<string,string>();
  runInNewContext(source, {document, window, HTMLElement:Element, matchMedia:()=>media, localStorage:{getItem(key:string) { if (blockedStorage) throw Error(); return storage.get(key); }, setItem(key:string,value:string) { if (blockedStorage) throw Error(); storage.set(key,value); }}});
  const click = (element: Element) => element.dispatchEvent(new Event('click'));
  const flush = () => { while (pending.length) pending.shift()!(); };
  const resize = (mobile: boolean, dispatch = true) => { media.matches = mobile; if (dispatch) media.dispatchEvent(new Event('change')); };
  const expanded = () => toggle.getAttribute('aria-expanded');
  return {root, dialog, toggle, close, link, classes, document, window, media, click, flush, resize, expanded};
}

test('mobile first click opens, repeated close/reopen survives queued close events', () => {
  const s = setup();
  assert.equal(s.dialog.open, false);
  assert.equal(s.expanded(), 'false');
  s.click(s.toggle); s.flush();
  assert.equal(s.dialog.modal, true);
  assert.equal(s.dialog.dataset.mobileOpen, 'true');
  assert.equal(s.expanded(), 'true');
  assert.equal(s.document.activeElement, s.close);
  s.click(s.close); s.click(s.toggle); s.flush();
  assert.equal(s.dialog.modal, true);
  assert.equal(s.expanded(), 'true');
  s.click(s.close); s.flush();
  assert.equal(s.document.activeElement, s.toggle);
  assert.equal(s.classes.has('navigation-open'), false);
});

test('first click promotes stale desktop open state before viewport change callback', () => {
  const s = setup(false);
  s.resize(true, false);
  assert.equal(s.dialog.open, true);
  s.click(s.toggle); s.flush();
  assert.equal(s.dialog.modal, true);
  assert.equal(s.expanded(), 'true');
});

test('Escape and navigation links dismiss and restore focus', () => {
  const s = setup();
  s.click(s.toggle);
  const cancel = new Event('cancel', {cancelable:true});
  s.dialog.dispatchEvent(cancel);
  assert.equal(cancel.defaultPrevented, true);
  assert.equal(s.dialog.open, false);
  assert.equal(s.document.activeElement, s.toggle);
  s.click(s.toggle); s.click(s.link); s.flush();
  assert.equal(s.expanded(), 'false');
});

test('desktop collapse survives mobile modal and viewport changes', () => {
  const s = setup(false);
  s.click(s.toggle);
  assert.equal(s.root.dataset.sidebarCollapsed, 'true');
  s.resize(true); s.click(s.toggle); s.resize(false); s.flush();
  assert.equal(s.dialog.open, true);
  assert.equal(s.dialog.modal, false);
  assert.equal(s.dialog.getAttribute('role'), 'complementary');
  assert.equal(s.expanded(), 'false');
  assert.equal(s.classes.has('navigation-open'), false);
  s.resize(true); s.click(s.toggle); s.flush();
  assert.equal(s.expanded(), 'true');
});

test('history and bfcache transitions remove stale modal and scroll lock', () => {
  const s = setup();
  for (const type of ['pagehide', 'pageshow', 'popstate']) {
    s.click(s.toggle);
    const event = Object.assign(new Event(type), {persisted:true});
    s.window.dispatchEvent(event); s.flush();
    assert.equal(s.dialog.open, false, type);
    assert.equal(s.expanded(), 'false', type);
    assert.equal(s.classes.has('navigation-open'), false, type);
  }
  s.click(s.toggle);
  assert.equal(s.dialog.modal, true);
});

test('unavailable localStorage does not disable mobile or desktop controls', () => {
  const s = setup(false, true);
  s.click(s.toggle);
  assert.equal(s.expanded(), 'false');
  s.resize(true); s.click(s.toggle);
  assert.equal(s.dialog.modal, true);
});

test('mobile visibility uses controller state rather than unsupported modal selectors', () => {
  const css = readFileSync(new URL('../src/styles/workspace.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.workspace-navigation[open]:not([data-mobile-open="true"]) { display: none; }'));
  assert.ok(css.includes('.workspace-app .workspace-navigation[open][data-mobile-open="true"]'));
  assert.equal(css.includes(':modal'), false);
});

test('mobile Tab wraps within drawer and backdrop click dismisses it', () => {
  const s = setup();
  s.click(s.toggle);
  s.link.focus();
  const tab = Object.assign(new Event('keydown', {cancelable:true}), {key:'Tab', shiftKey:false});
  s.dialog.dispatchEvent(tab);
  assert.equal(tab.defaultPrevented, true);
  assert.equal(s.document.activeElement, s.close);
  const reverse = Object.assign(new Event('keydown', {cancelable:true}), {key:'Tab', shiftKey:true});
  s.dialog.dispatchEvent(reverse);
  assert.equal(s.document.activeElement, s.link);
  s.dialog.dispatchEvent(Object.assign(new Event('click'), {clientX:380, clientY:400}));
  assert.equal(s.dialog.open, false);
  assert.equal(s.document.activeElement, s.toggle);
});
