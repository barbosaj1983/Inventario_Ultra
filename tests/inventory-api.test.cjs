const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createMockAppsScript } = require('./apps-script-mock.cjs');
const { createApp, setForm, savedHistory } = require('./inventory-v8-harness.cjs');

const API_SOURCE = path.join(__dirname, '..', 'backend', 'Inventario API.gs');
const ORIGINAL_API = path.join(__dirname, '..', 'backend', 'originals', 'Inventario API.gs');
const ORIGINAL_MACRO = path.join(__dirname, '..', 'backend', 'originals', 'macros.GS');
const ORIGINAL_TIMESTAMP = '2026-11-16T20:00:00.000Z';

function fixedDate(iso = ORIGINAL_TIMESTAMP) {
  return class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [iso])); }
    static now() { return new Date(iso).getTime(); }
  };
}

function sequenceDate(start = ORIGINAL_TIMESTAMP, stepMilliseconds = 1000) {
  let nextMilliseconds = Date.parse(start);
  return class SequenceDate extends Date {
    constructor(...args) {
      if (args.length) super(...args);
      else {
        super(nextMilliseconds);
        nextMilliseconds += stepMilliseconds;
      }
    }
    static now() { return nextMilliseconds; }
  };
}

function seedRow({ timestamp = new Date(ORIGINAL_TIMESTAMP), code = '000123', quantity = 12, id = 'original-id' } = {}) {
  return [timestamp, code, quantity, id];
}

test('originais estão preservados e a macro destrutiva não é importada nem executada', () => {
  const api = fs.readFileSync(API_SOURCE, 'utf8');
  const original = fs.readFileSync(ORIGINAL_API, 'utf8');
  const macro = fs.readFileSync(ORIGINAL_MACRO, 'utf8');
  assert.match(api, /function doGet\(e\)/);
  assert.match(original, /function testarScript\(\)/);
  assert.match(macro, /deleteRows\(/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'apps-script-mock.cjs'), 'utf8'), /macros\.GS/);
});

test('reenvio do mesmo ID e dados retorna o timestamp original sem acrescentar linha', () => {
  const app = createMockAppsScript({ DateConstructor: fixedDate() });
  const first = app.call({ action: 'add', barras: '000123', qtd: '12', id: 'same-id' });
  const replay = app.call({ action: 'add', barras: '000123', qtd: '12', id: 'same-id' });
  assert.equal(first.success, true);
  assert.equal(replay.success, true);
  assert.equal(first.data.timestamp, ORIGINAL_TIMESTAMP);
  assert.equal(replay.data.timestamp, ORIGINAL_TIMESTAMP);
  assert.equal(app.rows.length, 2);
  assert.equal(app.counters.writes, 1);
  assert.equal(app.counters.lockAttempts, 2);
  assert.equal(app.counters.releases, 2);
});

test('conflito de ID por código ou quantidade rejeita sem alterar a linha', () => {
  for (const params of [
    { action: 'add', barras: '000999', qtd: '12', id: 'original-id' },
    { action: 'add', barras: '000123', qtd: '-2', id: 'original-id' }
  ]) {
    const app = createMockAppsScript({ rows: [seedRow()] });
    const before = app.rows.map(row => row.slice());
    const result = app.call(params);
    assert.equal(result.success, false);
    assert.match(result.error, /Conflito de ID/);
    assert.deepEqual(app.rows, before);
  }
});

test('IDs duplicados preexistentes recusam inclusão idempotente e exclusão ambígua', () => {
  const app = createMockAppsScript({ rows: [seedRow(), seedRow({ code: '000999' })] });
  assert.match(app.call({ action: 'add', barras: '000123', qtd: '12', id: 'original-id' }).error, /ID duplicado/);
  assert.match(app.call({ action: 'delete', id: 'original-id' }).error, /ID duplicado/);
  assert.equal(app.counters.deletes, 0);
  assert.equal(app.rows.length, 3);
});

