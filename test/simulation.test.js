'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { simulate, createState } = require('../src/main/simulation');
const { champions } = require('../src/data/champions.cache.json');
const data = require('../src/data/gamedata.cache.json');
const fixtures = require('./simulation-fixtures');
const clone = value => JSON.parse(JSON.stringify(value));

test('all scenario presets run without LoL or a model and satisfy their assertions', async () => {
  for (const fixture of fixtures) {
    const result = await simulate(fixture, champions, data);
    assert.ok(result.checks.every(c => c.pass), fixture.title + JSON.stringify(result.checks));
  }
});
test('blind recommendations use real portraits; hover never becomes a locked build', async () => {
  const blind = await simulate(fixtures[0], champions, data);
  const hover = await simulate(fixtures[2], champions, data);
  assert.equal(hover.items, null);
  assert.equal(blind.counters.list[0].name, 'Gragas');
  assert.deepEqual(hover.counters.list, blind.counters.list);
  assert.ok(blind.counters.list.every(p => p.img.endsWith('.png')));
});
test('200 reproducible draft variations never recommend banned or picked champions', async () => {
  const pool = ['Gragas', 'Ornn', 'Gnar', 'Renekton', 'Shen'];
  for (let seed = 0; seed < 200; seed++) {
    const spec = clone(fixtures[0]); delete spec.expect;
    spec.bans = pool.filter((_, i) => seed & (1 << i));
    if (seed & 32) spec.allies[0].hover = 'Gragas';
    if (seed & 64) { spec.enemies[4].champion = 'Teemo'; }
    const state = createState(spec, champions, data);
    const result = await simulate(spec, champions, data);
    assert.ok(result.counters.list.length <= 3);
    for (const p of result.counters.list) assert.ok(!state.unavailable.has(p.championId), seed + ': illegal ' + p.name);
  }
});
test('invalid scenarios are rejected instead of generating plausible advice', async () => {
  for (const mutate of [s => { s.role = 'Unknown'; }, s => { s.allies[0].champion = 'Viego'; },
    s => { s.allies[0].champion = 'NotAChampion'; }, s => { s.enemies[0].level = -1; },
    s => { s.allies.pop(); }, s => { s.opponent = 'Ornn'; }]) {
    const spec = clone(fixtures[0]); mutate(spec);
    await assert.rejects(simulate(spec, champions, data));
  }
});
test('known lane uses the same provider and respects the no-data fallback', async () => {
  let called = false;
  const spec = fixtures[1];
  const result = await simulate(spec, champions, data, { buildLaneStats: async args => {
    called = true; assert.equal(args.opponentName, 'Teemo'); return null;
  } });
  assert.ok(called); assert.equal(result.counters.unavailable, true);
  assert.deepEqual(result.counters.list, []);
});
test('AP Gragas preserves offensive identity instead of being treated as a full tank', async () => {
  const spec = clone(fixtures[5]); spec.allies[0] = { champion: 'Gragas', items: [3111], level: 13 };
  const result = await simulate(spec, champions, data, { championBuild: async () => ({
    boots: 3111, tier: 'test', patch: 'test', games: 1000, core: [],
    fullBuild: [3100, 4645, 3089, 4629, 3135].map(id => ({ id, winRate: 53, games: 1000 })) }) });
  assert.equal(result.items.target.id, '3100');
  assert.ok(!result.items.plan.some(it => it.id === '4401'));
});
test('README example reproduces the saved recommendation and item plan from its recorded data', async () => {
  const example = require('../docs/examples/worked-example.json');
  const baselines = require('../docs/examples/baselines.json');
  const provider = { championBuild: async (id, role) => baselines.find(b => b.championId === id && b.role === role) || null };
  const draft = await simulate(example.draftInput, champions, data, provider);
  const live = await simulate(example.liveInput, champions, data, provider);
  assert.deepEqual(draft.counters.list, example.draftResult.counters.list);
  assert.deepEqual(live.items.plan, example.liveResult.items.plan);
  assert.equal(live.items.target.name, 'Force of Nature');
});
