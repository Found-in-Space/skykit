import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as spatial from '../../src/index.js';
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') + path.sep;
// Execute the actual lesson modules with inert drawing and lightweight controls.
// This exercises their authored spatial specs; it makes no visual/browser claim.
for (const lab of ['coordinates-aim', 'routes-orbits', 'paths-transitions', 'motion-automation']) {
    test(`spatial lab ${lab} evaluates its models and control variants`, () => {
        const html = fs.readFileSync(base + lab + '/index.html', 'utf8');
        let source = fs.readFileSync(base + lab + '/' + lab + '.js', 'utf8');
        const ast = ts.createSourceFile(lab, source, 99, true, 1);
        const scope = { console, Math, Number, Error, TypeError, RangeError, Map, Set, Array, Object, JSON, AbortController, URLSearchParams, performance: { now: () => 1000 } };
        const imports = ast.statements.filter(ts.isImportDeclaration);
        for (const n of imports)
            for (const e of n.importClause?.namedBindings?.elements ?? [])
                scope[e.name.text] = spatial[e.propertyName?.text ?? e.name.text];
        for (const n of [...imports].reverse())
            source = source.slice(0, n.getStart(ast)) + source.slice(n.end);
        const nodes = [];
        const frames = [];
        class Element {
            constructor(tag, attrs) { this.tag = tag; this.attrs = attrs; this.dataset = {}; this.style = {}; this.classList = { add() { }, remove() { }, toggle() { } }; this.listeners = {}; this.value = attrs.value ?? ''; this.checked = 'checked' in attrs; this.hidden = 'hidden' in attrs; this.textContent = ''; this.innerHTML = ''; this.clientWidth = 800; this.clientHeight = 480; this.width = 800; this.height = 480; for (const [k, v] of Object.entries(attrs))
                if (k.startsWith('data-'))
                    this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v; }
            addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
            removeEventListener() { }
            replaceChildren(...children) { this.children = children; }
            appendChild(child) { (this.children ??= []).push(child); }
            querySelectorAll(q) { return queryAll(q); }
            querySelector(q) { return queryAll(q)[0] ?? null; }
            getBoundingClientRect() { return { width: 800, height: 480, left: 0, top: 0 }; }
            setAttribute(k, v) { this.attrs[k] = v; }
            getAttribute(k) { return this.attrs[k] ?? null; }
        }
        class Canvas extends Element {
            getContext() { return context; }
        }
        class Form extends Element {
        }
        const context = new Proxy({ measureText: s => ({ width: String(s).length * 7 }), createLinearGradient: () => ({ addColorStop() { } }), createRadialGradient: () => ({ addColorStop() { } }) }, { get(t, k) { return k in t ? t[k] : () => { }; }, set(t, k, v) { t[k] = v; return true; } });
        for (const m of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
            const attrs = {};
            for (const a of m[2].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))
                attrs[a[1]] = a[2] ?? a[3] ?? a[4] ?? '';
            const Constructor = m[1] === 'canvas' ? Canvas : m[1] === 'form' ? Form : Element;
            const node = new Constructor(m[1], attrs);
            if (m[1] === 'select') {
                const end = html.indexOf('</select>', m.index);
                const block = html.slice(m.index, end);
                const opts = [...block.matchAll(/<option\b([^>]*)>/g)];
                const chosen = opts.find(x => /\bselected\b/.test(x[1])) ?? opts[0];
                node.value = chosen?.[1].match(/value="([^"]*)"/)?.[1] ?? '';
                node.options = opts.map(x => x[1].match(/value="([^"]*)"/)?.[1]).filter(Boolean);
            }
            nodes.push(node);
        }
        function queryAll(selector) { const attr = [...selector.matchAll(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g)]; if (attr.length)
            return nodes.filter(n => attr.every(a => a[1] in n.attrs && (a[2] === undefined || n.attrs[a[1]] === a[2]))); if (selector.startsWith('#'))
            return nodes.filter(n => n.attrs.id === selector.slice(1)); return nodes.filter(n => n.tag === selector); }
        scope.document = { createElement: tag => new Element(tag, {}), querySelector: q => queryAll(q)[0] ?? null, querySelectorAll: queryAll, addEventListener() { }, hidden: false };
        scope.window = { addEventListener() { }, devicePixelRatio: 1 };
        scope.HTMLElement = Element;
        scope.HTMLCanvasElement = Canvas;
        scope.HTMLFormElement = Form;
        scope.HTMLInputElement = Element;
        scope.HTMLSelectElement = Element;
        scope.HTMLButtonElement = Element;
        scope.ResizeObserver = class {
            observe() { }
            disconnect() { }
        };
        scope.requestAnimationFrame = fn => (frames.push(fn), frames.length);
        scope.cancelAnimationFrame = () => { };
        const code = vm.createContext(scope);
        vm.runInContext(source, code, { filename: lab, timeout: 1000 });
        for (const fn of frames.splice(0))
            fn(1016);
        function check() { for (const n of nodes) {
            if (n.dataset.state === 'error' || ('data-error' in n.attrs && !n.hidden && n.textContent))
                throw Error(lab + ': ' + n.textContent);
        } }
        check();
        let variants = 0;
        for (const n of nodes.filter(n => n.tag === 'select'))
            for (const option of n.options ?? []) {
                n.value = option;
                for (const fn of n.listeners.change ?? [])
                    fn({ currentTarget: n });
                check();
                variants++;
            }
        for (const n of nodes.filter(n => 'data-nav-action' in n.attrs)) {
            for (const fn of n.listeners.click ?? [])
                fn({ currentTarget: n });
            check();
            variants++;
        }
        if (variants === 0)
            throw new Error('No authored controls were exercised.');
    });
}
