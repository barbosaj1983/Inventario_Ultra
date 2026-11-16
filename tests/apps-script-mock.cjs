const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createMockAppsScript(options = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'backend', 'Inventario API.gs'), 'utf8');
  const mainRows = [options.headers || ['Timestamp', 'Código de barras', 'Quantidade', 'ID'], ...(options.rows || []).map(row => row.slice(0, 4))];
  const ledgerRows = (options.ledgerRows || []).map(row => row.slice(0, 2));
  const scriptProperties = new Map(Object.entries(options.properties || {}));
  const counters = { rangeReads: 0, dataRangeReads: 0, writes: 0, deletes: 0, lockAttempts: 0, releases: 0, inserts: 0 };
  const textFormats = [];
  const sheets = new Map();
  let locked = false;
  let onWrite = null;
  let onWriteCalled = false;

  function displayValue(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    return String(value);
  }

  function createSheet(name, rows) {
    const sheet = {
      name,
      rows,
      hidden: false,
      getLastRow() { return this.rows.length; },
      getLastColumn() { return Math.max(0, ...this.rows.map(row => row.length)); },
      getDataRange() {
        counters.dataRangeReads++;
        return makeRange(this, 1, 1, this.rows.length, this.getLastColumn());
      },
      getRange(row, column, rowCount = 1, columnCount = 1) {
        return makeRange(this, row, column, rowCount, columnCount);
      },
      deleteRow(rowNumber) {
        if (options.failDelete) throw new Error('mock delete failure');
        this.rows.splice(rowNumber - 1, 1);
        counters.deletes++;
      },
      hideSheet() { this.hidden = true; return this; }
    };
    sheets.set(name, sheet);
    return sheet;
  }

  function makeRange(sheet, startRow, startColumn, rowCount, columnCount) {
    return {
      setNumberFormat(format) {
        textFormats.push({ sheet: sheet.name, startRow, startColumn, rowCount, columnCount, format });
        return this;
      },
      getValues() {
        counters.rangeReads++;
        return Array.from({ length: rowCount }, (_, rowOffset) =>
          Array.from({ length: columnCount }, (_, columnOffset) => {
            const value = sheet.rows[startRow + rowOffset - 1]?.[startColumn + columnOffset - 1];
            return value instanceof Date ? new Date(value.getTime()) : value ?? '';
          })
        );
      },
      getDisplayValues() {
        counters.rangeReads++;
        return Array.from({ length: rowCount }, (_, rowOffset) =>
          Array.from({ length: columnCount }, (_, columnOffset) =>
            displayValue(sheet.rows[startRow + rowOffset - 1]?.[startColumn + columnOffset - 1])
          )
        );
      },
      setValues(newValues) {
        if (options.failWrite) throw new Error('mock write failure');
        if (onWrite && !onWriteCalled) {
          onWriteCalled = true;
          onWrite();
        }
        for (let rowOffset = 0; rowOffset < rowCount; rowOffset++) {
          const rowNumber = startRow + rowOffset;
          while (sheet.rows.length < rowNumber) sheet.rows.push(Array(sheet.getLastColumn() || 4).fill(''));
          const row = sheet.rows[rowNumber - 1];
          for (let columnOffset = 0; columnOffset < columnCount; columnOffset++) {
            row[startColumn + columnOffset - 1] = newValues[rowOffset][columnOffset];
          }
        }
        counters.writes++;
        return this;
      }
    };
  }

  const mainSheet = createSheet(options.sheetName || 'Respostas ao formulário 1', mainRows);
  if (options.ledgerRows) createSheet('__InventarioDeletedIds', [['ID', 'DeletedAt'], ...ledgerRows]);

  const spreadsheet = {
    getSheetByName(name) { return sheets.get(name) || null; },
    insertSheet(name) {
      if (options.failInsertSheet) throw new Error('mock insert sheet failure');
      const newSheet = createSheet(name, []);
      sheets.set(name, newSheet);
      counters.inserts++;
      return newSheet;
    },
    getSpreadsheetTimeZone() { return options.spreadsheetTimeZone || 'Etc/UTC'; }
  };
  const context = vm.createContext({
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        if (options.failGetSpreadsheet) throw new Error('mock spreadsheet unavailable');
        return spreadsheet;
      }
    },
    LockService: {
      getScriptLock() {
        return {
          tryLock() {
            counters.lockAttempts++;
            if (locked || options.lockUnavailable) return false;
            locked = true;
            return true;
          },
          releaseLock() {
            locked = false;
            counters.releases++;
          }
        };
      }
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key) { return scriptProperties.has(key) ? scriptProperties.get(key) : null; },
          setProperty(key, value) {
            if (options.failProperties) throw new Error('mock properties failure');
            scriptProperties.set(key, String(value));
          }
        };
      }
    },
    Session: {
      getScriptTimeZone() { return options.scriptTimeZone || 'Etc/UTC'; }
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(content) {
        return {
          content,
          mimeType: null,
          setMimeType(mimeType) { this.mimeType = mimeType; return this; },
          getContent() { return this.content; }
        };
      }
    },
    Date: options.DateConstructor || Date,
    Math
  });
  vm.runInContext(source, context, { timeout: 1000 });

  function call(params, event = {}) {
    const output = context.handleRequest({ parameter: params, ...event });
    return JSON.parse(output.getContent());
  }

  return {
    call, context, sheet: mainSheet, rows: mainRows, ledgerRows, sheets, scriptProperties, counters, textFormats, spreadsheet,
    setOnWrite(callback) { onWrite = callback; }
  };
}

module.exports = { createMockAppsScript };
