const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pagePath = path.join(__dirname, '..', 'Inventario_Ultra_v8_homologacao.html');

test('página de homologação também usa a interface coletora sem mostrar totais locais', () => {
  const html = fs.readFileSync(pagePath, 'utf8');
  assert.doesNotMatch(html, /class="stats-bar"|class="history-card"/);
  assert.match(html, /<details[^>]*id="pendingDetails"/);
  assert.match(html, /id="collectionStatusText"/);
  assert.match(html, /Enviar contagem/);
  assert.match(html, /Exportar CSV de recuperação/);
});

test('página de homologação existe e não pode usar endpoint ou IDs de produção', () => {
  assert.ok(fs.existsSync(pagePath), 'página isolada de homologação deve existir');
  const html = fs.readFileSync(pagePath, 'utf8');
  assert.match(html, /const HOMOLOGATION_API_URL = 'https:\/\/script\.google\.com\/macros\/s\/AKfycbw5ZkVPQ_moFkNVNsl2ozUUvjgsIte1UBLIPxI1uOJ_mCIMRU8O-GkOKNcGp61UM0cm\/exec'/);
  assert.doesNotMatch(html, /1VdZPW6awQJmV3gTQ_tncPjPtLHMPCLDNLSTglqezvu8|1ROSdUmwBl2P9EwCPCGKe-Qh6eyBOzoYMX8h9vC-nph4/);
  assert.match(html, /inventario-ultra-v8-homologacao:/);
  assert.match(html, /HOMOLOGAÇÃO — DADOS DE TESTE/);
  assert.match(html, /get CADASTRO_URLS\(\) \{ return \[\]; \}/);
  assert.match(html, /settingApiUrl[\s\S]*?readonly/);
});
