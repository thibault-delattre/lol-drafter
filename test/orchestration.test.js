'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const filename = path.resolve(__dirname, '../src/main/main.js');
const realRequire = createRequire(filename);
const flush = () => new Promise((r) => setImmediate(r));
function harness() {
  const handlers = {};
  const events = [];
  let calls = 0;
  let resolve;
  let liveFeed = null;
  const analyzer = { cancel() {}, run() { calls++; return new Promise((r) => { resolve = r; }); } };
  const sandbox = { require: (name) => name === 'electron' ? {
    app: { whenReady: () => ({ then() {} }), on() {} },
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }
  } : name === './live' ? { ...realRequire(name), readLiveGame: async () => liveFeed }
    : realRequire(name), __dirname: path.dirname(filename), process: { env: {} },
  console, setTimeout, clearTimeout, setInterval, clearInterval, module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(filename, 'utf8') + `
module.exports = { startAi, preemptAi, tick, shapeBuild,
  setup(c, g, a, s, analysis, emit) {
    champions=c; gameData=g; analyzer=a; lastState=s; lastAnalysis=analysis;
    send=emit; patch='16.17.1'; gatherStats=async()=>null;
    ugg.championBuild=async()=>null;
  }, busy:()=>aiBusy, pending:()=>pendingRun, runId:()=>aiRunId,
  stats(fn) { gatherStats=fn; }, phase(p) { lcu={getPhase:async()=>p}; },
  reset() { clearTimeout(aiTimer); }
};`, sandbox, { filename });
  const api = sandbox.module.exports;
  const { champions } = require('../src/data/champions.cache.json');
  const gameData = require('../src/data/gamedata.cache.json');
  const { parseSession } = require('../src/main/draft');
  const { analyzeDraft } = require('../src/main/analyze');
  const state = parseSession(require('./fixture').buildSession((n) => Object.values(champions).find((c) => c.name === n).id));
  const analysis = analyzeDraft(state, champions);
  api.setup(champions, gameData, analyzer, state, analysis, (channel, data) => events.push({ channel, data }));
  return { api, state, analysis, handlers, events, calls: () => calls, resolve: (v) => resolve(v),
    resolver: () => resolve, feed: (value) => { liveFeed = value; } };
}
test('refresh queues one latest analysis and never starts a concurrent model', async () => {
  const h = harness();
  h.api.startAi(h.state, h.analysis);
  await flush();
  h.handlers.refresh(); h.handlers.refresh();
  assert.equal(h.calls(), 1);
  assert.ok(h.api.pending());
  h.resolve('{"picks":[]}'); await flush();
  assert.equal(h.calls(), 2);
  h.resolve('{"picks":[]}'); await flush();
  assert.equal(h.api.busy(), false);
});
test('preempted statistics fetch cannot start an obsolete model call', async () => {
  const h = harness();
  let release;
  h.api.stats(() => new Promise((r) => { release = r; }));
  h.api.startAi(h.state, h.analysis);
  h.api.preemptAi(); release(null); await flush();
  assert.equal(h.calls(), 0);
  assert.equal(h.api.busy(), false);
});
test('locked champion stays in build mode when u.gg is unavailable', async () => {
  const h = harness();
  h.state.me.championId = 61;
  h.api.startAi(h.state, h.analysis); await flush();
  assert.equal(h.calls(), 0);
  assert.ok(h.events.some((e) => e.channel === 'ai' && e.data.mode === 'build'));
  assert.ok(h.events.some((e) => e.channel === 'items' && e.data));
  assert.equal(h.api.busy(), false);
});
test('AI item resolution rejects removed, alternate-mode, and malformed entries', () => {
  const h = harness();
  const result = h.api.shapeBuild({ core: [{ item: "Randuin's Omen" }, { item: 'Imaginary Item' }, null] },
    { spells: [], starting: [], core: [] });
  assert.equal(result.core.length, 1);
  assert.equal(result.core[0].id, '3143');
});
test('AI cannot emit extra boots through core or situational lists', () => {
  const h = harness();
  const raw = { boots: { item: "Berserker's Greaves" },
    core: [{ item: 'Plated Steelcaps' }, { item: "Randuin's Omen" }],
    situational: [{ item: "Mercury's Treads" }] };
  const baseline = { spells: [], starting: [], core: [] };
  const result = h.api.shapeBuild(raw, baseline);
  assert.equal(result.boots.id, '3006');
  assert.equal(result.core.length, 1);
  assert.equal(result.situational.length, 0);
  h.state.me.items = [3047];
  assert.equal(h.api.shapeBuild(raw, baseline).boots, null);
});
test('game end invalidates old results and their finalizers cannot release a new run', async () => {
  const h = harness();
  h.api.startAi(h.state, h.analysis); await flush();
  const oldResolve = h.resolver();
  // Save the pending promise's resolver before the next run replaces it.
  h.api.phase('Lobby');
  await h.api.tick();
  assert.equal(h.api.busy(), false);
  assert.ok(h.events.some((e) => e.channel === 'state' && e.data.status === 'waiting'));
  h.api.startAi(h.state, h.analysis); await flush();
  oldResolve('{"picks":[]}'); await flush();
  assert.ok(!h.events.some((e) => e.channel === 'ai' && e.data.status === 'done'));
  assert.equal(h.api.busy(), true);
  h.resolve('{"picks":[]}'); await flush();
  assert.equal(h.api.busy(), false);
});
test('live-game polling works independently of the launcher and updates inventories', async () => {
  const h = harness();
  h.api.phase('Lobby');
  const raw = { activePlayer: { riotId: 'Local#EUW' }, allPlayers: [
    { riotId: 'Local#EUW', championName: 'Dr. Mundo', team: 'ORDER', position: 'TOP', items: [] },
    { championName: 'Vayne', team: 'CHAOS', position: 'TOP', items: [] }
  ] };
  h.feed(raw);
  await h.api.tick();
  assert.ok(h.events.some((e) => e.channel === 'state' && e.data.status === 'live'));
  raw.allPlayers[1].items.push({ itemID: 3031 });
  await h.api.tick();
  const itemEvents = h.events.filter((e) => e.channel === 'items');
  assert.ok(itemEvents.at(-1).data.options.some((it) => it.id === '3143'));
  h.feed(null); await h.api.tick();
  assert.equal(h.events.filter((e) => e.channel === 'items').at(-1).data, null);
  h.api.reset();
});
