import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('market desk overview starts with indicators, before commentary and Korea impact', async () => {
  const code = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const overview = code.match(/if \(state\.view === 'overview'\) main\.replaceChildren\(([^;]+)\);/)?.[1];
  assert.ok(overview, 'overview renderer must exist');
  assert.match(overview, /^renderQuotes\(\),\s*renderBrief\(\),\s*renderImpact\(\),/);
  assert.ok(overview.indexOf('renderQuotes()') < overview.indexOf('renderBrief()'));
  assert.ok(overview.indexOf('renderBrief()') < overview.indexOf('renderImpact()'));
});

test('KIS Korea indexes and signed foreign flows are rendered before global indicators', async () => {
  const code = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const section = code.slice(code.indexOf('function renderQuotes()'), code.indexOf('function sparkline('));
  assert.ok(section.includes("panelHead('국내외 핵심 지표'"));
  for (const id of ['kospi', 'kosdaq', 'kr_foreign_kospi', 'kr_foreign_kosdaq']) {
    assert.ok(section.includes(`['${id}',`), `missing domestic indicator ${id}`);
  }
  assert.ok(section.indexOf("domestic.map(quoteCard)") < section.indexOf("global.map(quoteCard)"),
    'domestic indicator cards must display before global cards');
  assert.match(section, /Number\(quote\.value\) < 0 \? '외국인 순매도'/);
  assert.match(code, /quote\.id\?\.startsWith\('kr_foreign_'\) \? 2/,
    'foreign flow values in KRW 100M should retain two fractional digits');
});

test('market status reports exact observed coverage, and opens source diagnostics', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const market = await readFile(new URL('../src/market.js', import.meta.url), 'utf8');
  const status = app.slice(app.indexOf('function dataState()'), app.indexOf('async function refreshCurrent()'));
  assert.match(status,/\`지표 \${good\.length}\/\${quotes\.length} 정상 수신\`/);
  assert.match(status,/\['daily', 'delayed', 'live', 'monthly'\]/);
  assert.match(status,/onClick: \(\) => navigate\('sources'\)/);
  assert.match(status,/type: 'button'/);
  assert.doesNotMatch(status,/일부 데이터 연결/);
  assert.match(market,/healthy === quotes\.length \? 'live' : 'partial'/);
  assert.match(market,/\['live', 'delayed', 'daily', 'monthly'\]/);
});
