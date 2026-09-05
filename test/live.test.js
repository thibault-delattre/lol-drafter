'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { champions } = require('../src/data/champions.cache.json');
const data = require('../src/data/gamedata.cache.json');
const { parseSession, signature } = require('../src/main/draft');
const { parseLiveGame, inventorySignature } = require('../src/main/live');
const { itemAdvice } = require('../src/main/items');
const { pickBucket, pickBuildBucket, buildCore } = require('../src/main/ugg');
const { buildSession } = require('./fixture');
const { buildBuildPrompt, inferEnemyRoles } = require('../src/main/prompt');
const { analyzeDraft } = require('../src/main/analyze');
const id = (name) => Object.values(champions).find((c) => c.name === name).id;
function fixture(mine = 'Dr. Mundo', opponents = ['Vayne', 'Vladimir', 'Jinx']) {
  return { activePlayer: { riotId: 'Coach#EUW' }, gameData: { gameTime: 600 }, allPlayers: [
    { riotId: 'Coach#EUW', championName: mine, position: 'TOP', team: 'ORDER', items: [] },
    ...opponents.map((name, i) => ({ riotId: `Enemy${i}#EUW`, championName: name,
      position: i === 0 ? 'TOP' : 'MIDDLE', team: 'CHAOS', items: [] }))] };
}
const advice = (raw, mine) => {
  const state = parseLiveGame(raw, champions);
  return itemAdvice(state, champions, data, { opponent: mine || raw.allPlayers[1].championName });
};

const planBaseline = {
  boots: 3006, starting: [1055, 2003], tier: 'Emerald+', patch: '16_17', games: 1000,
  fullBuild: [3153, 3124, 3091, 3072, 3026].map(id => ({ id, winRate: 53, games: 1000 })),
  core: [], alternatives: [],
};
test('six final slots exclude starters; recipes consume component counts and keep owned items', () => {
  const raw = fixture('Vayne', ['Gnar']); raw.gameData.gameTime = 0;
  let state = parseLiveGame(raw, champions);
  let result = itemAdvice(state, champions, data, { opponent: 'Gnar' }, planBaseline);
  assert.equal(result.plan.length, 6);
  assert.equal(result.plan.filter(it => data.itemMeta[it.id].boots).length, 1);
  assert.deepEqual(result.starting.map(it => it.id), ['1055', '2003']);
  raw.allPlayers[0].items = [{ itemID: 3153 }, { itemID: 1043 }, { itemID: 3006 }];
  raw.gameData.gameTime = 1000;
  state = parseLiveGame(raw, champions);
  result = itemAdvice(state, champions, data, { opponent: 'Gnar' }, planBaseline);
  assert.equal(result.target.id, '3124');
  assert.ok(result.plan.find(it => it.id === '3153').owned);
  assert.ok(!result.components.some(it => it.id === '1043'));
  assert.equal(result.starting.length, 0);
});
test('fed AP purchases on an AD champion shift tank priority to MR without selling owned gear', () => {
  const raw = fixture('Dr. Mundo', ['Jax', 'Jinx', 'Garen']);
  raw.gameData.gameTime = 1400;
  raw.allPlayers[1].items = [3089, 3137, 3115, 3157].map(itemID => ({ itemID }));
  raw.allPlayers[1].level = 17;
  raw.allPlayers[1].scores = { kills: 15, assists: 10, creepScore: 240 };
  raw.allPlayers[2].items = [{ itemID: 1036 }];
  raw.allPlayers[3].items = [{ itemID: 1036 }];
  raw.allPlayers[0].items = [{ itemID: 3143 }, { itemID: 3006 }];
  const result = itemAdvice(parseLiveGame(raw, champions), champions, data, { opponent: 'Garen' }, planBaseline);
  assert.ok(result.profile.apShare > 0.6);
  assert.equal(result.profile.threats[0].name, 'Jax');
  assert.equal(result.target.id, '3065');
  assert.ok(result.plan.find(it => it.id === '3143').owned);
});
test('scoreboard progression refreshes advice but passive gold does not churn model runs', () => {
  const raw = fixture();
  const before = inventorySignature(parseLiveGame(raw, champions));
  raw.activePlayer.currentGold = 900;
  assert.equal(inventorySignature(parseLiveGame(raw, champions)), before);
  raw.allPlayers[1].scores = { kills: 7, creepScore: 140 };
  assert.notEqual(inventorySignature(parseLiveGame(raw, champions)), before);
});
test('Vayne keeps damage core into stacked armor and does not auto-buy penetration', () => {
  const raw = fixture('Vayne', ['Gnar']);
  raw.allPlayers[0].items = [{ itemID: 3006 }];
  raw.allPlayers[1].items = [3143, 3075].map(itemID => ({ itemID }));
  const result = itemAdvice(parseLiveGame(raw, champions), champions, data, { opponent: 'Gnar' }, planBaseline);
  assert.equal(result.target.id, '3153');
  assert.ok(result.alerts.some(text => text.includes('Silver Bolts bypass armor')));
  assert.ok(!result.plan.some(it => ['3036', '3033', '6694'].includes(it.id)));
});
test('a finished six-slot inventory never gains a seventh item or replacement boots', () => {
  const raw = fixture('Vayne', ['Gnar']);
  raw.allPlayers[0].items = [3006, 3153, 3124, 3091, 3072, 3026].map(itemID => ({ itemID }));
  const result = itemAdvice(parseLiveGame(raw, champions), champions, data, { opponent: 'Gnar' }, planBaseline);
  assert.equal(result.plan.length, 6);
  assert.ok(result.plan.every(it => it.owned));
  assert.equal(result.target, undefined);
  assert.deepEqual(result.components, []);
});
test('missing statistical data stays explicitly incomplete', () => {
  const result = advice(fixture('Vayne', ['Gnar']));
  assert.equal(result.planComplete, false);
  assert.match(result.planLabel, /limited build data/);
});