test('aceita inteiros positivos, negativos e zero, rejeita valores inválidos e preserva zeros do código', () => {
  const app = createMockAppsScript({ DateConstructor: fixedDate() });
  for (const [quantity, id] of [['12', 'plus'], ['-2', 'minus'], ['0', 'zero']]) {
    assert.equal(app.call({ action: 'add', barras: '0000042', qtd: quantity, id }).success, true);
  }
  const before = app.rows.length;
  for (const quantity of ['', '1.2', 'NaN', 'Infinity', '9007199254740992', null]) {
    assert.equal(app.call({ action: 'add', barras: '0000042', qtd: quantity, id: `bad-${String(quantity)}` }).success, false);
  }
  assert.equal(app.rows.length, before);
  assert.equal(app.rows[1][1], '0000042');
  assert.equal(typeof app.rows[1][1], 'string');
  assert.deepEqual(app.textFormats.filter(format => format.startColumn === 2 || format.startColumn === 4).map(format => format.format), ['@', '@', '@', '@', '@', '@']);
});

test('ajuste negativo é novo lançamento aditivo com ID e timestamp próprios', () => {
  const app = createMockAppsScript({ DateConstructor: sequenceDate() });
  const original = app.call({ action: 'add', barras: '000123', qtd: '12', id: 'count-id' });
  const adjustment = app.call({ action: 'add', barras: '000123', qtd: '-2', id: 'adjustment-id' });
  assert.equal(original.success, true);
  assert.equal(adjustment.success, true);
  assert.equal(original.data.id, 'count-id');
  assert.equal(adjustment.data.id, 'adjustment-id');
  assert.equal(app.rows.slice(1).reduce((total, row) => total + row[2], 0), 10);
  assert.equal(app.rows[1][0].toISOString(), ORIGINAL_TIMESTAMP);
  assert.equal(app.rows[2][0].toISOString(), '2026-11-16T20:00:01.000Z');
  assert.notEqual(app.rows[1][3], app.rows[2][3]);
});

test('exclusão exige ID, remove apenas a linha com esse ID e guarda tombstone', () => {
  const app = createMockAppsScript({ DateConstructor: fixedDate(), rows: [seedRow(), seedRow({ id: 'other-id', code: '000123', quantity: 12 })] });
  const rejected = app.call({ action: 'delete', barras: '000123', qtd: '12' });
  assert.equal(rejected.success, false);
  assert.equal(app.rows.length, 3);
  const removed = app.call({ action: 'delete', id: 'other-id' });
  assert.equal(removed.success, true);
  assert.equal(removed.deleted.id, 'other-id');
  assert.equal(app.rows.length, 2);
  assert.equal(app.sheets.get('__InventarioDeletedIds').hidden, true);
  assert.equal(app.call({ action: 'delete', id: 'other-id' }).success, true);
  const retry = app.call({ action: 'add', barras: '000123', qtd: '12', id: 'other-id' });
  assert.equal(retry.success, false);
  assert.match(retry.error, /já excluído/);
  assert.equal(app.rows.length, 2);
});

test('tombstone com timestamp inválido bloqueia reuso do ID sem recriar o lançamento', () => {
  const app = createMockAppsScript({ ledgerRows: [['deleted-id', 'not-a-timestamp']] });
  const result = app.call({ action: 'add', barras: '000123', qtd: '12', id: 'deleted-id' });
  assert.equal(result.success, false);
  assert.match(result.error, /tombstone inválido/);
  assert.equal(app.rows.length, 1);
});

