// ============================================
// GOOGLE APPS SCRIPT - INVENTÁRIO ULTRA POPULAR v2
// Cole este código em: Extensões → Apps Script
// ============================================

// IMPORTANTE: Ajuste o nome da aba conforme sua planilha
const SHEET_NAME = "Respostas ao formulário 1";

// Colunas esperadas na planilha:
// A = Timestamp (Carimbo de data/hora)
// B = Código de Barras
// C = Quantidade  
// D = ID (opcional - adicionado pelo app)

// ============================================
// FUNÇÃO PRINCIPAL - RECEBE GET E POST
// ============================================
function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  // Pegar parâmetros de GET ou POST
  let params = e.parameter || {};
  
  // Se for POST com JSON, parsear o body
  if (e.postData && e.postData.contents) {
    try {
      const postParams = JSON.parse(e.postData.contents);
      params = { ...params, ...postParams };
    } catch (err) {
      // Se não for JSON, tentar pegar do postData
    }
  }
  
  const action = params.action;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  
  if (!sheet) {
    return jsonResponse({ 
      success: false, 
      error: "Aba não encontrada: " + SHEET_NAME,
      hint: "Verifique se o nome da aba está correto na linha 7 do script"
    });
  }
  
  try {
    switch (action) {
      case "add":
        return addRow(params, sheet);
      case "delete":
        return deleteRow(params, sheet);
      case "list":
        return listRows(sheet);
      case "search":
        return searchRows(params, sheet);
      case "test":
        return testConnection(sheet);
      default:
        return jsonResponse({ 
          success: false, 
          error: "Ação inválida: " + action,
          validActions: ["add", "delete", "list", "search", "test"]
        });
    }
  } catch (error) {
    return jsonResponse({ success: false, error: error.toString() });
  }
}

// ============================================
// ADICIONAR LINHA
// ============================================
function addRow(params, sheet) {
  const barras = params.barras;
  const qtd = params.qtd;
  const id = params.id || generateId();
  
  if (!barras || !qtd) {
    return jsonResponse({ success: false, error: "Barras e Qtd são obrigatórios" });
  }
  
  const timestamp = new Date();
  
  // Adicionar nova linha com ID
  sheet.appendRow([timestamp, barras, qtd, id]);
  
  return jsonResponse({ 
    success: true, 
    message: "Adicionado com sucesso",
    data: { barras, qtd, id, timestamp: timestamp.toISOString() }
  });
}

// ============================================
// DELETAR LINHA - VERSÃO MELHORADA
// ============================================
function deleteRow(params, sheet) {
  const id = params.id;
  const barras = params.barras;
  const qtd = params.qtd;
  const timestamp = params.timestamp;
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  // Encontrar índices das colunas (flexível)
  let colBarras = 1; // Padrão: coluna B
  let colQtd = 2;    // Padrão: coluna C
  let colId = 3;     // Padrão: coluna D
  
  // Procurar de baixo para cima (mais recentes primeiro)
  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    const rowTimestamp = row[0];
    const rowBarras = String(row[colBarras]).trim();
    const rowQtd = String(row[colQtd]).trim();
    const rowId = row[colId] ? String(row[colId]).trim() : null;
    
    // PRIORIDADE 1: Busca por ID exato (mais confiável)
    if (id && rowId && rowId === id) {
      sheet.deleteRow(i + 1);
      return jsonResponse({ 
        success: true, 
        message: "Deletado por ID",
        row: i + 1,
        deleted: { barras: rowBarras, qtd: rowQtd, id: rowId }
      });
    }
    
    // PRIORIDADE 2: Busca por Barras + Qtd (mais específico)
    if (!id && barras && qtd && rowBarras === String(barras) && rowQtd === String(qtd)) {
      sheet.deleteRow(i + 1);
      return jsonResponse({ 
        success: true, 
        message: "Deletado por Barras+Qtd",
        row: i + 1,
        deleted: { barras: rowBarras, qtd: rowQtd }
      });
    }
    
    // PRIORIDADE 3: Busca só por Barras (última opção - menos específico)
    if (!id && !qtd && barras && rowBarras === String(barras)) {
      sheet.deleteRow(i + 1);
      return jsonResponse({ 
        success: true, 
        message: "Deletado por Barras (primeiro encontrado)",
        row: i + 1,
        deleted: { barras: rowBarras, qtd: rowQtd },
        warning: "Deletou a linha mais recente com este código"
      });
    }
  }
  
  return jsonResponse({ 
    success: false, 
    error: "Linha não encontrada",
    searchedFor: { id, barras, qtd }
  });
}

// ============================================
// LISTAR LINHAS
// ============================================
function listRows(sheet) {
  const data = sheet.getDataRange().getValues();
  const rows = [];
  
  // Pegar últimas 50 linhas (exceto cabeçalho)
  const start = Math.max(1, data.length - 50);
  
  for (let i = start; i < data.length; i++) {
    const row = data[i];
    rows.push({
      row: i + 1,
      timestamp: row[0],
      barras: row[1],
      qtd: row[2],
      id: row[3] || null
    });
  }
  
  return jsonResponse({ 
    success: true, 
    total: data.length - 1,
    data: rows.reverse() 
  });
}

// ============================================
// BUSCAR POR CÓDIGO
// ============================================
function searchRows(params, sheet) {
  const barras = params.barras;
  const data = sheet.getDataRange().getValues();
  const results = [];
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === String(barras).trim()) {
      results.push({
        row: i + 1,
        timestamp: data[i][0],
        barras: data[i][1],
        qtd: data[i][2],
        id: data[i][3] || null
      });
    }
  }
  
  return jsonResponse({ 
    success: true, 
    found: results.length,
    data: results 
  });
}

// ============================================
// TESTE DE CONEXÃO
// ============================================
function testConnection(sheet) {
  return jsonResponse({
    success: true,
    message: "Conexão OK",
    sheetName: SHEET_NAME,
    totalRows: sheet.getLastRow(),
    lastModified: new Date().toISOString()
  });
}

// ============================================
// HELPERS
// ============================================
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================
// FUNÇÃO DE TESTE (rodar no editor)
// ============================================
function testarScript() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  
  if (sheet) {
    Logger.log("✓ Aba encontrada: " + SHEET_NAME);
    Logger.log("✓ Total de linhas: " + sheet.getLastRow());
    
    // Mostrar últimas 3 linhas
    const data = sheet.getDataRange().getValues();
    Logger.log("Últimas linhas:");
    for (let i = Math.max(1, data.length - 3); i < data.length; i++) {
      Logger.log("  Linha " + (i+1) + ": " + JSON.stringify(data[i]));
    }
  } else {
    Logger.log("✗ ERRO: Aba não encontrada: " + SHEET_NAME);
    Logger.log("  Abas disponíveis:");
    const sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
    sheets.forEach(s => Logger.log("    - " + s.getName()));
  }
}
