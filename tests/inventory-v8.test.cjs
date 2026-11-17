const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'Inventario_Ultra_v8.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.ok(inlineScripts.length);
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
  const intervalCallbacks = [];
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
    fetch: async (...args) => {
      requests.push(args);
      if (options.fetch) return options.fetch(...args);
      const requestUrl = new globalThis.URL(args[0]);
      return { ok: true, json: async () => ({ success: true, data: { id: requestUrl.searchParams.get('id'), barras: requestUrl.searchParams.get('barras'), qtd: Number(requestUrl.searchParams.get('qtd')), timestamp: '2026-11-17T22:00:00.000Z' } }) };
    },
    setTimeout(callback, delay) { if (delay === 0 || delay === 1000) callback(); return 1; },
    setInterval(callback) { intervalCallbacks.push(callback); return 1; },
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
    context, storage, elements, requests, downloads, revokedUrls, document, documentListeners, windowListeners, intervalCallbacks,
    setFailWrites(value) { failWrites = value; },
    run(source) { return vm.runInContext(source, context); }
  };
}

function setForm(app, code = '000123', quantity = '1') {
  const barras = app.elements.get('barrasInput');
  const qtd = app.elements.get('qtdInput');
  barras.value = code;
  qtd.value = quantity;
  app.run(`cadastroState = "verified"; cadastro = Array.from(new Set([...cadastro, ${JSON.stringify(code)}])); validateBarras();`);
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

test('bloqueia Enter e chamadas repetidas enquanto uma gravação está pendente', async () => {
  let resolveFetch;
  const app = createApp({ storage: { apiUrl: 'https://api.example/exec' }, fetch: () => new Promise(resolve => { resolveFetch = resolve; }) });
  app.run('apiConnected = true;');
  setForm(app);
  const first = app.context.saveData();
  assert.equal(app.elements.get('btnSave').dataset.state, 'saving');
  assert.equal(app.elements.get('saveText').textContent, 'Salvando…');
  app.context.handleQtdKeydown({ key: 'Enter', preventDefault() {} });
  await app.context.saveData();
  assert.equal(app.requests.length, 1);
  app.elements.get('barrasInput').value = '000999';
  app.elements.get('qtdInput').value = '4';
  app.elements.get('barrasInput').dispatch('input');
  app.elements.get('qtdInput').dispatch('input');
  resolveFetch(response({ success: true, data: { id: 'test-1', barras: '000123', qtd: 1, timestamp: '2026-11-17T22:00:00.000Z' } }));
  await first;
  assert.equal((await savedHistory(app)).length, 1);
  assert.equal(app.elements.get('barrasInput').value, '000999');
  assert.equal(app.elements.get('qtdInput').value, '4');
  assert.equal(app.elements.get('saveText').textContent, 'Enviar contagem');
  assert.equal(app.elements.get('btnSave').disabled, false);
  assert.equal(app.elements.get('btnSave').dataset.state, 'ready');
});

test('lançamento local concluído mantém o estado final do botão até a próxima edição', async () => {
  const app = createApp();
  setForm(app, '000050', '2');
  await app.context.saveData();
  assert.equal(app.elements.get('btnSave').dataset.state, 'saved');
  assert.equal(app.elements.get('btnSave').disabled, true);
  assert.equal(app.elements.get('saveText').textContent, 'Salvo neste aparelho');
  assert.equal((await savedHistory(app))[0].syncStatus, 'pending');
});

test('confirmação remota limpa o botão para a próxima coleta', async () => {
  const app = createApp({ storage: { apiUrl: 'https://api.example/exec' } });
  app.run('apiConnected = true;');
  setForm(app, '000051', '2');
  await app.context.saveData();
  assert.equal(app.elements.get('btnSave').dataset.state, 'unavailable');
  assert.equal(app.elements.get('btnSave').disabled, true);
  assert.equal(app.elements.get('saveText').textContent, 'Enviar contagem');
  assert.equal((await savedHistory(app))[0].syncStatus, 'confirmed');
});

test('mais de 100 registros ficam persistidos e a exibição é limitada separadamente', async () => {
  const app = createApp();
  for (let index = 0; index < 125; index++) {
    setForm(app, `000${index}`, '1');
    await app.context.saveData();
  }
  assert.equal((await savedHistory(app)).length, 125);
  assert.equal(app.elements.get('pendingCount').textContent, '125');
  assert.equal(app.elements.get('historyList').children.length, 125);
});

test('histórico com pendências não pode ser limpo silenciosamente', async () => {
  const app = createApp();
  setForm(app, '0008', '2');
  await app.context.saveData();
  app.context.clearAllHistory();
  assert.equal((await savedHistory(app)).length, 1);
  assert.match(app.elements.get('alertMessage').textContent, /pendentes ou incertos/);
});

test('erro HTTP, JSON inválido e resposta negativa mantêm o registro local sem confirmar', async () => {
  const outcomes = [response({}, { ok: false }), response({}, { invalidJson: true }), response({ success: false })];
  for (const result of outcomes) {
    const app = createApp({ storage: { apiUrl: 'https://api.example/exec' }, fetch: async () => result });
    app.run('apiConnected = true;');
    setForm(app);
    await app.context.saveData();
    const [item] = await savedHistory(app);
    assert.ok(item);
    assert.notEqual(item.syncStatus, 'confirmed');
    assert.equal(item.synced, false);
  }
});

test('resposta perdida marca resultado remoto incerto e não reenvia automaticamente', async () => {
  const app = createApp({ storage: { apiUrl: 'https://api.example/exec' }, fetch: async () => { throw new Error('network lost'); } });
  app.run('apiConnected = true;');
  setForm(app);
  await app.context.saveData();
  assert.equal((await savedHistory(app))[0].syncStatus, 'uncertain');
  assert.equal(app.elements.get('btnSave').dataset.state, 'uncertain');
  assert.equal(app.elements.get('btnSave').disabled, true);
  assert.equal(app.elements.get('saveText').textContent, 'Confirmação incerta');
  assert.equal(app.requests.length, 1);
  await app.context.saveData();
  assert.equal(app.requests.length, 1);
  assert.match(app.elements.get('alertMessage').textContent, /confirmação incerta/);
  app.elements.get('barrasInput').value = '000124';
  app.elements.get('barrasInput').dispatch('input');
  assert.equal(app.elements.get('btnSave').dataset.state, 'ready');
  assert.equal(app.elements.get('btnSave').disabled, false);
});

test('retoma ao reconectar apenas pendências não enviadas, com o ID original', async () => {
  let networkAvailable = false;
  const pending = { id: 'phone-original-id', remoteId: 'phone-original-id', code: '440578', qty: 1, syncStatus: 'pending', synced: false };
  const uncertain = { id: 'uncertain-original-id', remoteId: 'uncertain-original-id', code: '440578', qty: 2, syncStatus: 'pending', syncAttempted: true, synced: false };
  const app = createApp({
    storage: {
      apiUrl: 'https://api.example/exec',
      history: JSON.stringify([pending, uncertain]),
      cadastroCache: JSON.stringify({ id: '1VdZPW6awQJmV3gTQ_tncPjPtLHMPCLDNLSTglqezvu8', codes: ['440578'] })
    },
    fetch: async url => {
      const requestUrl = new URL(url);
      const action = requestUrl.searchParams.get('action');
      if (url.includes('/export?format=csv') || url.includes('corsproxy.io')) throw new Error('offline');
      if (!networkAvailable) throw new Error('offline');
      if (action === 'test') return response({ success: true });
      if (action === 'add') return response({ success: true, data: { id: requestUrl.searchParams.get('id'), barras: requestUrl.searchParams.get('barras'), qtd: Number(requestUrl.searchParams.get('qtd')), timestamp: '2026-11-17T22:00:00.000Z' } });
      throw new Error(`Unexpected action: ${action}`);
    }
  });

  await app.documentListeners.get('DOMContentLoaded')();
  const unsent = await savedHistory(app);
  assert.equal(unsent.find(item => item.id === 'phone-original-id').syncStatus, 'pending');
  assert.equal(unsent.find(item => item.id === 'phone-original-id').syncError, 'offline');
  assert.equal(app.requests.some(([url]) => new URL(url).searchParams.get('action') === 'add'), false);

  networkAvailable = true;
  await app.windowListeners.get('online')();

  const [addUrl] = app.requests.map(([url]) => url).filter(url => new URL(url).searchParams.get('action') === 'add');
  assert.ok(addUrl);
  assert.equal(new URL(addUrl).searchParams.get('id'), 'phone-original-id');
  const saved = await savedHistory(app);
  assert.equal(saved.find(item => item.id === 'phone-original-id').syncStatus, 'confirmed');
  assert.equal(saved.find(item => item.id === 'uncertain-original-id').syncStatus, 'uncertain');
  assert.equal(app.requests.filter(([url]) => new URL(url).searchParams.get('action') === 'add').length, 1);
});

test('retoma no carregamento mesmo quando navigator.onLine é falso e endpoint responde', async () => {
  const item = { id: 'startup-original-id', remoteId: 'startup-original-id', code: '440578', qty: 1, syncStatus: 'pending', syncAttempted: false, synced: false };
  const app = createApp({
    storage: {
      apiUrl: 'https://tests.example/exec',
      history: JSON.stringify([item]),
      cadastroCache: JSON.stringify({ id: '1VdZPW6awQJmV3gTQ_tncPjPtLHMPCLDNLSTglqezvu8', codes: ['440578'] })
    },
    fetch: async url => {
      const requestUrl = new URL(url);
      const action = requestUrl.searchParams.get('action');
      if (url.includes('/export?format=csv') || url.includes('corsproxy.io')) throw new Error('NetworkError');
      if (action === 'test') return response({ success: true });
      if (action === 'add') return response({ success: true, data: { id: requestUrl.searchParams.get('id'), barras: '440578', qtd: 1, timestamp: '2026-11-17T22:00:00.000Z' } });
      throw new Error(`Unexpected action: ${action}`);
    }
  });
  app.run('navigator.onLine = false');

  await app.documentListeners.get('DOMContentLoaded')();

  const adds = app.requests.map(([url]) => url).filter(url => new URL(url).searchParams.get('action') === 'add');
  assert.equal(adds.length, 1);
  assert.equal(new URL(adds[0]).origin, 'https://tests.example');
  assert.equal(new URL(adds[0]).searchParams.get('id'), 'startup-original-id');
  assert.equal((await savedHistory(app))[0].syncStatus, 'confirmed');
});

test('retoma pendências quando a API volta sem evento online do navegador', async () => {
  let networkAvailable = false;
  const item = { id: 'poll-original-id', remoteId: 'poll-original-id', code: '440578', qty: 1, syncStatus: 'pending', syncAttempted: false, synced: false };
  const app = createApp({
    storage: { apiUrl: 'https://tests.example/exec', history: JSON.stringify([item]) },
    fetch: async url => {
      const requestUrl = new URL(url);
      const action = requestUrl.searchParams.get('action');
      if (url.includes('/export?format=csv') || url.includes('corsproxy.io')) throw new Error('NetworkError');
      if (!networkAvailable) throw new Error('NetworkError');
      if (action === 'test') return response({ success: true });
      if (action === 'add') return response({ success: true, data: { id: requestUrl.searchParams.get('id'), barras: '440578', qtd: 1, timestamp: '2026-11-17T22:00:00.000Z' } });
      throw new Error(`Unexpected action: ${action}`);
    }
  });

  await app.documentListeners.get('DOMContentLoaded')();
  assert.equal((await savedHistory(app))[0].syncStatus, 'pending');
  networkAvailable = true;
  await app.intervalCallbacks[0]();

  const adds = app.requests.map(([url]) => url).filter(url => new URL(url).searchParams.get('action') === 'add');
  assert.equal(adds.length, 1);
  assert.equal(new URL(adds[0]).searchParams.get('id'), 'poll-original-id');
  assert.equal((await savedHistory(app))[0].syncStatus, 'confirmed');
});

test('tentativa manual mantém o mesmo ID e confirma somente resposta correspondente', async () => {
  const item = { id: 'manual-original-id', remoteId: 'manual-original-id', code: '440578', qty: 1, syncStatus: 'pending', syncAttempted: false, synced: false, syncError: 'Sem conexão' };
  const app = createApp({
    storage: { apiUrl: 'https://api.example/exec', history: JSON.stringify([item]) },
    fetch: async url => {
      const requestUrl = new URL(url);
      return response({ success: true, data: { id: requestUrl.searchParams.get('id'), barras: '440578', qtd: 1, timestamp: '2026-11-17T22:00:00.000Z' } });
    }
  });
  app.context.renderHistory();

  assert.equal(app.elements.get('historyList').children[0].children.at(-1).textContent, 'Tentar sincronizar');
  await app.context.retrySync('manual-original-id');

  const addUrl = app.requests.map(([url]) => url).find(url => new URL(url).searchParams.get('action') === 'add');
  assert.ok(addUrl);
  assert.equal(new URL(addUrl).searchParams.get('id'), 'manual-original-id');
  assert.equal((await savedHistory(app))[0].syncStatus, 'confirmed');
  assert.equal((await savedHistory(app))[0].id, 'manual-original-id');
});

test('sincronização sem confirmação válida conserva a pendência e mostra o motivo', async () => {
  const item = { id: 'keep-original-id', remoteId: 'keep-original-id', code: '440578', qty: 1, syncStatus: 'pending', synced: false };
  const app = createApp({
    storage: { apiUrl: 'https://api.example/exec', history: JSON.stringify([item]) },
    fetch: async url => {
      const requestUrl = new URL(url);
      if (requestUrl.searchParams.get('action') === 'test') return response({ success: true });
      return response({ success: false, error: 'Conflito de ID' });
    }
  });

  await app.context.retrySync('keep-original-id');

  const [saved] = await savedHistory(app);
  assert.equal(saved.id, 'keep-original-id');
  assert.equal(saved.syncStatus, 'uncertain');
  assert.equal(saved.syncError, 'Conflito de ID');
  assert.equal(app.elements.get('historyList').children[0].children[0].children[1].children.at(-1).textContent, 'Conflito de ID');
  assert.equal(app.elements.get('historyList').children[0].children.at(-1).textContent, 'Tentar sincronizar');
});

test('persistência local falha antes do envio remoto e não anuncia gravação', async () => {
  const app = createApp({ storage: { apiUrl: 'https://api.example/exec' } });
  app.run('apiConnected = true;');
  app.setFailWrites(true);
  setForm(app);
  await app.context.saveData();
  assert.equal(app.requests.length, 0);
  assert.equal(app.storage.has('history'), false);
  assert.match(app.elements.get('alertMessage').textContent, /Não foi possível salvar/);
  assert.equal(app.elements.get('saveText').textContent, 'Enviar contagem');
});

test('histórico inválido é arquivado e histórico antigo mantém horário ausente', async () => {
  const invalid = createApp({ storage: { history: '{invalid' } });
  assert.ok([...invalid.storage.keys()].some(key => key.startsWith('history.corrupt.')));
  assert.equal(invalid.storage.get('history'), '{invalid');
  const legacy = createApp({ storage: { history: JSON.stringify([{ code: '0007', qty: 2, time: '10:32' }]) } });
  const [item] = await savedHistory(legacy);
  assert.equal(item.code, '0007');
  assert.equal(item.time, '10:32');
  assert.equal(item.collectedAt, undefined);
  assert.equal(item.date, undefined);
});

test('quantidade decimal, vazia, inválida e fora da faixa são rejeitadas; zero e ajuste negativo são mantidos', async () => {
  const app = createApp();
  for (const value of ['1.5', '', 'NaN', 'Infinity', '9007199254740992']) {
    setForm(app, '0004', value);
    await app.context.saveData();
    assert.equal((await savedHistory(app)).length, 0, `${value} deveria ser rejeitado`);
  }
  for (const value of ['0', '-2']) {
    setForm(app, '0004', value);
    await app.context.saveData();
  }
  assert.deepEqual((await savedHistory(app)).map(item => item.qty), [-2, 0]);
});

test('código e quantidade iguais produzem IDs distintos em operações separadas', async () => {
  const app = createApp();
  setForm(app, '0009', '3');
  await app.context.saveData();
  setForm(app, '0009', '3');
  await app.context.saveData();
  const items = await savedHistory(app);
  assert.equal(items.length, 2);
  assert.notEqual(items[0].id, items[1].id);
});

test('exclusão remota rejeitada mantém o registro local identificado e não usa código/quantidade', async () => {
  const item = { id: 'stable-1', remoteId: 'stable-1', code: '0007', qty: 2, syncStatus: 'confirmed', synced: true };
  const app = createApp({ storage: { apiUrl: 'https://api.example/exec', history: JSON.stringify([item]) }, fetch: async () => response({ success: false }) });
  app.run('apiConnected = true;');
  app.context.askDelete('stable-1');
  await app.context.confirmDelete();
  assert.equal((await savedHistory(app))[0].id, 'stable-1');
  assert.equal(app.requests.length, 1);
  assert.match(app.requests[0][0], /action=delete&id=stable-1/);
  assert.doesNotMatch(app.requests[0][0], /barras=|qtd=/);
});

test('remoção de lançamento incerto fica desabilitada e a chamada direta preserva o histórico', async () => {
  const item = { id: 'uncertain-1', remoteId: 'uncertain-1', code: '0008', qty: 3, syncStatus: 'uncertain', synced: false };
  const app = createApp({ storage: { apiUrl: 'https://api.example/exec', history: JSON.stringify([item]) } });
  app.run('apiConnected = true;');
  app.context.askDelete('uncertain-1');
  assert.equal(app.elements.get('btnConfirmDelete').disabled, true);
  assert.equal(app.elements.get('btnConfirmDelete').textContent, 'Remoção bloqueada');
  await app.context.confirmDelete();
  assert.equal(app.elements.get('confirmOverlay').classList.contains('show'), true);
  assert.deepEqual(await savedHistory(app), [item]);
  assert.equal(app.requests.length, 0);
  assert.match(app.elements.get('alertMessage').textContent, /Registro incerto preservado/);
  app.context.closeConfirm();
  assert.equal(app.elements.get('btnConfirmDelete').disabled, false);
  assert.equal(app.elements.get('btnConfirmDelete').textContent, 'Remover');
});

test('duas chamadas de exclusão simultâneas geram uma única requisição', async () => {
  const item = { id: 'stable-2', code: '0008', qty: 1, syncStatus: 'confirmed', synced: true };
  let resolveFetch;
  const app = createApp({ storage: { apiUrl: 'https://api.example/exec', history: JSON.stringify([item]) }, fetch: () => new Promise(resolve => { resolveFetch = resolve; }) });
  app.run('apiConnected = true;');
  app.context.askDelete('stable-2');
  const first = app.context.confirmDelete();
  await app.context.confirmDelete();
  assert.equal(app.requests.length, 1);
  resolveFetch(response({ success: true }));
  await first;
  assert.deepEqual(await savedHistory(app), []);
});

test('código presente na Alpha7 é aceito e o CSV válido atualiza o cache local', async () => {
  const app = createApp({ fetch: async () => ({ ok: true, text: async () => 'BARRAS,DESCRICAO\r\n"0000123","Produto, tipo A"\r\n' }) });
  await app.context.loadCadastro();
  assert.deepEqual(Array.from(app.run('cadastro')), ['0000123']);
  assert.equal(app.run('cadastroState'), 'verified');
  assert.deepEqual(JSON.parse(app.storage.get('cadastroCache')), { id: '1VdZPW6awQJmV3gTQ_tncPjPtLHMPCLDNLSTglqezvu8', codes: ['0000123'] });
  app.elements.get('barrasInput').value = '0000123';
  app.elements.get('qtdInput').value = '1';
  app.context.validateBarras();
  await app.context.saveData();
  assert.equal((await savedHistory(app))[0].code, '0000123');
  assert.equal(app.elements.get('validationText').textContent, 'Encontrado no cadastro Alpha7');
});

test('CSV Alpha7 em coluna única mantém códigos textuais e zeros à esquerda', async () => {
  const app = createApp({ fetch: async () => ({ ok: true, text: async () => '0000123\r\n0000456\r\n' }) });
  await app.context.loadCadastro();
  assert.deepEqual(Array.from(app.run('cadastro')), ['0000123', '0000456']);
  assert.deepEqual(JSON.parse(app.storage.get('cadastroCache')).codes, ['0000123', '0000456']);
});

test('código ausente da Alpha7 bloqueia envio e não entra no histórico nem na API', async () => {
  const app = createApp({ fetch: async () => ({ ok: true, text: async () => 'BARRAS,DESCRICAO\r\n"0000123","Produto, tipo A"\r\n' }) });
  await app.context.loadCadastro();
  app.elements.get('barrasInput').value = '0000999';
  app.elements.get('qtdInput').value = '1';
  app.context.validateBarras();
  await app.context.saveData();
  assert.equal(app.run('isValid'), false);
  assert.deepEqual(await savedHistory(app), []);
  assert.equal(app.requests.filter(([url]) => String(url).includes('action=add')).length, 0);
  assert.equal(app.elements.get('alertMessage').textContent, 'Código não encontrado no cadastro Alpha7. Contagem não registrada.');
});

test('cache de outra planilha ou com estrutura inválida não autoriza coleta', async () => {
  for (const cache of [
    JSON.stringify({ id: 'outra-alpha', codes: ['0000123'] }),
    JSON.stringify({ id: '1VdZPW6awQJmV3gTQ_tncPjPtLHMPCLDNLSTglqezvu8', codes: ['produto-inválido'] })
  ]) {
    const app = createApp({ storage: { cadastroCache: cache }, fetch: async () => { throw new Error('offline'); } });
    await app.context.loadCadastro();
    app.elements.get('barrasInput').value = '0000123';
    app.elements.get('qtdInput').value = '1';
    app.context.validateBarras();
    await app.context.saveData();
    assert.equal(app.run('cadastroState'), 'unavailable');
    assert.deepEqual(await savedHistory(app), []);
  }
});

test('scanner e entrada manual mostram o bloqueio Alpha7 para código ausente', () => {
  const scanner = createApp({ Quagga: { init(config, callback) { callback(null); }, onDetected() {}, offDetected() {}, start() {}, stop() {} } });
  scanner.run('cadastroState = "verified"; cadastro = ["0000123"];');
  scanner.context.openScanner();
  scanner.context.onBarcodeDetected({ codeResult: { code: '0000999' } });
  scanner.context.onBarcodeDetected({ codeResult: { code: '0000999' } });
  assert.equal(scanner.elements.get('validationText').textContent, 'Código não encontrado no cadastro Alpha7. Contagem não registrada.');
  assert.equal(scanner.elements.get('alertMessage').textContent, 'Código não encontrado no cadastro Alpha7. Contagem não registrada.');
  assert.equal(scanner.elements.get('qtdInput').focused, undefined);
  const manual = createApp({ prompt: '0000999' });
  manual.run('cadastroState = "verified"; cadastro = ["0000123"];');
  manual.context.manualInput();
  assert.equal(manual.elements.get('validationText').textContent, 'Código não encontrado no cadastro Alpha7. Contagem não registrada.');
  assert.equal(manual.elements.get('alertMessage').textContent, 'Código não encontrado no cadastro Alpha7. Contagem não registrada.');
});

test('sem internet usa o cache Alpha7 local e aceita somente código nele presente', async () => {
  const cache = JSON.stringify({ id: '1VdZPW6awQJmV3gTQ_tncPjPtLHMPCLDNLSTglqezvu8', codes: ['0000123'] });
  const app = createApp({ storage: { cadastroCache: cache }, fetch: async () => { throw new Error('offline'); } });
  await app.context.loadCadastro();
  assert.equal(app.run('cadastroState'), 'cached');
  app.elements.get('barrasInput').value = '0000123';
  app.elements.get('qtdInput').value = '2';
  app.context.validateBarras();
  await app.context.saveData();
  assert.equal((await savedHistory(app))[0].code, '0000123');
  assert.equal(app.elements.get('validationText').textContent, 'Encontrado no último cadastro válido');
});

test('sem internet e sem cache válido bloqueia coleta com orientação para carregar Alpha7', async () => {
  const app = createApp({ fetch: async () => { throw new Error('offline'); } });
  await app.context.loadCadastro();
  app.elements.get('barrasInput').value = '0000123';
  app.elements.get('qtdInput').value = '1';
  app.context.validateBarras();
  await app.context.saveData();
  assert.equal(app.run('cadastroState'), 'unavailable');
  assert.equal(app.run('isValid'), false);
  assert.deepEqual(await savedHistory(app), []);
  assert.equal(app.elements.get('statCadastro').textContent, 'Alpha7 indisponível');
  assert.equal(app.elements.get('alertMessage').textContent, 'Cadastro Alpha7 indisponível. Carregue o cadastro antes de coletar. Contagem não registrada.');
  assert.equal(app.elements.get('loadingOverlay').classList.contains('hidden'), true);
});

test('scanner impede sessões paralelas e fecha com segurança durante inicialização', () => {
  const callbacks = [];
  const listeners = new Set();
  let starts = 0;
  let stops = 0;
  const Quagga = {
    init(config, callback) { callbacks.push(callback); },
    onDetected(callback) { listeners.add(callback); },
    offDetected(callback) { listeners.delete(callback); },
    start() { starts++; }, stop() { stops++; }
  };
  const app = createApp({ Quagga });
  app.context.openScanner();
  app.context.openScanner();
  assert.equal(callbacks.length, 1);
  assert.equal(listeners.size, 1);
  app.context.closeScanner();
  callbacks[0](null);
  assert.equal(starts, 0);
  assert.ok(stops >= 1);
  assert.equal(listeners.size, 0);
  app.context.openScanner();
  assert.equal(callbacks.length, 2);
  assert.equal(listeners.size, 1);
  app.context.closeScanner();
  assert.equal(listeners.size, 0);
});

test('scanner indisponível e falha de lanterna não deixam sessão ativa', async () => {
  const unavailable = createApp();
  unavailable.context.openScanner();
  assert.equal(unavailable.elements.get('scannerOverlay').classList.contains('show'), false);
  const app = createApp({ Quagga: { init() {}, onDetected() {}, offDetected() {}, stop() {}, start() {} } });
  app.run('cameraTrack = { getCapabilities: () => ({ torch: true }), applyConstraints: async () => { throw new Error("unsupported"); } };');
  await app.context.toggleFlash();
  assert.match(app.elements.get('alertMessage').textContent, /controlar a lanterna/);
});

test('exportação inclui todos os registros, escapa CSV, protege fórmulas e libera URL', async () => {
  const rows = Array.from({ length: 21 }, (_, index) => ({ id: `id-${index}`, remoteId: `id-${index}`, code: index === 0 ? '="a,b"\r\n@' : `000${index}`, qty: 1, syncStatus: 'pending', synced: false }));
  const app = createApp({ storage: { history: JSON.stringify(rows) } });
  app.context.exportHistory();
  const download = app.downloads[0];
  const csv = await download.blob.text();
  assert.match(csv, /Codigo \(protegido para planilha\)/);
  assert.match(csv, /'=""a,b""/);
  assert.match(csv, /id-20/);
  assert.match(csv, /Pendente|pending/);
  assert.deepEqual(app.revokedUrls, [download.url]);
});

test('home prioriza coleta sem totais nem histórico fixo', () => {
  assert.equal(/class="stats-bar"/.test(html), false, 'cartões de totais não devem estar na home');
  assert.equal(/<section class="history-card"/.test(html), false, 'histórico não deve ocupar painel permanente');
  assert.match(html, /<details[^>]*id="pendingDetails"/);
  assert.match(html, /Pendências/);
  assert.match(html, /Enviar contagem/);
  assert.match(html, /collectionStatusText/);
  assert.match(html, /btnScan/);
  assert.match(html, /Exportar CSV de recuperação/);
});

test('estado compacto distingue pronto, envio, desconexão e pendências', () => {
  const app = createApp();
  app.context.updateCollectionStatus();
  assert.equal(app.elements.get('collectionStatusText').textContent, 'Sem conexão');
  app.run('apiConnected = true; updateCollectionStatus();');
  assert.equal(app.elements.get('collectionStatusText').textContent, 'Pronto');
  app.run('isSaving = true; updateCollectionStatus();');
  assert.equal(app.elements.get('collectionStatusText').textContent, 'Enviando');
  app.run('isSaving = false; history = [{ syncStatus: "uncertain" }]; updateCollectionStatus();');
  assert.equal(app.elements.get('collectionStatusText').textContent, 'Com pendências');
});

test('pendências recolhíveis mostram estados distintos e ação manual de sincronização', async () => {
  const records = [
    { id: 'confirmed', code: '0001', qty: 12, date: '17/11/2026', time: '10:32:15', syncStatus: 'confirmed' },
    { id: 'pending', code: '0002', qty: -2, date: '17/11/2026', time: '10:35:42', syncStatus: 'pending' },
    { id: 'uncertain', code: '0003', qty: 0, date: '17/11/2026', time: '10:38:10', syncStatus: 'uncertain' }
  ];
  const app = createApp({ storage: { history: JSON.stringify(records) } });
  app.context.renderHistory();
  app.context.updateStats();
  assert.equal(app.elements.get('pendingCount').textContent, '2');
  assert.equal(app.elements.get('historyList').children.length, 2);
  assert.equal(app.elements.get('historyList').children[0].children[0].children[0].textContent, '0002');
  assert.equal(app.elements.get('historyList').children[0].children[0].children[1].children[0].textContent, '−2 un.');
  assert.equal(app.elements.get('historyList').children[0].children[0].children[1].children[1].textContent, '17/11/2026 · 10:35:42');
  assert.equal(app.elements.get('historyList').children[0].children[0].children[1].children[2].textContent, 'Não enviado');
  assert.equal(app.elements.get('historyList').children[1].children[0].children[1].children[2].textContent, 'Confirmação incerta');
  assert.equal(app.elements.get('historyList').children[0].children.length, 2);
  assert.equal(app.elements.get('historyList').children[1].children.length, 2);
  assert.equal(app.elements.get('historyList').children[0].children[1].textContent, 'Tentar sincronizar');
  assert.equal(app.elements.get('historyList').children[1].children[1].textContent, 'Tentar sincronizar');
  assert.deepEqual(await savedHistory(app), records);
});

test('confirmação remota dá aviso breve e prepara o próximo código', async () => {
  const app = createApp({ storage: { apiUrl: 'https://api.example/exec' } });
  app.run('apiConnected = true;');
  setForm(app, '000051', '2');
  await app.context.saveData();
  assert.equal((await savedHistory(app))[0].syncStatus, 'confirmed');
  assert.equal(app.elements.get('barrasInput').value, '');
  assert.equal(app.elements.get('qtdInput').value, '1');
  assert.equal(app.document.activeElement, app.elements.get('barrasInput'));
  assert.equal(app.elements.get('alertMessage').textContent, 'Contagem confirmada. Próxima coleta pronta.');
  assert.equal(app.elements.get('confirmOverlay').classList.contains('show'), false);
});

test('configurações legadas e IDs padrão são preservados', () => {
  const app = createApp({ storage: { apiUrl: 'https://api.example/exec', cadastroId: 'legacy-cadastro', dadosId: 'legacy-dados', sound: 'true' } });
  assert.equal(app.run('CONFIG.API_URL'), 'https://api.example/exec');
  assert.equal(app.run('CONFIG.CADASTRO_ID'), 'legacy-cadastro');
  assert.equal(app.run('CONFIG.DADOS_ID'), 'legacy-dados');
  assert.equal(app.run('settings.sound'), true);
  const defaults = createApp();
  assert.equal(defaults.run('CONFIG.API_URL'), '');
  assert.equal(defaults.run('CONFIG.CADASTRO_ID'), '1VdZPW6awQJmV3gTQ_tncPjPtLHMPCLDNLSTglqezvu8');
  assert.equal(defaults.run('CONFIG.DADOS_ID'), '1ROSdUmwBl2P9EwCPCGKe-Qh6eyBOzoYMX8h9vC-nph4');
});

test('falha de armazenamento nas configurações restaura valores anteriores', () => {
  const app = createApp({ storage: { apiUrl: 'https://old.example/exec', cadastroId: 'old-cadastro', dadosId: 'old-dados' } });
  app.context.initSettingsUI();
  app.elements.get('settingApiUrl').value = 'https://new.example/exec';
  app.elements.get('settingCadastroId').value = 'new-cadastro';
  app.elements.get('settingDadosId').value = 'new-dados';
  app.setFailWrites('cadastroId');
  app.context.saveSettings();
  assert.equal(app.storage.get('apiUrl'), 'https://old.example/exec');
  assert.equal(app.storage.get('cadastroId'), 'old-cadastro');
  assert.equal(app.storage.get('dadosId'), 'old-dados');
});

test('configurações editadas só persistem ao salvar; cancelar restaura a preferência anterior e o foco', () => {
  const app = createApp({ storage: { darkMode: 'false' } });
  app.context.openSettings();
  const dialog = app.elements.get('settingsDialog');
  const first = app.elements.get('settingApiUrl');
  const last = app.elements.get('toggleDebug');
  dialog.focusables = [first, last];
  let prevented = false;
  app.documentListeners.get('keydown')({ key: 'Tab', shiftKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(app.document.activeElement, last);
  app.context.toggleSetting('darkMode');
  assert.equal(app.storage.get('darkMode'), 'false');
  assert.equal(app.document.body['data-theme'], 'dark');
  app.context.closeSettings();
  assert.equal(app.storage.get('darkMode'), 'false');
  assert.equal(app.document.body['data-theme'], 'light');
  assert.equal(app.document.activeElement, app.elements.get('btnSettings'));
  app.context.openSettings();
  let escapePrevented = false;
  app.documentListeners.get('keydown')({ key: 'Escape', preventDefault() { escapePrevented = true; } });
  assert.equal(escapePrevented, true);
  assert.equal(app.elements.get('settingsModal').classList.contains('show'), false);
});

test('salvar preferências confirma os toggles e persiste os valores escolhidos', () => {
  const app = createApp();
  app.context.openSettings();
  app.context.toggleSetting('darkMode');
  app.context.saveSettings();
  assert.equal(app.storage.get('darkMode'), 'true');
  assert.equal(app.run('settings.darkMode'), true);
});

test('novos registros guardam segundos e timestamp completo; antigas datas não são fabricadas', async () => {
  const app = createApp();
  setForm(app, '0001', '1');
  await app.context.saveData();
  const [item] = await savedHistory(app);
  assert.match(item.time, /^\d{2}:\d{2}:\d{2}$/);
  assert.ok(Number.isFinite(Date.parse(item.collectedAt)));
  assert.equal(item.remoteConfirmedAt, null);
});

test('totais não são exibidos como consolidados e pendências usam renderização segura', async () => {
  const app = createApp();
  setForm(app, '<img src=x onerror=alert(1)>', '1');
  await app.context.saveData();
  assert.equal(app.elements.get('historyList').children[0].children[0].children[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(app.elements.get('historyList').children[0].children[0].children[0].innerHTML, '');
  assert.equal(app.elements.get('pendingCount').textContent, '1');
  assert.equal(app.elements.get('historyList').children[0].children[0].children[1].children[2].textContent, 'Não enviado');
  assert.equal(/Unidades contabilizadas|Produtos distintos|Últimos lançamentos/.test(html), false);
});

test('alteração concorrente do histórico em outra aba bloqueia sobrescrita', async () => {
  const app = createApp();
  setForm(app);
  app.storage.set('history', JSON.stringify([{ id: 'external', code: '0002', qty: 3 }]));
  await app.context.saveData();
  assert.equal(JSON.parse(app.storage.get('history'))[0].id, 'external');
});
