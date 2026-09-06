'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { simulate, createState } = require('../src/main/simulation');
const { champions } = require('../src/data/champions.cache.json');
const data = require('../src/data/gamedata.cache.json');
const fixtures = require('./simulation-fixtures');
const clone = value => JSON.parse(JSON.stringify(value));
const timeline = require('../src/renderer/draft-timeline');
test('randomized rosters pick from top to bottom, including Support first, after bans', () => {
  assert.notDeepEqual(timeline.randomSlots(() => 0), timeline.randomSlots(() => 0.99));
  for (const side of ['blue', 'red']) {
    const allies = [4, 2, 0, 3, 1]; const enemies = [3, 1, 4, 0, 2];
    const frames = timeline.frames(side, undefined, 'Top', allies, enemies);
    assert.deepEqual(frames.filter(f => f.phase === 'lock' && f.active.team === 'allies').map(f => f.active.slot), allies);
    assert.deepEqual(frames.filter(f => f.phase === 'lock' && f.active.team === 'enemies').map(f => f.active.slot), enemies);
    assert.deepEqual(frames[0].spec.displayOrder, { myTeam: allies, theirTeam: enemies });
    for (const frame of frames.filter(f => f.phase.startsWith('ban'))) {
      assert.ok([...frame.spec.allies, ...frame.spec.enemies].every(p => !p.champion && !p.hover));
    }
    assert.equal(frames.find(f => f.phase === 'hover').spec.bans.length, 10);
    assert.equal(timeline.delay('ban'), 15000);
  }
});
test('all five selected roles identify the right local player on either side', async () => {
  for (const side of ['blue', 'red']) for (const role of timeline.roles) {
    const frames = timeline.frames(side, undefined, role);
    const local = frames.find(f => f.phase === 'hover' && f.active.team === 'allies' && f.active.slot === timeline.roles.indexOf(role));
    const result = await simulate(local.spec, champions, data);
    assert.equal(result.draft.myPosition, role);
    assert.equal(result.draft.isMyTurn, true);
    assert.equal(result.items, null);
  }
});
test('swaps preserve role and completed picks, and reject locked teammates or self', () => {
  for (const side of ['blue', 'red']) {
    const original = timeline.defaultSlots(side);
    const frames = timeline.frames(side);
    const early = frames.find(f => f.phase === 'hover' && f.active.team === 'allies');
    const swapped = timeline.swap(early.spec, original, 1);
    const replay = timeline.frames(side, undefined, 'Top', swapped);
    assert.equal(replay[frames.indexOf(early)].spec.role, 'Top');
    const before = frames.findIndex(f => f.phase === 'lock' && f.active.team === 'allies');
    assert.throws(() => timeline.swap(frames[before].spec, original, 1));
    assert.throws(() => timeline.swap(early.spec, original, 0));
    const late = frames.findIndex(f => f.phase === 'hover' && f.active.team === 'allies' && f.active.slot === 2);
    const next = timeline.swap(frames[late].spec, original, 2);
    const changed = timeline.frames(side, undefined, 'Top', next)[late];
    for (let i = 0; i < 5; i++) if (frames[late].spec.allies[i].champion) {
      assert.deepEqual(changed.spec.allies[i], frames[late].spec.allies[i]);
    }
  }
  assert.equal(timeline.delay('hover'), 15000);
  assert.equal(timeline.delay('lock'), 0);
});

test('animated draft follows ranked pick order on both sides, with no future picks revealed', async () => {
  for (const side of ['blue', 'red']) {
    const frames = timeline.frames(side);
    const locks = frames.filter(f => f.phase === 'lock');
    assert.deepEqual(locks.map(f => f.active.side), ['blue','red','red','blue','blue','red','red','blue','blue','red']);
    assert.equal(frames[5].spec.bans.length, 10);
    for (let i = 0; i < locks.length; i++) {
      const state = createState(locks[i].spec, champions, data);
      assert.equal([...state.myTeam, ...state.theirTeam].filter(p => p.championId).length, i + 1);
    }
    for (const frame of frames.filter(f => f.phase === 'hover')) {
      const result = await simulate(frame.spec, champions, data);
      const myTurn = frame.active.team === 'allies' && frame.active.slot === 0;
      assert.equal(result.draft.isMyTurn, myTurn);
      if (myTurn) { assert.equal(result.items, null); assert.equal(result.draft.me.championId, 0); }
    }
    const final = await simulate(frames.at(-1).spec, champions, data);
    assert.ok(final.items);
    assert.equal(final.counters, null);
    assert.equal(final.draft.isMyTurn, false);
  }
});

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