test('in-progress championId is hover until the action is completed', () => {
  const s = buildSession(id);
  s.myTeam[3].championId = id('Orianna');
  s.actions = [[{ actorCellId: 3, type: 'pick', championId: id('Orianna'), completed: false, isInProgress: true }]];
  assert.equal(parseSession(s).me.championId, 0);
  assert.equal(parseSession(s).me.hoveredId, id('Orianna'));
  s.actions[0][0].completed = true;
  assert.equal(parseSession(s).me.championId, id('Orianna'));
});
test('changing ban intent updates threats, ordinary hover does not', () => {
  const s = buildSession(id);
  s.actions = [[{ actorCellId: 3, type: 'ban', completed: false, isInProgress: true }]];
  const before = signature(parseSession(s));
  s.myTeam[3].championPickIntent = id('Vayne');
  assert.notEqual(signature(parseSession(s)), before);
});
test('live identity resolves via Riot ID and skips unknown identity', () => {
  const raw = fixture();
  const s = parseLiveGame(raw, champions);
  assert.equal(s.me.championId, id('Dr. Mundo'));
  assert.equal(s.myPosition, 'Top');
  assert.equal(s.theirTeam.length, 3);
  raw.activePlayer.riotId = 'Unknown';
  assert.equal(parseLiveGame(raw, champions), null);
  assert.equal(parseLiveGame({}, champions), null);
});
test('item changes update signature without clock-driven reanalysis', () => {
  const raw = fixture();
  const before = inventorySignature(parseLiveGame(raw, champions));
  raw.gameData.gameTime++;
  assert.equal(inventorySignature(parseLiveGame(raw, champions)), before);
  raw.allPlayers[3].items.push({ itemID: 3031 });
  assert.notEqual(inventorySignature(parseLiveGame(raw, champions)), before);
});
test('Mundo vs Vayne warns about true damage and prioritizes lane boots', () => {
  const a = advice(fixture());
  assert.equal(a.options[0].id, '3047');
  assert.match(a.notes.join(' '), /max-health true damage/);
  assert.match(a.options[0].why, /Does not stop her true damage/);
  assert.ok(!a.options.some((it) => it.id === '3110'), 'no mana-focused Frozen Heart on Mundo');
});
test('Randuin is conditional on observed crit builds, not invented IE purchases', () => {
  const raw = fixture();
  assert.ok(!advice(raw).options.some((it) => it.id === '3143'));
  raw.allPlayers[1].items = [{ itemID: 3031 }];
  raw.allPlayers[3].items = [{ itemID: 3031 }];
  const randuin = advice(raw).options.find((it) => it.id === '3143');
  assert.match(randuin.why, /Vayne, Jinx/);
});
test('anti-heal accounts for application type and existing purchases', () => {
  const raw = fixture('Orianna', ['Dr. Mundo', 'Vladimir']);
  assert.equal(advice(raw).options[0].id, '3916');
  raw.allPlayers[0].items = [{ itemID: 3916 }];
  assert.ok(!advice(raw).options.some((it) => it.id === '3916'));
  const tank = advice(fixture('Dr. Mundo', ['Vladimir']));
  assert.match(tank.options.find((it) => it.id === '3076').why, /only applies when they attack you/);
});
test('owned upgrades suppress their components; removed items never appear', () => {
  const raw = fixture();
  raw.allPlayers[0].items = [{ itemID: 3143 }, { itemID: 3047 }];
  const a = advice(raw);
  assert.ok(!a.options.some((it) => ['3082', '3143', '3047'].includes(it.id)));
  for (const it of a.options) assert.equal(data.itemMeta[it.id].purchasable, true);
});
test('matchups and builds preserve Emerald+ even when another bucket is larger', () => {
  const payload = { 12: { 17: { 4: [[[67, 55, 100]], 'today'] }, 1: { 4: [[[67, 9000, 10000]], 'today'] } } };
  assert.equal(pickBucket(payload, 4).games, 100);
  const secs = []; secs[6] = [55, 100];
  assert.equal(pickBuildBucket({ 12: { 17: { 4: [secs, 'today'] } } }, 4).games, 100);
  assert.equal(pickBuildBucket({ 12: { 1: { 4: [secs, 'today'] } } }, 4), null);
  assert.equal(pickBucket({ 12: { 1: payload[12][1] } }, 4), null);
});
test('locked build prompt prioritizes lane and includes current item names and caveats', () => {
  const state = parseLiveGame(fixture(), champions);
  const build = { games: 100, winRate: 50, patch: '16_16', fallback: true, tier: 'Emerald+', spells: [], starting: [], core: [] };
  const p = buildBuildPrompt(state, analyzeDraft(state, champions), champions, data, build,
    { enemyRoles: { assigned: { Top: 'Vayne' }, opponent: 'Vayne' } });
  assert.match(p, /LANE PRIORITY: Vayne/);
  assert.match(p, /previous patch fallback/);
  assert.match(p, /unreliable against Vladimir/);
  assert.match(p, /observational/);
  assert.match(p, /CURRENT PURCHASABLE/);
});
test('Mundo opening core precedes later slots; combination wins are not item win rates', () => {
  const sections = [];
  sections[3] = [7556, 4409, [3083, 3084, 3009]];
  sections[5] = [[[3748, 6755, 10944], [3065, 6922, 12140]], [[2501, 1408, 2238]]];
  const core = buildCore(sections, data.itemMeta);
  assert.deepEqual(core.map((it) => it.id), [3083, 3084, 3748]);
  assert.equal(core[0].winRate, null);
  assert.ok(core.every((it) => !data.itemMeta[it.id].boots));
});
test('reported lane and manual opponent correction override ambiguous champion roles', () => {
  const state = parseLiveGame(fixture(), champions);
  assert.equal(inferEnemyRoles(state, champions).opponent, 'Vayne');
  state.opponentOverrideId = id('Vladimir');
  assert.equal(inferEnemyRoles(state, champions).opponent, 'Vladimir');
});

