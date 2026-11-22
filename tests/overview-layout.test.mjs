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
