const SHEET_NAME = 'Respostas ao formulário 1';
const LOCK_WAIT_MS = 30000;
const LAST_MODIFIED_PROPERTY = 'lastModified';
const DELETED_IDS_SHEET = '__InventarioDeletedIds';

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    const params = parseRequestParams_(e);
    const action = params.action;
    const validActions = ['add', 'delete', 'list', 'search', 'test'];
    if (!validActions.includes(action)) {
      return jsonResponse({ success: false, error: 'Ação inválida: ' + String(action), validActions });
    }
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) throw new Error('Planilha ativa indisponível');
    const sheet = spreadsheet.getSheetByName(SHEET_NAME);
    if (!sheet) {
      return jsonResponse({ success: false, error: 'Aba não encontrada: ' + SHEET_NAME });
    }
    assertSheetStructure_(sheet);
    switch (action) {
      case 'add':
        return addRow(params, sheet);
      case 'delete':
        return deleteRow(params, sheet);
      case 'list':
        return listRows(sheet);
      case 'search':
        return searchRows(params, sheet);
      case 'test':
        return testConnection(sheet, spreadsheet);
    }
  } catch (error) {
    return jsonResponse({ success: false, error: errorMessage_(error) });
  }
}

function parseRequestParams_(e) {
  if (!e || typeof e !== 'object') throw new Error('Requisição inválida');
  const params = Object.assign({}, e.parameter && typeof e.parameter === 'object' ? e.parameter : {});
  const body = e.postData && e.postData.contents;
  if (body) {
    let postParams;
    try {
      postParams = JSON.parse(body);
    } catch (error) {
      throw new Error('Corpo JSON inválido');
    }
    if (!postParams || typeof postParams !== 'object' || Array.isArray(postParams)) {
      throw new Error('Corpo JSON deve ser um objeto');
    }
    Object.assign(params, postParams);
  }
  return params;
}

function assertSheetStructure_(sheet) {
  if (sheet.getLastColumn() < 4) throw new Error('A aba precisa conter as colunas A a D existentes');
}

function addRow(params, sheet) {
  return withScriptLock_(function () {
    const code = requireCode_(params.barras);
    const quantity = parseQuantity_(params.qtd);
    const id = params.id === undefined || params.id === null || params.id === '' ? generateId() : requireId_(params.id);
    const matches = findIdRows_(sheet, id);
    if (matches.length > 1) {
      return jsonResponse({ success: false, error: 'ID duplicado na planilha; nenhum registro foi alterado', id });
    }
    if (matches.length === 1) {
      const existing = readRow_(sheet, matches[0]);
      if (existing.barras !== code || parseStoredQuantity_(existing.qtd) !== quantity) {
        return jsonResponse({ success: false, error: 'Conflito de ID: código ou quantidade não corresponde ao lançamento existente', id });
      }
      const timestamp = timestampToIso_(existing.timestamp);
      if (!timestamp) throw new Error('Timestamp do registro existente é inválido');
      return jsonResponse({
        success: true,
        message: 'Lançamento já registrado; resposta idempotente',
        data: { barras: code, qtd: quantity, id, timestamp }
      });
    }
    const tombstone = getDeletedIdTimestamp_(id);
    if (tombstone) {
      return jsonResponse({ success: false, error: 'ID já excluído; não pode ser reutilizado', id, deletedAt: tombstone });
    }
    const timestamp = new Date();
    const rowNumber = Math.max(1, sheet.getLastRow()) + 1;
    sheet.getRange(rowNumber, 2).setNumberFormat('@');
    sheet.getRange(rowNumber, 4).setNumberFormat('@');
    sheet.getRange(rowNumber, 1, 1, 4).setValues([[timestamp, code, quantity, id]]);
    setLastModified_(timestamp.toISOString());
    return jsonResponse({
      success: true,
      message: 'Adicionado com sucesso',
      data: { barras: code, qtd: quantity, id, timestamp: timestamp.toISOString() }
    });
  });
}

function deleteRow(params, sheet) {
  return withScriptLock_(function () {
    const id = requireId_(params.id);
    const matches = findIdRows_(sheet, id);
    if (matches.length > 1) {
      return jsonResponse({ success: false, error: 'ID duplicado na planilha; exclusão não executada', id });
    }
    if (matches.length === 0) {
      const deletedAt = getDeletedIdTimestamp_(id);
      if (deletedAt) {
        return jsonResponse({ success: true, message: 'ID já excluído anteriormente', id, deletedAt });
      }
      return jsonResponse({ success: false, error: 'ID não encontrado', id });
    }
    const rowNumber = matches[0];
    const row = readRow_(sheet, rowNumber);
    const deletedAt = new Date().toISOString();
    setDeletedIdTimestamp_(id, deletedAt);
    sheet.deleteRow(rowNumber);
    setLastModified_(deletedAt);
    return jsonResponse({
      success: true,
      message: 'Deletado por ID',
      row: rowNumber,
      deletedAt,
      deleted: { barras: row.barras, qtd: row.qtd, id }
    });
  });
}