test('falha ao remover após gravar tombstone não permite ressurreição e exclusão repetida conclui', () => {
  const app = createMockAppsScript({ rows: [seedRow({ id: 'retry-delete' })] });
  const originalDeleteRow = app.sheet.deleteRow.bind(app.sheet);
  app.sheet.deleteRow = () => { throw new Error('simulated delete failure'); };
  const firstAttempt = app.call({ action: 'delete', id: 'retry-delete' });
  assert.equal(firstAttempt.success, false);
  assert.equal(app.rows.length, 2);
  assert.equal(app.sheets.get('__InventarioDeletedIds').rows.length, 2);
  app.sheet.deleteRow = originalDeleteRow;
  const retry = app.call({ action: 'delete', id: 'retry-delete' });
  assert.equal(retry.success, true);
  assert.equal(app.rows.length, 1);
  assert.equal(app.sheets.get('__InventarioDeletedIds').rows.length, 2);
  const staleAdd = app.call({ action: 'add', barras: '000123', qtd: '12', id: 'retry-delete' });
  assert.equal(staleAdd.success, false);
  assert.match(staleAdd.error, /já excluído/);
});

test('bloqueio envolve operação crítica e recusa sem gravar quando não adquirido', () => {
  const app = createMockAppsScript();
  const held = app.context.LockService.getScriptLock();
  assert.equal(held.tryLock(30000), true);
  const result = app.call({ action: 'add', barras: '000123', qtd: '1', id: 'busy-id' });
  assert.equal(result.success, false);
  assert.match(result.error, /bloqueio/);
  assert.equal(app.rows.length, 1);
  assert.equal(app.counters.releases, 0);
  held.releaseLock();
  assert.equal(app.call({ action: 'add', barras: '000123', qtd: '1', id: 'busy-id' }).success, true);
  assert.equal(app.counters.releases, 2);
});

test('lock compartilhado impede exclusão concorrente durante a inclusão crítica', () => {
  const app = createMockAppsScript({ rows: [seedRow({ id: 'existing-id' })] });
  let nested;
  app.setOnWrite(() => {
    nested = app.call({ action: 'delete', id: 'existing-id' });
  });
  const outer = app.call({ action: 'add', barras: '000123', qtd: '1', id: 'outer-id' });
  assert.equal(outer.success, true);
  assert.equal(nested.success, false);
  assert.match(nested.error, /bloqueio/);
  assert.equal(app.rows.length, 3);
  assert.equal(app.counters.deletes, 0);
  assert.equal(app.counters.lockAttempts, 2);
  assert.equal(app.counters.releases, 1);
});

test('list devolve até 50 linhas recentes e não carrega a faixa completa', () => {
  const rows = Array.from({ length: 130 }, (_, index) => seedRow({ id: `id-${index}`, code: String(index).padStart(6, '0'), quantity: index }));
  const app = createMockAppsScript({ rows });
  const result = app.call({ action: 'list' });
  assert.equal(result.success, true);
  assert.equal(result.total, 130);
  assert.equal(result.data.length, 50);
  assert.equal(result.data[0].id, 'id-129');
  assert.equal(result.data.at(-1).id, 'id-80');
  assert.equal(app.counters.dataRangeReads, 0);
  assert.ok(app.counters.rangeReads <= 2);
});

test('test retorna lastModified de mutação, não o horário da consulta', () => {
  const actualLastModified = '2026-11-10T15:30:45.000Z';
  const app = createMockAppsScript({ properties: { lastModified: actualLastModified }, DateConstructor: fixedDate('2026-11-16T22:30:00.000Z'), scriptTimeZone: 'America/New_York', spreadsheetTimeZone: 'America/Los_Angeles' });
  const result = app.call({ action: 'test' });
  assert.equal(result.lastModified, actualLastModified);
  assert.equal(result.scriptTimeZone, 'America/New_York');
  assert.equal(result.spreadsheetTimeZone, 'America/Los_Angeles');
  assert.equal(app.scriptProperties.get('lastModified'), actualLastModified);
});

