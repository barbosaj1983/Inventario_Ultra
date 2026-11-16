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
    clearTimeout() {},
    URL,
    Blob,
    confirm: () => options.confirm ?? true,
    prompt: () => null,
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
  app.run('isValid = true; cadastroState = "unavailable";');
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
  resolveFetch(response({ success: true }));
  await first;
  assert.equal((await savedHistory(app)).length, 1);
  assert.equal(app.elements.get('barrasInput').value, '000999');
  assert.equal(app.elements.get('qtdInput').value, '4');
  assert.equal(app.elements.get('saveText').textContent, 'Registrar lançamento');
  assert.equal(app.elements.get('btnSave').disabled, false);
  assert.equal(app.elements.get('btnSave').dataset.state, 'ready');
});

test('lançamento local concluído não recebe texto de confirmação da planilha', async () => {
  const app = createApp();
  setForm(app, '000050', '2');
  await app.context.saveData();
  assert.equal(app.elements.get('btnSave').dataset.state, 'saved');
  assert.equal(app.elements.get('saveText').textContent, 'Salvo neste aparelho');
  assert.equal((await savedHistory(app))[0].syncStatus, 'pending');
});

test('mais de 100 registros ficam persistidos e a exibição é limitada separadamente', async () => {
  const app = createApp();
  for (let index = 0; index < 125; index++) {
    setForm(app, `000${index}`, '1');
    await app.context.saveData();
  }
  assert.equal((await savedHistory(app)).length, 125);
  assert.equal(app.elements.get('savedBadge').textContent, 125);
  assert.equal(app.elements.get('historyList').children.length, 15);
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
  assert.equal(app.requests.length, 1);
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
  assert.equal(app.elements.get('saveText').textContent, 'Registrar lançamento');
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

test('cadastro indisponível ou HTML é não verificado, sem perder zeros à esquerda', async () => {
  const htmlApp = createApp({ fetch: async () => ({ ok: true, text: async () => '<html><body>Login</body></html>' }) });
  await htmlApp.context.loadCadastro();
  setForm(htmlApp, '0000123', '1');
  htmlApp.context.validateBarras();
  await htmlApp.context.saveData();
  const [item] = await savedHistory(htmlApp);
  assert.equal(item.code, '0000123');
  assert.equal(item.verificationStatus, 'not-verified');
  assert.equal(htmlApp.elements.get('loadingOverlay').classList.contains('hidden'), true);
  const csvApp = createApp({ fetch: async () => ({ ok: true, text: async () => 'BARRAS,DESCRICAO\r\n"0000123","Produto, tipo A"\r\n' }) });
  await csvApp.context.loadCadastro();
  assert.deepEqual(Array.from(csvApp.run('cadastro')), ['0000123']);
  assert.throws(() => csvApp.context.parseCadastroCsv('CODIGO,DESCRICAO\r\n0000123,Produto\r\n'));
  assert.throws(() => csvApp.context.parseCadastroCsv('BARRAS,DESCRICAO\r\n0000123\r\n'));
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

test('configurações legadas e IDs padrão são preservados', () => {
  const app = createApp({ storage: { apiUrl: 'https://api.example/exec', cadastroId: 'legacy-cadastro', dadosId: 'legacy-dados', sound: 'true' } });
  assert.equal(app.run('CONFIG.API_URL'), 'https://api.example/exec');
  assert.equal(app.run('CONFIG.CADASTRO_ID'), 'legacy-cadastro');
  assert.equal(app.run('CONFIG.DADOS_ID'), 'legacy-dados');
  assert.equal(app.run('settings.sound'), true);
  const defaults = createApp();
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

test('totais permanecem identificados como locais e renderização não usa HTML de dados', async () => {
  const app = createApp();
  setForm(app, '<img src=x onerror=alert(1)>', '1');
  await app.context.saveData();
  assert.equal(app.elements.get('historyList').children[0].children[0].children[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(app.elements.get('historyList').children[0].children[0].children[0].innerHTML, '');
  assert.equal(app.elements.get('statPending').textContent, 1);
  assert.equal(app.elements.get('historyList').children[0].children[0].children[1].children[2].textContent, 'Somente neste aparelho');
  assert.match(html, /números acima são locais e não consolidam contagens de outros aparelhos/i);
});

test('alteração concorrente do histórico em outra aba bloqueia sobrescrita', async () => {
  const app = createApp();
  setForm(app);
  app.storage.set('history', JSON.stringify([{ id: 'external', code: '0002', qty: 3 }]));
  await app.context.saveData();
  assert.equal(JSON.parse(app.storage.get('history'))[0].id, 'external');
});
