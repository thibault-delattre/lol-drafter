// Champion locked: how should I build to beat THIS enemy team?
const { app } = require('electron');
const { loadChampions, loadGameData } = require('../src/main/champdata');
const { parseSession } = require('../src/main/draft');
const { analyzeDraft } = require('../src/main/analyze');
const { buildBuildPrompt, inferEnemyRoles } = require('../src/main/prompt');
const { lanesFor } = require('../src/main/lanes');
const { Analyzer, extractJson } = require('../src/main/ai');
const ugg = require('../src/main/ugg');

app.whenReady().then(async () => {
  const { champions, version } = await loadChampions();
  const gd = await loadGameData();
  const byName = {};
  for (const k of Object.keys(champions)) byName[champions[k].name] = parseInt(k, 10);
  const uggRoles = await ugg.loadPrimaryRoles(version);
  const lookup = (n) => { const r = uggRoles && uggRoles[byName[n]]; return r && r.length ? r : lanesFor(n); };

  // Your second screenshot's draft, with Vayne actually locked in.
  const allies = ['Vayne', "Bel'Veth", 'Azir', 'Jinx', 'Nautilus'];
  const enemies = ['Rakan', 'Miss Fortune', 'Vex', 'Sylas', 'Ambessa'];
  const session = {
    localPlayerCellId: 0,
    timer: { adjustedTimeLeftInPhase: 20000, phase: 'BAN_PICK' },
    bans: { myTeamBans: [], theirTeamBans: [] },
    myTeam: ['top', 'jungle', 'middle', 'bottom', 'utility'].map((pos, i) => ({
      cellId: i, assignedPosition: pos, championId: byName[allies[i]], championPickIntent: 0,
    })),
    theirTeam: enemies.map((n, i) => ({ cellId: 5 + i, assignedPosition: '', championId: byName[n], championPickIntent: 0 })),
    actions: [[]],
  };

  const state = parseSession(session);
  const analysis = analyzeDraft(state, champions);
  const roles = inferEnemyRoles(state, champions, lookup);
  const build = await ugg.championBuild(state.me.championId, state.myPosition, version, gd.itemMeta);

  console.log('locked        : ' + champions[state.me.championId].name + ' ' + state.myPosition);
  console.log('enemy team    : ' + enemies.join(', '));
  console.log('enemy damage  : ' + analysis.enemy.adPct + '% AD / ' + analysis.enemy.apPct + '% AP');
  console.log('u.gg baseline : ' + build.core.map((c) => gd.itemNames[c.id]).join(' -> ') +
              '  | boots ' + gd.itemNames[build.boots]);

  const prompt = buildBuildPrompt(state, analysis, champions, gd, build, { patch: version, enemyRoles: roles });
  console.log('\n--- live Claude call ---');
  const raw = await new Analyzer({ model: 'sonnet' }).run(prompt, {});
  const p = extractJson(raw);
  if (!p) { console.log('no JSON'); app.exit(1); return; }
  console.log('SUMMARY: ' + p.summary);
  console.log('\nCORE:');
  (p.core || []).forEach((c, i) => console.log('  ' + (i + 1) + '. ' + c.item + ' - ' + c.why));
  if (p.boots) console.log('\nBOOTS: ' + p.boots.item + ' - ' + p.boots.why);
  console.log('\nSITUATIONAL:');
  (p.situational || []).forEach((sIt) => console.log('  ' + sIt.item +
    (sIt.insteadOf ? ' (instead of ' + sIt.insteadOf + ')' : '') + ' - ' + sIt.why));
  app.exit(0);
});