function listRows(sheet) {
  const lastRow = sheet.getLastRow();
  const total = Math.max(0, lastRow - 1);
  const count = Math.min(50, total);
  const startRow = lastRow - count + 1;
  const rows = [];
  if (count > 0) {
    const values = sheet.getRange(startRow, 1, count, 4).getValues();
    const displays = sheet.getRange(startRow, 1, count, 4).getDisplayValues();
    for (let index = values.length - 1; index >= 0; index--) {
      rows.push(rowObject_(startRow + index, values[index], displays[index]));
    }
  }
  return jsonResponse({ success: true, total, data: rows });
}

function searchRows(params, sheet) {
  const code = requireCode_(params.barras);
  const lastRow = sheet.getLastRow();
  const rows = [];
  if (lastRow > 1) {
    const codes = sheet.getRange(2, 2, lastRow - 1, 1).getDisplayValues();
    for (let index = 0; index < codes.length; index++) {
      if (codes[index][0] === code) {
        const rowNumber = index + 2;
        const values = sheet.getRange(rowNumber, 1, 1, 4).getValues()[0];
        const displays = sheet.getRange(rowNumber, 1, 1, 4).getDisplayValues()[0];
        rows.push(rowObject_(rowNumber, values, displays));
      }
    }
  }
  return jsonResponse({ success: true, found: rows.length, data: rows });
}

function testConnection(sheet, spreadsheet) {
  return jsonResponse({
    success: true,
    message: 'Conexão OK',
    sheetName: SHEET_NAME,
    totalRows: sheet.getLastRow(),
    lastModified: PropertiesService.getScriptProperties().getProperty(LAST_MODIFIED_PROPERTY) || null,
    scriptTimeZone: Session.getScriptTimeZone(),
    spreadsheetTimeZone: spreadsheet.getSpreadsheetTimeZone()
  });
}

function withScriptLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) throw new Error('Não foi possível obter o bloqueio da API');
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function findIdRows_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 4, lastRow - 1, 1).getDisplayValues();
  const matches = [];
  for (let index = 0; index < values.length; index++) {
    if (values[index][0] === id) matches.push(index + 2);
  }
  return matches;
}

function readRow_(sheet, rowNumber) {
  const values = sheet.getRange(rowNumber, 1, 1, 4).getValues()[0];
  const displays = sheet.getRange(rowNumber, 1, 1, 4).getDisplayValues()[0];
  return rowObject_(rowNumber, values, displays);
}

function rowObject_(rowNumber, values, displays) {
  return {
    row: rowNumber,
    timestamp: values[0],
    barras: String(displays[1] || ''),
    qtd: values[2],
    id: displays[3] ? String(displays[3]) : null
  };
}

function requireCode_(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Código de barras é obrigatório e deve ser texto');
  return value;
}

function requireId_(value) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 128) throw new Error('ID inválido');
  return value;
}

function parseQuantity_(value) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Quantidade inválida');
  const text = String(value).trim();
  if (!/^[+-]?\d+$/.test(text)) throw new Error('Quantidade deve ser um inteiro');
  const quantity = Number(text);
  if (!Number.isSafeInteger(quantity)) throw new Error('Quantidade fora da faixa segura');
  return quantity === 0 ? 0 : quantity;
}

function parseStoredQuantity_(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? (value === 0 ? 0 : value) : NaN;
  if (typeof value !== 'string' || !/^[+-]?\d+$/.test(value.trim())) return NaN;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) ? (quantity === 0 ? 0 : quantity) : NaN;
}

function timestampToIso_(value) {
  if (value && typeof value.getTime === 'function') {
    const milliseconds = value.getTime();
    return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
  }
  if (typeof value === 'string' && value) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  return null;
}

function setLastModified_(timestamp) {
  PropertiesService.getScriptProperties().setProperty(LAST_MODIFIED_PROPERTY, timestamp);
}

function getDeletedIdTimestamp_(id) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const ledger = spreadsheet.getSheetByName(DELETED_IDS_SHEET);
  if (!ledger || ledger.getLastRow() < 2) return null;
  const ids = ledger.getRange(2, 1, ledger.getLastRow() - 1, 1).getDisplayValues();
  const matches = [];
  for (let index = 0; index < ids.length; index++) {
    if (ids[index][0] === id) matches.push(index + 2);
  }
  if (matches.length > 1) throw new Error('ID possui tombstones duplicados; nenhuma ação executada');
  if (!matches.length) return null;
  const deletedAt = timestampToIso_(ledger.getRange(matches[0], 2).getValues()[0][0]);
  if (!deletedAt) throw new Error('Timestamp de tombstone inválido; nenhuma ação executada');
  return deletedAt;
}

function setDeletedIdTimestamp_(id, timestamp) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let ledger = spreadsheet.getSheetByName(DELETED_IDS_SHEET);
  if (!ledger) {
    ledger = spreadsheet.insertSheet(DELETED_IDS_SHEET);
    ledger.getRange(1, 1, 1, 2).setValues([['ID', 'DeletedAt']]);
    ledger.hideSheet();
  }
  const existing = getDeletedIdTimestamp_(id);
  if (existing) return existing;
  const rowNumber = ledger.getLastRow() + 1;
  ledger.getRange(rowNumber, 1).setNumberFormat('@');
  ledger.getRange(rowNumber, 1, 1, 2).setValues([[id, new Date(timestamp)]]);
  return timestamp;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function errorMessage_(error) {
  return error && error.message ? String(error.message) : String(error);
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
