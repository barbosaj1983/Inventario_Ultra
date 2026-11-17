const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pagePath = path.join(__dirname, '..', 'Inventario_Ultra_v8_homologacao.html');

test('página de homologação também bloqueia produtos fora da Alpha7 e exige cache para coleta offline', () => {
  const html = fs.readFileSync(pagePath, 'utf8');
  assert.match(html, /Código não encontrado no cadastro Alpha7\. Contagem não registrada\./);
  assert.match(html, /Cadastro Alpha7 indisponível\. Carregue o cadastro antes de coletar\. Contagem não registrada\./);
  assert.match(html, /syncStatus: 'pending'/);
  assert.match(html, /isValid = found;/);
});

test('página de homologação também usa a interface coletora sem mostrar totais locais', () => {
  const html = fs.readFileSync(pagePath, 'utf8');
  assert.doesNotMatch(html, /class="stats-bar"|class="history-card"/);
  assert.match(html, /<details[^>]*id="pendingDetails"/);
  assert.match(html, /id="collectionStatusText"/);
  assert.match(html, /Enviar contagem/);
  assert.match(html, /Exportar CSV de recuperação/);
});

test('página de homologação usa apenas o endpoint de teste e Alpha7 somente para leitura', () => {
  assert.ok(fs.existsSync(pagePath), 'página isolada de homologação deve existir');
  const html = fs.readFileSync(pagePath, 'utf8');
  assert.match(html, /const HOMOLOGATION_API_URL = 'https:\/\/script\.google\.com\/macros\/s\/AKfycbw5ZkVPQ_moFkNVNsl2ozUUvjgsIte1UBLIPxI1uOJ_mCIMRU8O-GkOKNcGp61UM0cm\/exec'/);
  assert.match(html, /const HOMOLOGATION_CADASTRO_ID = '1VdZPW6awQJmV3gTQ_tncPjPtLHMPCLDNLSTglqezvu8'/);
  assert.match(html, /docs\.google\.com\/spreadsheets\/d\/\$\{this\.CADASTRO_ID\}\/export\?format=csv/);
  assert.doesNotMatch(html, /1ROSdUmwBl2P9EwCPCGKe-Qh6eyBOzoYMX8h9vC-nph4/);
  assert.match(html, /inventario-ultra-v8-homologacao:/);
  assert.match(html, /HOMOLOGAÇÃO — DADOS DE TESTE/);
  assert.doesNotMatch(html, /get CADASTRO_URLS\(\) \{ return \[\]; \}/);
  assert.match(html, /settingApiUrl[\s\S]*?readonly/);
});
