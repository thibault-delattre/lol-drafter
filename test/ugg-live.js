'use strict';
// Must run under Electron: u.gg sits behind Cloudflare, which rejects Node's TLS
// fingerprint. Run with:  npm run test:stats
const { app } = require('electron');
const assert = require('assert');
const { loadChampions, loadGameData } = require('../src/main/champdata');
const u = require('../src/main/ugg');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); passed++; console.log('  PASS  ' + label); }
  catch (e) { failed++; console.log('  FAIL  ' + label + '\n        ' + e.message); }
}

app.whenReady().then(async () => {
  try {
    const { champions, version } = await loadChampions();
    const byName = {};
    for (const k of Object.keys(champions)) byName[champions[k].name] = parseInt(k, 10);
    const nm = (id) => (champions[id] ? champions[id].name : '#' + id);

    console.log('patch mapping');
    check('ddragon version maps to a u.gg patch key', () =>
      assert.strictEqual(u.patchKey('16.17.1'), '16_17'));
    check('previous patch is derived for fallback', () =>
      assert.strictEqual(u.previousPatch('16_17'), '16_16'));

    console.log('');
    console.log('primary roles');
    const roles = await u.loadPrimaryRoles(version);
    check('primary roles download succeeds', () => assert.ok(roles, 'roles came back null'));
    if (roles) {
      check('covers every live champion', () =>
        assert.ok(Object.keys(roles).length >= Object.keys(champions).length - 2,
          'only ' + Object.keys(roles).length + ' entries'));
      check('Teemo is a toplaner', () => assert.strictEqual(roles[byName.Teemo][0], 'Top'));
      check('Thresh is a support', () => assert.strictEqual(roles[byName.Thresh][0], 'Support'));
      check('Jinx is a bot laner', () => assert.strictEqual(roles[byName.Jinx][0], 'Bot'));
      check('champions too new for the local table are covered', () => {
        for (const n of ['Yunara', 'Zaahen', 'Locke']) {
          assert.ok(roles[byName[n]] && roles[byName[n]].length, n + ' missing');
        }
      });
    }

    console.log('');
    console.log('orientation and rank bucket (the inversion guard)');
    // Two independent anchors. u.gg publishes Gwen 54.68% into K'Sante for top
    // lane at Emerald+, and every top laner knows Teemo beats Vayne. If the wins
    // column is ever read as belonging to the wrong champion, both flip.
    const gwenM = await u.laneMatchups(byName.Gwen, 'Top', version);
    check('the Emerald+ bucket is the one being read', () =>
      assert.strictEqual(gwenM.tier, 'Emerald+'));
    const ksM = await u.laneMatchups(byName["K'Sante"], 'Top', version);
    check('Gwen/K\'Sante reciprocal files agree on current-patch orientation', () => {
      const ks = u.winRateAgainst(gwenM, byName["K'Sante"]);
      assert.ok(ks, 'no sample for the matchup');
      const gwenWr = 100 - ks.winRate;
      const gwen = u.winRateAgainst(ksM, byName.Gwen);
      assert.ok(gwen, 'no reciprocal sample');
      assert.ok(Math.abs(gwenWr - gwen.winRate) < 1,
        'reciprocal win rates disagree; feeds may have different refresh timestamps');
    });
    const teemoM = await u.laneMatchups(byName.Teemo, 'Top', version);
    check('Teemo beats Vayne, not the other way round', () => {
      const v = u.winRateAgainst(teemoM, byName.Vayne);
      assert.ok(v, 'no sample');
      assert.ok(v.winRate < 45, 'Vayne into Teemo should be well under 50%, got ' + v.winRate + '%');
    });
    const malphM = await u.laneMatchups(byName.Malphite, 'Top', version);
    check('Malphite/Vayne empirical orientation guard (armor does not block true damage)', () => {
      const v = u.winRateAgainst(malphM, byName.Vayne);
      assert.ok(v, 'no sample');
      assert.ok(v.winRate < 45, 'Vayne into Malphite should be well under 50%, got ' + v.winRate + '%');
    });

    console.log('');
    console.log('lane matchups');
    const t0 = Date.now();
    const m = await u.laneMatchups(byName.Teemo, 'Top', version);
    const ms = Date.now() - t0;
    check('Teemo top matchups download succeeds', () => assert.ok(m, 'matchups came back null'));
    if (m) {
      check('sample size is large enough to trust', () =>
        assert.ok(m.totalGames > 20000, 'only ' + m.totalGames + ' games'));
      check('covers most of the roster', () => assert.ok(m.against.length > 100));

      const counters = u.rankCounters(m, { limit: 10 });
      check('counters are ordered best first', () => {
        for (let i = 1; i < counters.length; i++) {
          assert.ok(counters[i - 1].confidence >= counters[i].confidence);
        }
      });
      check('counters clear 50% (they actually beat Teemo)', () =>
        assert.ok(counters[0].winRate > 50, 'top counter only ' + counters[0].winRate + '%'));

      const malphite = u.winRateAgainst(m, byName.Malphite);
      check('Malphite has a real recorded win rate vs Teemo', () =>
        assert.ok(malphite && malphite.games > 1500, 'sample ' + (malphite && malphite.games)));

      console.log('');
      console.log('  data as of ' + String(m.asOf).slice(0, 10) + ', ' +
                  m.totalGames.toLocaleString() + ' games, fetched in ' + ms + 'ms');
      console.log('  best counters to Teemo (top):');
      for (const c of counters.slice(0, 6)) {
        console.log('     ' + (nm(c.championId) + '             ').slice(0, 14) +
                    c.winRate + '%  (' + c.games + ' games)');
      }
      console.log('  Malphite into Teemo: ' + malphite.winRate + '% over ' +
                  malphite.games + ' games');

      const t1 = Date.now();
      await u.laneMatchups(byName.Teemo, 'Top', version);
      console.log('  cached re-read: ' + (Date.now() - t1) + 'ms');
    }

    const gameData = await loadGameData();
    const build = await u.championBuild(byName['Dr. Mundo'], 'Top', version, gameData.itemMeta);
    check('Mundo build uses the same Emerald+ population and reports its patch', () => {
      assert.ok(build, 'no current build');
      assert.equal(build.tier, 'Emerald+');
      assert.ok([u.patchKey(version), u.previousPatch(u.patchKey(version))].includes(build.patch));
      assert.ok(build.games > 0 && build.core.length > 0);
      for (const it of build.core) assert.equal(gameData.itemMeta[it.id].purchasable, true);
      console.log('  Mundo baseline:', build.patch, build.games, 'games,', build.core.map((it) => gameData.itemNames[it.id]).join(' -> '));
    });
    console.log('');
    console.log(passed + ' passed, ' + failed + ' failed');
  } catch (err) {
    console.log('HARNESS ERROR: ' + err.message);
    failed++;
  }
  app.exit(failed ? 1 : 0);
});