test('lastModified muda após inclusão e exclusão confirmadas, não após consulta', () => {
  const app = createMockAppsScript({ DateConstructor: fixedDate('2026-11-16T20:00:00.000Z') });
  assert.equal(app.call({ action: 'test' }).lastModified, null);
  app.call({ action: 'add', barras: '000123', qtd: '1', id: 'change-id' });
  assert.equal(app.call({ action: 'test' }).lastModified, ORIGINAL_TIMESTAMP);
  const deleteDate = '2026-11-16T20:00:00.000Z';
  assert.equal(app.call({ action: 'delete', id: 'change-id' }).deletedAt, deleteDate);
  assert.equal(app.call({ action: 'test' }).lastModified, deleteDate);
});

test('JSON inválido e falha ao obter planilha viram resposta de erro JSON', () => {
  const app = createMockAppsScript();
  assert.match(app.call({ action: 'add' }, { postData: { contents: '{bad' } }).error, /JSON inválido/);
  const failed = createMockAppsScript({ failGetSpreadsheet: true });
  assert.match(failed.call({ action: 'test' }).error, /unavailable/);
});

test('erro de gravação mantém resposta false e libera o lock', () => {
  const app = createMockAppsScript({ failWrite: true });
  const result = app.call({ action: 'add', barras: '000123', qtd: '1', id: 'failed-write' });
  assert.equal(result.success, false);
  assert.match(result.error, /write failure/);
  assert.equal(app.counters.releases, 1);
});

test('V8 envia o mesmo contrato e guarda timestamp confirmado pelo backend separadamente', async () => {
  const api = createMockAppsScript({ DateConstructor: fixedDate() });
  const app = createApp({ storage: { apiUrl: 'https://staging.example/exec' }, fetch: async url => {
    const parsed = new URL(url);
    const params = Object.fromEntries(parsed.searchParams.entries());
    return { ok: true, json: async () => api.call(params) };
  } });
  app.run('apiConnected = true;');
  setForm(app, '000123', '12');
  await app.context.saveData();
  const local = (await savedHistory(app))[0];
  assert.equal(local.syncStatus, 'confirmed');
  assert.equal(local.remoteServerTimestamp, ORIGINAL_TIMESTAMP);
  assert.ok(Number.isFinite(Date.parse(local.remoteConfirmedAt)));
  assert.equal(api.rows[1][1], '000123');
  assert.equal(api.rows[1][2], 12);
  assert.equal(api.rows[1][3], local.id);
  app.context.exportHistory();
  const exported = await app.downloads[0].blob.text();
  assert.match(exported, /Gravacao confirmada pelo servidor/);
  assert.match(exported, new RegExp(ORIGINAL_TIMESTAMP));
});

test('resposta perdida após gravação fica incerta e reenvio manual do mesmo ID não duplica', async () => {
  const api = createMockAppsScript({ DateConstructor: fixedDate() });
  let requestId;
  const app = createApp({ storage: { apiUrl: 'https://staging.example/exec' }, fetch: async url => {
    const parsed = new URL(url);
    const params = Object.fromEntries(parsed.searchParams.entries());
    requestId = params.id;
    api.call(params);
    throw new Error('response lost after server commit');
  } });
  app.run('apiConnected = true;');
  setForm(app, '000123', '12');
  await app.context.saveData();
  assert.equal((await savedHistory(app))[0].syncStatus, 'uncertain');
  assert.equal(api.rows.length, 2);
  const replay = api.call({ action: 'add', barras: '000123', qtd: '12', id: requestId });
  assert.equal(replay.success, true);
  assert.equal(replay.data.timestamp, ORIGINAL_TIMESTAMP);
  assert.equal(api.rows.length, 2);
});

test('falha antes do commit não cria lançamento e frontend conserva estado incerto local', async () => {
  const api = createMockAppsScript({ DateConstructor: fixedDate() });
  const app = createApp({ storage: { apiUrl: 'https://staging.example/exec' }, fetch: async () => { throw new Error('network unavailable before request'); } });
  app.run('apiConnected = true;');
  setForm(app, '000123', '-2');
  await app.context.saveData();
  assert.equal((await savedHistory(app))[0].syncStatus, 'uncertain');
  assert.equal(api.rows.length, 1);
});
