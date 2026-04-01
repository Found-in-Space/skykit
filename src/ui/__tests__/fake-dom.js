/**
 * Minimal DOM mock for testing HUD components under Node.js.
 * Call install() before tests and uninstall() after.
 */

class FakeClassList {
  constructor() { this._set = new Set(); }
  add(c) { this._set.add(c); }
  remove(c) { this._set.delete(c); }
  toggle(c, force) {
    const has = this._set.has(c);
    const next = force !== undefined ? force : !has;
    if (next) this._set.add(c); else this._set.delete(c);
    return next;
  }
  contains(c) { return this._set.has(c); }
}

class FakeElement extends EventTarget {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.textContent = '';
    this.style = {};
    this.classList = new FakeClassList();
    this.children = [];
    this.parentElement = null;
    this._attrs = {};
  }

  setAttribute(name, value) { this._attrs[name] = value; }
  getAttribute(name) { return this._attrs[name] ?? null; }
  setPointerCapture() {}
  releasePointerCapture() {}

  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  querySelectorAll(selector) {
    const results = [];
    const visit = (el) => {
      if (matchesSimple(el, selector)) results.push(el);
      for (const child of el.children ?? []) visit(child);
    };
    for (const child of this.children) visit(child);
    return results;
  }
}

function matchesSimple(el, selector) {
  if (selector.startsWith('.')) {
    const cls = selector.slice(1);
    return (el.className ?? '').split(/\s+/).includes(cls);
  }
  return (el.tagName ?? '').toLowerCase() === selector.toLowerCase();
}

let saved = {};
let navigatorDesc = null;

export function install() {
  saved = {
    document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle,
    ontouchstart: globalThis.ontouchstart,
  };
  navigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  const head = new FakeElement('head');
  globalThis.document = {
    createElement(tag) { return new FakeElement(tag); },
    head,
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { maxTouchPoints: 0 },
    writable: true,
    configurable: true,
  });
  globalThis.getComputedStyle = () => ({ position: 'relative' });
}

export function uninstall() {
  globalThis.document = saved.document;
  globalThis.getComputedStyle = saved.getComputedStyle;
  if (navigatorDesc) {
    Object.defineProperty(globalThis, 'navigator', navigatorDesc);
  }
  delete globalThis.ontouchstart;
}

export { FakeElement };
