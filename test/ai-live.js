'use strict';
const assert = require('assert');
const { loadChampions } = require('../src/main/champdata');
const { parseSession } = require('../src/main/draft');
const { analyzeDraft } = require('../src/main/analyze');
const { buildPrompt } = require('../src/main/prompt');
const { Analyzer, extractJson, validate } = require('../src/main/ai');
const { buildSession } = require('./fixture');

(async () => {
  const { champions, version } = await loadChampions();
  const byName = {};
  for (const k of Object.keys(champions)) byName[champions[k].name] = parseInt(k, 10);
  const id = (n) => byName[n];

  const state = parseSession(buildSession(id));
  const analysis = analyzeDraft(state, champions);
  const prompt = buildPrompt(state, analysis, champions, { patch: version });

  console.log('=== PROMPT ===\n' + prompt + '\n');

  // Deterministic guard: a forged response naming a banned champion must be rejected.
  const forged = { read: 'x', picks: [{ champ: 'Ahri', score: 99 }, { champ: 'Orianna', score: 80 }], avoid: [] };
  const guarded = validate(forged, state, champions);
  assert.ok(!guarded.picks.some((p) => p.champ === 'Ahri'), 'banned Ahri must be filtered out');
  assert.ok(guarded.rejected.some((p) => p.champ === 'Ahri'), 'Ahri must land in rejected');
  assert.ok(guarded.picks.some((p) => p.champ === 'Orianna'), 'legal pick must survive');
  console.log('GUARD OK: forged banned pick (Ahri) filtered, legal pick (Orianna) kept\n');

  console.log('=== LIVE CLAUDE CALL ===');
  const t0 = Date.now();
  let firstToken = null;
  const analyzer = new Analyzer({ model: process.env.MODEL || 'sonnet' });
  const raw = await analyzer.run(prompt, {
    onDelta: () => { if (!firstToken) { firstToken = Date.now() - t0; } },
  });
  const total = Date.now() - t0;

  const parsed = extractJson(raw);
  assert.ok(parsed, 'model output must contain parseable JSON');
  const result = validate(parsed, state, champions);

  console.log(`time-to-first-token: ${firstToken}ms | total: ${total}ms | chars: ${raw.length}`);
  console.log('\nREAD: ' + result.read);
  for (const p of result.picks) {
    console.log(`\n  ${p.champ} (${p.score})`);
    console.log(`    lane: ${p.lane}`);
    console.log(`    fit:  ${p.fit}`);
    console.log(`    risk: ${p.risk}`);
  }
  console.log('\nAVOID: ' + result.avoid.map((a) => `${a.champ} - ${a.why}`).join(' | '));
  if (result.rejected.length) {
    console.log('\nREJECTED (illegal suggestions caught): ' + result.rejected.map((r) => r.champ).join(', '));
  } else {
    console.log('\nREJECTED: none - model respected the ban list');
  }

  const bannedNames = ['Yasuo', 'Katarina', 'Ahri', 'Sylas', 'Malphite', 'Leona', 'Jinx', 'Darius', 'Zed'];
  for (const p of result.picks) {
    assert.ok(!bannedNames.includes(p.champ), 'illegal pick surfaced: ' + p.champ);
  }
  console.log('\nAll live assertions passed.');
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
