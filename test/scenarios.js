'use strict';
// Draft-position weighting plus real u.gg matchup data.
// Run under Electron so the stats fetch works:  npm run test:draft [-- --live]
const { loadChampions } = require('../src/main/champdata');
const { parseSession } = require('../src/main/draft');
const { analyzeDraft } = require('../src/main/analyze');
const { buildPrompt, inferEnemyRoles } = require('../src/main/prompt');
const { lanesFor } = require('../src/main/lanes');
const { Analyzer, extractJson, validate } = require('../src/main/ai');
const ugg = require('../src/main/ugg');

const LIVE = process.argv.includes('--live');

function boot(main) {
  if (process.versions.electron) {
    const { app } = require('electron');
    app.whenReady().then(() => main().then(
      () => app.exit(0),
      (e) => { console.error('FAIL:', e.message); app.exit(1); }));
  } else {
    console.log('(running under plain Node - u.gg is Cloudflare-blocked here, stats will be absent)\n');
    main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
  }
}

function session(id, { allies, enemies, bans }) {
  const roles = ['top', 'jungle', 'middle', 'bottom', 'utility'];
  return {
    localPlayerCellId: 0,
    timer: { adjustedTimeLeftInPhase: 27000, phase: 'BAN_PICK' },
    bans: { myTeamBans: (bans || []).map(id), theirTeamBans: [] },
    myTeam: roles.map((pos, i) => ({
      cellId: i, assignedPosition: pos,
      championId: allies[i] ? id(allies[i]) : 0, championPickIntent: 0,
    })),
    theirTeam: [0, 1, 2, 3, 4].map((i) => ({
      cellId: 5 + i, assignedPosition: '',
      championId: enemies[i] ? id(enemies[i]) : 0, championPickIntent: 0,
    })),
    actions: [[{ actorCellId: 0, championId: 0, completed: false, type: 'pick', isAllyAction: true, isInProgress: true }]],
  };
}

boot(async () => {
  const { champions, version } = await loadChampions();
  const byName = {};
  for (const k of Object.keys(champions)) byName[champions[k].name] = parseInt(k, 10);
  const id = (n) => {
    if (!byName[n]) throw new Error('unknown champion: ' + n);
    return byName[n];
  };

  const uggRoles = await ugg.loadPrimaryRoles(version);
  console.log('u.gg primary roles: ' + (uggRoles ? Object.keys(uggRoles).length + ' champions' : 'UNAVAILABLE'));
  const lanesLookup = (name) => {
    const r = uggRoles && uggRoles[byName[name]];
    return r && r.length ? r : lanesFor(name);
  };

  const cases = [
    {
      title: 'A. Top vs a known Teemo, 2 allies still to pick',
      spec: { allies: [null, null, null, 'Jinx', 'Thresh'], enemies: ['Teemo', 'Lee Sin'], bans: ['Fiora', 'Jax'] },
    },
    {
      title: 'B. Top, LAST pick, whole team is AD',
      spec: { allies: [null, "Kha'Zix", 'Zed', 'Twitch', 'Pyke'], enemies: ['Teemo', 'Lee Sin', 'Orianna', 'Caitlyn'], bans: ['Malphite'] },
    },
  ];

  for (const c of cases) {
    const state = parseSession(session(id, c.spec));
    const analysis = analyzeDraft(state, champions);
    const roles = inferEnemyRoles(state, champions, lanesLookup);
    const stats = await ugg.buildLaneStats({
      opponentId: byName[roles.opponent],
      opponentName: roles.opponent,
      role: state.myPosition,
      patch: version,
      champions,
      unavailable: state.unavailable,
    });
    const prompt = buildPrompt(state, analysis, champions, {
      patch: version, stats, enemyRoles: roles, lanesLookup,
    });

    console.log('\n' + '='.repeat(76));
    console.log(c.title);
    console.log('='.repeat(76));
    console.log('opponent : ' + roles.opponent);
    console.log('my comp  : ' + prompt.match(/MY COMP SO FAR: .*/)[0].replace('MY COMP SO FAR: ', ''));

    if (stats) {
      console.log('stats    : ' + stats.totalGames.toLocaleString() + ' games, as of ' +
                  String(stats.asOf).slice(0, 10));
      console.log('  beats ' + stats.opponent + ': ' +
        stats.counters.slice(0, 6).map((m) => `${m.name} ${m.winRate}%`).join(', '));
      console.log('  loses to ' + stats.opponent + ': ' +
        stats.losers.slice(0, 4).map((m) => `${m.name} ${m.winRate}%`).join(', '));
    } else {
      console.log('stats    : none');
    }

    const hard = prompt.match(/HARD CONSTRAINT[\s\S]*?imbalance\./);
    console.log('constraint: ' + (hard ? 'AP required (team is all-AD)' : 'none'));

    if (LIVE) {
      console.log('\n--- live Claude call ---');
      const raw = await new Analyzer({ model: 'sonnet' }).run(prompt, {});
      const result = validate(extractJson(raw), state, champions);
      console.log('READ: ' + result.read);
      for (const p of result.picks) {
        const wr = stats && ugg.winRateAgainst(stats.matchups, p.championId);
        const dmg = require('../src/main/attributes').attributesFor(champions[p.championId]).damage;
        console.log(`  ${p.champ} (${p.score}) [${dmg}]` +
          (wr && wr.games >= 300 ? `  -> measured ${wr.winRate}% vs ${roles.opponent} (${wr.games} games)` : ''));
        console.log(`     lane: ${p.lane}`);
      }
    }
  }
});