test('screenshot draft leaves Top unknown until Wukong appears, despite provider fringe roles', () => {
  const { assignRoles } = require('../src/main/lanes');
  const roles = {
    Diana: ['Mid', 'Jungle', 'Top', 'Support', 'Bot'],
    Xayah: ['Bot', 'Mid', 'Top', 'Support', 'Jungle'],
    Viktor: ['Mid', 'Bot', 'Top', 'Support', 'Jungle'],
    Karma: ['Support', 'Mid', 'Top', 'Bot', 'Jungle'],
    Wukong: ['Jungle', 'Top', 'Mid', 'Support', 'Bot']
  };
  const before = assignRoles(['Diana', 'Xayah', 'Viktor', 'Karma'], (n) => roles[n]).assigned;
  assert.equal(before.Top, undefined);
  assert.equal(before.Jungle, 'Diana');
  assert.equal(before.Mid, 'Viktor');
  const after = assignRoles(['Diana', 'Xayah', 'Viktor', 'Karma', 'Wukong'], (n) => roles[n]).assigned;
  assert.equal(after.Top, 'Wukong');
  assert.equal(after.Mid, 'Viktor');
});
test('blind advice is immediate, accounts for team gaps, and excludes bans and taken picks', () => {
  const { blindPicks } = require('../src/main/blind');
  const s = parseSession(buildSession(id));
  s.myPosition = 'Top';
  const analysis = { ally: { frontline: 0, adPct: 85 }, enemy: { apPct: 75 } };
  const picks = blindPicks(s, champions, analysis);
  assert.equal(picks.length, 3);
  assert.equal(picks[0].name, 'Gragas');
  assert.match(picks[0].why, /Balances/);
  s.unavailable.add(id('Gragas'));
  assert.ok(!blindPicks(s, champions, analysis).some((p) => p.name === 'Gragas'));
});
test('Vayne vs Wukong plus Diana/Viktor/Karma preserves Berserkers; minor lifesteal does not force wounds', () => {
  const raw = fixture('Vayne', ['Wukong', 'Diana', 'Viktor', 'Karma', 'Xayah']);
  raw.allPlayers.at(-1).items = [{ itemID: 1053 }];
  const result = advice(raw);
  assert.equal(result.options[0].id, '3006');
  assert.ok(!result.options.some((it) => it.id === '3047'));
  assert.ok(!result.options.some((it) => it.id === '3123'));
  raw.allPlayers[0].items = [{ itemID: 3006 }];
  assert.ok(!advice(raw).options.some((it) => it.id === '3006'));
});
test('later build items favor supported win rate over popularity or tiny lucky samples', () => {
  const { rankBuildOptions } = require('../src/main/ugg');
  const ranked = rankBuildOptions([[1, 5400, 10000], [2, 6000, 10000], [3, 19, 20], [4, 20, 10]]);
  assert.equal(ranked[0].id, 2);
  assert.deepEqual(ranked.map((it) => it.id), [2, 1]);
  const noisy = rankBuildOptions([[1, 145, 250], [2, 5400, 10000]]);
  assert.equal(noisy[0].id, 2);
});
test('thin build samples use an explicitly labeled popularity fallback', () => {
  const { rankBuildOptions } = require('../src/main/ugg');
  const ranked = rankBuildOptions([[1, 100, 200], [2, 19, 20]]);
  assert.equal(ranked[0].id, 1);
  assert.equal(ranked[0].lowSample, true);
  assert.equal(rankBuildOptions([[1, NaN, 500]]).length, 0);
});
test('opening combination has its own rate, independent of champion or individual items', () => {
  const { openingRecord } = require('../src/main/ugg');
  const record = openingRecord([1000, 620, [3083, 3084, 3009]]);
  assert.equal(record.winRate, 62);
  assert.equal(record.games, 1000);
  assert.equal(openingRecord([10, 20, []]), null);
});
test('Nasus flex remains unconfirmed before Gnar; final draft resolves Gnar Top and Nasus Mid', () => {
  const raw = fixture('Garen', ['Nasus', 'Bard', 'Kayn', "Kai'Sa"]);
  const state = parseLiveGame(raw, champions);
  state.live = false;
  state.theirTeam.forEach((p) => { p.position = null; });
  const early = inferEnemyRoles(state, champions);
  assert.equal(early.opponent, null);
  assert.match(early.warning, /Nasus.*unconfirmed/);
  state.theirTeam.push({ championId: id('Gnar'), position: null });
  const final = inferEnemyRoles(state, champions);
  assert.equal(final.opponent, 'Gnar');
  assert.equal(final.assigned.Mid, 'Nasus');
});
test('manual or reported Nasus lane resolves the provisional flex warning', () => {
  const state = parseLiveGame(fixture('Garen', ['Nasus']), champions);
  assert.equal(inferEnemyRoles(state, champions).opponent, 'Nasus');
  state.theirTeam[0].position = null;
  state.opponentOverrideId = id('Nasus');
  assert.equal(inferEnemyRoles(state, champions).opponent, 'Nasus');
  assert.equal(inferEnemyRoles(state, champions).warning, null);
});
test('Garen screenshot shows one pair of boots even when baseline and lane disagree', () => {
  const state = parseLiveGame(fixture('Garen', ['Gnar', 'Nasus', 'Bard', 'Kayn', "Kai'Sa"]), champions);
  const baseline = { boots: 3006, core: [{ id: 3047, winRate: 60, games: 1000 }], tier: 'Emerald+', patch: '16_17', games: 1000 };
  const result = itemAdvice(state, champions, data, { opponent: 'Gnar' }, baseline);
  const boots = result.options.filter((it) => data.itemMeta[it.id].boots);
  assert.deepEqual(boots.map((it) => it.id), ['3006']);
  state.me.items = [3047];
  assert.equal(itemAdvice(state, champions, data, { opponent: 'Gnar' }, baseline).options
    .filter((it) => data.itemMeta[it.id].boots).length, 0);
  state.me.items = [1001];
  assert.equal(itemAdvice(state, champions, data, { opponent: 'Gnar' }, baseline).options
    .filter((it) => data.itemMeta[it.id].boots).length, 1);
});
