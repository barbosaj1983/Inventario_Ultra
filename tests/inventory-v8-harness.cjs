const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'Inventario_Ultra_v8.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (!inlineScripts.length) throw new Error('No inline V8 script found');
const appScript = inlineScripts.at(-1)[1];

function createElement(onFocus = () => {}) {
  const listeners = new Map();
  const classes = new Set();
  return {
    value: '', textContent: '', innerHTML: '', className: '', disabled: false, style: {}, children: [], dataset: {}, focusables: [],
    classList: {
      add: (...values) => values.forEach(value => classes.add(value)),
      remove: (...values) => values.forEach(value => classes.delete(value)),
      contains: value => classes.has(value),
      toggle: (value, force) => {
        const enabled = force === undefined ? !classes.has(value) : force;
        if (enabled) classes.add(value); else classes.delete(value);
        return enabled;
      }
    },
    addEventListener: (name, callback) => listeners.set(name, [...(listeners.get(name) || []), callback]),
    dispatch(name, event = {}) { for (const listener of listeners.get(name) || []) listener(event); },
    appendChild(child) { this.children.push(child); return child; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this[name] = value; },
    querySelectorAll() { return this.focusables; },
    focus() { onFocus(this); this.focused = true; },
    click() { this.clicked = true; }
  };
}

function createApp(options = {}) {
  const storage = new Map(Object.entries(options.storage || {}));
  const elements = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const requests = [];
  const downloads = [];
  const revokedUrls = [];
  let failWrites = false;
  let generatedUrl = 0;
  const document = {
    activeElement: null,
    body: createElement(element => { document.activeElement = element; }),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement(element => { document.activeElement = element; }));
      return elements.get(id);
    },
    createElement: () => createElement(element => { document.activeElement = element; }),
    querySelector: () => createElement(element => { document.activeElement = element; }),
    addEventListener(name, callback) { documentListeners.set(name, callback); }
  };
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) {
      if (failWrites === true && key === 'history' || failWrites === key) throw new Error('QuotaExceededError');
      storage.set(key, String(value));
    },
    removeItem(key) { storage.delete(key); }
  };
  const URL = {
    createObjectURL(blob) { const url = `blob:test-${++generatedUrl}`; downloads.push({ url, blob }); return url; },
    revokeObjectURL(url) { revokedUrls.push(url); }
  };
  const context = vm.createContext({
    document,
    window: { addEventListener(name, callback) { windowListeners.set(name, callback); } },
    localStorage,
    navigator: { hardwareConcurrency: 2, vibrate() {} },
    fetch: async (...args) => { requests.push(args); return options.fetch ? options.fetch(...args) : { ok: true, json: async () => ({ success: true }) }; },
    setTimeout(callback, delay) { if (delay === 0 || delay === 1000) callback(); return 1; },
    setInterval() { return 1; },
    clearTimeout() {},
    URL,
    Blob,
    confirm: () => options.confirm ?? true,
    prompt: () => options.prompt ?? null,
    location: { reload() {} },
    AbortController,
    Date,
    Math,
    crypto: { randomUUID: (() => { let id = 0; return () => `test-${++id}`; })() },
    Quagga: options.Quagga
  });
  vm.runInContext(appScript, context, { timeout: 1000 });
  return {
    context, storage, elements, requests, downloads, revokedUrls, document, documentListeners,
    setFailWrites(value) { failWrites = value; },
    run(source) { return vm.runInContext(source, context); }
  };
}

function setForm(app, code = '000123', quantity = '1') {
  const barras = app.elements.get('barrasInput');
  const qtd = app.elements.get('qtdInput');
  barras.value = code;
  qtd.value = quantity;
  app.run(`cadastroState = "verified"; cadastro = Array.from(new Set([...cadastro, ${JSON.stringify(code)}]));`);
}

function response(data, options = {}) {
  return { ok: options.ok ?? true, json: async () => {
    if (options.invalidJson) throw new SyntaxError('invalid json');
    return data;
  } };
}

async function savedHistory(app) {
  return JSON.parse(app.storage.get('history') || '[]');
}

module.exports = { html, createApp, setForm, response, savedHistory };
