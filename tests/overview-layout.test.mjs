import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('market desk overview starts with a collapsible briefing before market indicators', async () => {
  const code = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const overview = code.match(/if \(state\.view === 'overview'\) main\.replaceChildren\(([^;]+)\);/)?.[1];
  assert.ok(overview, 'overview renderer must exist');
  assert.match(overview, /^\s*renderBrief\(/);
  assert.ok(overview.indexOf('renderBrief(') < overview.indexOf('renderQuotes()'));
  const briefing = code.slice(code.indexOf('function renderBrief('),code.indexOf('function renderBacktest('));
  assert.match(briefing,/E\('details'/);
  assert.match(briefing,/E\('summary'/);
  assert.match(briefing,/renderImpact\(\)/);
});

test('KIS Korea indexes and signed foreign flows are rendered before global indicators', async () => {
  const code = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const section = code.slice(code.indexOf('function renderQuotes()'), code.indexOf('function sparkline('));
  assert.ok(section.includes("panelHead('시장 지표'"));
  for (const id of ['kospi', 'kosdaq', 'kr_foreign_kospi', 'kr_foreign_kosdaq', 'kr_pension_kospi', 'kr_pension_kosdaq']) {
    assert.ok(section.includes(`['${id}',`), `missing domestic indicator ${id}`);
  }
  for (const title of ['한국 증시 · 외국인·연기금 수급','미국 지수선물','금리','원화 환율','원자재 선물','코인 선물']) {
    assert.ok(section.includes(title), `missing topic title: ${title}`);
  }
  assert.doesNotMatch(section, /metrics-asia|metrics-other|무기한/);
  const groups=['metrics-korea','metrics-global','metrics-macro','metrics-commodities','metrics-crypto'];
  for(let i=1;i<groups.length;i++)
    assert.ok(section.indexOf(groups[i-1])<section.indexOf(groups[i]),'market topics must stay in reading order');
  assert.match(section,/groups\.map\(\(\[number,id,title,subtitle,theme,quotes\]\)=>/);
  assert.match(section,/seen\.add\(id\)/,'do not duplicate KIS domestic indicators');
  assert.match(code, /const investor = pension \? '연기금' : '외국인'/);
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
