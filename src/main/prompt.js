'use strict';
const { assignRoles, lanesFor } = require('./lanes');

const ROLE_ORDER = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];

function nameOf(champions, id) {
  return id && champions[id] ? champions[id].name : null;
}

function describeAllies(state, champions) {
  const lines = [];
  const seen = new Set();
  for (const role of ROLE_ORDER) {
    const p = state.myTeam.find((x) => x.position === role && !seen.has(x.cellId));
    if (!p) continue;
    seen.add(p.cellId);
    const champ = nameOf(champions, p.championId) || nameOf(champions, p.hoveredId);
    const suffix = p.championId ? '' : (champ ? ' (hovering)' : '');
    if (p.isLocal) lines.push(`  ${role}: ME - choosing now`);
    else lines.push(`  ${role}: ${champ ? champ + suffix : 'not picked yet'}`);
  }
  for (const p of state.myTeam) {
    if (seen.has(p.cellId)) continue;
    const champ = nameOf(champions, p.championId) || nameOf(champions, p.hoveredId);
    lines.push(`  ${p.isLocal ? 'ME' : 'Ally'}: ${champ || 'not picked yet'}`);
  }
  return lines.join('\n');
}

/**
 * Riot hides enemy assigned positions, so roles are inferred from champion pools.
 * `lanesLookup` lets the caller supply u.gg's real role data; without it the
 * bundled lane table is used.
 */
function inferEnemyRoles(state, champions, lanesLookup) {
  const picked = state.theirTeam.map((p) => nameOf(champions, p.championId)).filter(Boolean);
  if (!picked.length) return { picked: [], assigned: {}, unplaced: [], opponent: null };

  const lookup = lanesLookup || lanesFor;
  const { assigned, unplaced } = assignRoles(picked, lookup);

  const myRole = state.myPosition;
  let opponent = myRole && assigned[myRole] ? assigned[myRole] : null;
  const likelyOpponent = opponent;
  // A lone Nasus may still be Mid; do not sell a Top counterpick before the flex resolves.
  const flexible = opponent && picked.length < 5 && lanesFor(opponent)
    .some((role) => role !== myRole && !assigned[role]);
  if (flexible) opponent = null;
  // Live data may report positions even though ranked champion select hides them.
  const reported = state.theirTeam.find((p) => p.position === myRole && p.championId);
  if (reported) opponent = nameOf(champions, reported.championId);
  const override = state.theirTeam.find((p) => p.championId === state.opponentOverrideId);
  if (override) opponent = nameOf(champions, override.championId);
  if (!opponent && myRole) {
    // A champion that only ever plays my lane is still my opponent even if the
    // greedy assignment could not seat it.
    const forced = unplaced.find((n) => {
      const l = lookup(n);
      return l.length === 1 && l[0] === myRole;
    });
    if (forced) opponent = forced;
  }
  const uncertain = !opponent && !!flexible;
  return { picked, assigned, unplaced, opponent, likelyOpponent,
    uncertain, warning: uncertain ? `${likelyOpponent} could play another unfilled role. Enemy laner is unconfirmed; avoid committing to a narrow counterpick.` : null };
}

function describeEnemies(state, roles) {
  if (!roles.picked.length) return '  nobody has picked yet';
  const lines = [];
  if (roles.warning) lines.push('  ROLE UNCERTAINTY: ' + roles.warning);
  for (const role of ROLE_ORDER) {
    if (roles.assigned[role]) lines.push(`  ${role}: ${roles.assigned[role]}`);
  }
  if (roles.unplaced.length) lines.push(`  role unclear: ${roles.unplaced.join(', ')}`);
  const missing = 5 - roles.picked.length;
  if (missing > 0) lines.push(`  (${missing} still to pick)`);
  return lines.join('\n');
}

function compLine(t) {
  if (!t.picked) return 'nothing picked yet';
  return `AD ${t.adPct}% / AP ${t.apPct}%, frontline ${t.frontline}, CC ${t.cc}, engage ${t.engage}`;
}

/**
 * The weighting between "win my lane" and "fix my team" shifts with draft
 * position: late picks fill gaps, early picks stay flexible, a known opponent
 * pulls weight toward the matchup.
 */
function priorityBlock(ctx) {
  const lines = [];
  const threats = '3. ENEMY THREATS - how it holds up against their team as a whole in a fight.';

  if (ctx.isLastPick && !ctx.opponent) {
    lines.push('You are the LAST pick on your team. Your composition is otherwise fixed, so this is');
    lines.push('the only remaining chance to cover what it is missing. Weigh:');
    lines.push('1. TEAM COMPOSITION - close the gaps listed above (damage type, frontline, CC, engage).');
    lines.push(ctx.opponent
      ? `2. LANE - your opponent is ${ctx.opponent}; among the champions that fix the comp, avoid one that outright loses this lane.`
      : '2. LANE - your opponent is not revealed; avoid picks that are easy to counter.');
    lines.push(threats);
  } else if (ctx.opponent) {
    lines.push(`Your lane opponent is already known (${ctx.opponent}). Lane is the primary goal.`);
    lines.push(ctx.isLastPick ? 'You are last pick: use team balance to choose among viable lane answers.'
      : `${ctx.alliesAfter} allies can still adjust the composition. Weigh:`);
    lines.push(`1. LANE - beating ${ctx.opponent} is the priority. Say concretely why the matchup is`);
    lines.push('   good: range, all-in power, wave control, how the enemy wins if they do.');
    lines.push('2. TEAM COMPOSITION - among the champions that beat the lane, prefer the one that also');
    lines.push('   covers a gap above.');
    lines.push(threats);
  } else {
    lines.push(`Your lane opponent is not revealed yet and ${ctx.alliesAfter} ally pick(s) follow yours. Weigh:`);
    lines.push('1. SAFETY - prefer champions that are hard to hard-counter, since the enemy picks after');
    lines.push('   you and can respond to this choice.');
    lines.push('2. TEAM COMPOSITION - cover a gap above without locking the comp into one damage type.');
    lines.push(threats);
  }
  return lines.join('\n');
}

function damageConstraint(ally, picksLeft) {
  if (ally.picked < 3 || picksLeft > 2) return null;
  const heavy = ally.adPct >= 75 ? 'AD' : (ally.adPct <= 25 ? 'AP' : null);
  if (!heavy) return null;
  const missing = heavy === 'AD' ? 'AP (magic)' : 'AD (physical)';
  const pct = heavy === 'AD' ? ally.adPct : ally.apPct;

  return `HARD CONSTRAINT - DAMAGE BALANCE
Your team is already ${pct}% ${heavy} damage. One defensive item makes that whole comp useless.
Recommend champions that add ${missing} damage. You may recommend another ${heavy} champion ONLY if it
is a decisive answer to your lane opponent that no ${missing} champion provides - and if you do, the
"risk" field must say plainly that it worsens the damage imbalance.`;
}

/**
 * Measured win rates beat plausible-sounding theory: without this the model will
 * happily justify a matchup that the data says is losing.
 */
function statsBlock(stats, role) {
  if (!stats || !stats.counters || !stats.counters.length) return null;
  const fmt = (m) => `${m.name} ${m.winRate}% (${m.games.toLocaleString()} games)`;
  const subject = stats.opponent;
  const asOf = stats.asOf ? `, as of ${String(stats.asOf).slice(0, 10)}` : '';
  const lines = [];
  lines.push(`DATA SCOPE: ${stats.tier || 'rank unspecified'}, patch ${stats.patch || 'unknown'}${stats.fallback ? ' (previous patch)' : ''}.`);
  lines.push('These are GAME win rates, not lane win rates or gold-at-15. Do not claim they prove lane dominance.');
  lines.push('Rates are not normalized matchup deltas; champion strength and sample noise also affect them.');

  // Ban mode inverts the question: the subject is the champion YOU intend to
  // play, so the same "who beats the subject" list becomes the ban shortlist.
  if (stats.mode === 'ban') {
    lines.push(`MEASURED THREATS TO ${subject.toUpperCase()} IN ${role.toUpperCase()} - u.gg, ${stats.totalGames.toLocaleString()} ranked games${asOf}`);
    lines.push(`You are hovering ${subject}. A hover is a comfort pick, NOT a commitment - you may still`);
    lines.push(`pick something else - so treat this as one signal, not the whole answer. Numbers are each`);
    lines.push(`champion's win rate against ${subject}: above 50% means it beats ${subject}, below 50% means`);
    lines.push(`${subject} beats it. Never describe a sub-50% champion as winning the lane.`);
    lines.push('Already filtered to champions still bannable:');
    lines.push('');
    lines.push('BEATS ' + subject.toUpperCase() + ':');
    lines.push('  ' + stats.counters.map(fmt).join('\n  '));
    if (stats.losers && stats.losers.length) {
      lines.push('');
      lines.push('LOSES TO ' + subject.toUpperCase() + ` (a ban here wastes a lane you already win):`);
      lines.push('  ' + stats.losers.map(fmt).join('\n  '));
    }
    return lines.join('\n');
  }

  lines.push(`MEASURED ${role.toUpperCase()} MATCHUP DATA vs ${subject} - u.gg, ${stats.totalGames.toLocaleString()} ranked games${asOf}`);
  lines.push(`These are real win rates of each champion INTO ${subject}, already filtered to champions`);
  lines.push('you can still pick. 50% is even; higher means that champion beats them.');
  lines.push('');
  lines.push('BEATS ' + subject.toUpperCase() + ':');
  lines.push('  ' + stats.counters.map(fmt).join('\n  '));
  if (stats.losers && stats.losers.length) {
    lines.push('');
    lines.push('LOSES TO ' + subject.toUpperCase() + ' (do not claim these beat the lane):');
    lines.push('  ' + stats.losers.map(fmt).join('\n  '));
  }
  lines.push('');
  lines.push('Prefer champions from the winning list. Statistics outrank intuition here: if you recommend');
  lines.push('a champion that is not winning the matchup, the "lane" field must say the data is against it');
  lines.push('and give a concrete reason it is still right.');
  return lines.join('\n');
}

/**
 * A ban is not only a lane decision. A champion can deserve the ban despite
 * losing your lane if its kit dismantles your composition in a fight - and the
 * reverse trap, banning something you already beat, is easy to fall into.
 */
function banWeighting(stats, role, allyChampions) {
  const lines = [];
  const carries = allyChampions && allyChampions.length
    ? ` Your side already has ${allyChampions.join(', ')}.` : '';

  lines.push('Weigh three separate things and say which one drove your choice:');
  lines.push(stats
    ? '1. LANE THREAT - the champions listed above measurably beat the champion being hovered. That'
    : `1. LANE THREAT - what is hardest to play against in ${role}.`);
  if (stats) {
    lines.push('   hover is only a comfort pick, so do not over-weight it: a champion that beats the whole');
    lines.push(`   ${role} pool matters more than one that only beats that single champion.`);
  }
  lines.push('2. TEAMFIGHT THREAT - a champion can deserve the ban even when it LOSES your lane, if its');
  lines.push('   kit dismantles your composition in a fight: AoE burst or long-range engage into squishy,');
  lines.push('   immobile carries, hard disengage against your engage, and so on.' + carries);
  lines.push('   Name which of your champions it punishes.');
  lines.push('3. GENERAL STRENGTH - do not spend a ban on a champion nobody picks.');
  lines.push('');
  lines.push('If a champion is a serious teamfight threat but loses your lane, say both plainly and then');
  lines.push('make the call - do not pretend it also wins the lane.');
  return lines.join('\n');
}

/**
 * Build advice, asked once your champion is locked. The statistical build is the
 * average game; the job here is to bend it toward THIS enemy composition, which
 * is the part no static build page can do.
 */
function buildBuildPrompt(state, analysis, champions, gameData, build, opts) {
  const o = opts || {};
  const me = state.me && state.me.championId ? champions[state.me.championId] : null;
  if (!me || !build) return null;

  const item = (id) => (gameData.itemNames[id] || '#' + id);
  const spell = (id) => (gameData.spellNames[id] || '#' + id);
  const rune = (id) => (gameData.runeNames[id] || '#' + id);

  const enemyLine = state.theirTeam
    .map((p) => (p.championId && champions[p.championId] ? champions[p.championId] : null))
    .filter(Boolean)
    .map((c) => {
      const a = require('./attributes').attributesFor(c);
      const role = o.enemyRoles && Object.keys(o.enemyRoles.assigned || {})
        .find((r) => o.enemyRoles.assigned[r] === c.name);
      return `${c.name} (${a.damage}${role ? ', ' + role.toLowerCase() : ''})`;
    })
    .join(', ') || 'nobody has locked in yet';

  const allyLine = state.myTeam
    .filter((p) => !p.isLocal && p.championId && champions[p.championId])
    .map((p) => champions[p.championId].name)
    .join(', ') || 'nobody else locked yet';

  const lines = [];
  lines.push(`STATISTICAL BASELINE for ${me.name} ${state.myPosition || ''} - u.gg ${build.tier || 'rank unknown'}, patch ${build.patch || 'unknown'}${build.fallback ? ' (previous patch fallback)' : ''}, ${build.games.toLocaleString()} games, ${build.winRate}% win rate`);
  if (build.spells.length) lines.push('  Summoners : ' + build.spells.map(spell).join(' + '));
  if (build.starting.length) lines.push('  Start     : ' + build.starting.map(item).join(', '));
  if (build.boots) lines.push('  Boots     : ' + item(build.boots));
  if (build.opening) lines.push(`  Opening combination: ${build.opening.items.map(item).join(' + ')}: ${build.opening.winRate}% over ${build.opening.games} games${build.opening.lowSample ? ' (LOW SAMPLE)' : ''}. This rate belongs to the combination, not the entire six-item build.`);
  for (const slot of build.alternatives || []) lines.push(`  Later purchase slot ${slot.slot} alternatives: ` +
    slot.options.map((it) => `${item(it.id)}: ${it.winRate}% / ${it.games} games / confidence floor ${it.confidence.toFixed(1)}%${it.lowSample ? ' LOW SAMPLE; popularity fallback' : ''}`).join('; '));
  if (build.core.length) {
    lines.push('  Core      : ' + build.core.map((c) => `${item(c.id)} (${c.winRate == null ? 'opening path; no standalone item win rate' : c.winRate + '%'})`).join(' -> '));
  }
  if (build.skillOrder) lines.push('  Skills    : ' + build.skillOrder.split('').join(' > '));
  if (build.runes && build.runes.perks && build.runes.perks.length) {
    lines.push('  Runes     : ' + build.runes.perks.map(rune).join(', '));
  }

  return `You are an expert League of Legends coach. Patch ${o.patch || 'current'}, Summoner's Rift ranked.

I have LOCKED IN ${me.name} ${state.myPosition || ''}. The draft is decided - do not suggest a different champion.
LANE PRIORITY: ${o.enemyRoles && o.enemyRoles.opponent || 'unknown opponent (do not invent one)'}. Early recalls and first core should solve this matchup before later teamfight adaptations.
${o.enemyRoles && o.enemyRoles.warning || ''}
Recommend exactly ONE pair of boots. Never put another pair in core or situational purchases.

ENEMY TEAM: ${enemyLine}
ENEMY DAMAGE: ${compLine(analysis.enemy)}
${analysis.enemy.gaps.length ? 'ENEMY WEAKNESSES: ' + analysis.enemy.gaps.join('; ') : ''}
${analysis.enemy.strengths.length ? 'ENEMY STRENGTHS: ' + analysis.enemy.strengths.join('; ') : ''}

MY TEAM: ${allyLine}
MY TEAM DAMAGE: ${compLine(analysis.ally)}

${lines.join('\n')}

That baseline is the average game across every opponent. Tune it to beat THIS enemy team.
Build win rates are observational and affected by purchase timing and winning-game bias; they do not prove an optimal build.
Use the supplied win rates AND sample sizes when selecting items: prefer stronger supported results
within the SAME purchase slot, then adapt for lane, champion synergy and observed enemy threats.
Explain a matchup-based deviation from the statistical leader. Never compare a late-item rate
against an opening-item rate, or call the champion overall win rate a build win rate.
Composition AD/AP percentages are rough champion archetypes, not measured damage; account separately for true damage.
Vayne has physical attacks AND max-health true damage. Armor/Steelcaps do not reduce Silver Bolts.
For Vayne, preserve Berserker's Greaves as the default attack-speed power spike. Do not switch
to Steelcaps solely because her laner deals physical damage, especially against a mixed/AP-heavy team.
Defensive boots are conditional alternatives with an explicit lost-damage tradeoff; MR boots do not reduce knockups.
A small lifesteal component on a non-healing champion does not justify rushing wounds ahead of your core.
Randuin's answers critical strikes, not all physical damage or on-hit/true damage. During draft, crit purchases are only conditional.
Bramble/Thornmail anti-heal requires the enemy to attack you; it is unreliable against Vladimir's spell healing.
Apply anti-heal with damage appropriate to your champion, and do not duplicate completed wounds items.
Do not recommend mana efficiency to a manaless champion. Tenacity does not reduce knockups or suppression.
CURRENT INVENTORIES (${state.live ? 'observed' : 'unknown; do not invent purchases'}): ${JSON.stringify(
    [...state.myTeam, ...state.theirTeam].map((p) => ({ champion: nameOf(champions, p.championId),
      mine: p.isLocal, items: (p.items || []).map(item), level: p.level, scores: p.scores })))}
Prioritize actual offensive purchases over champion AD/AP stereotypes. Weight enemy item investment,
level, kills, assists and farm when judging the biggest threat; enemy exact gold and damage dealt are unknown.
Preserve the carry's damage engine. Enemy armor alone does not justify armor penetration on Vayne:
Silver Bolts bypass armor, so assess attack-speed/on-hit synergy first. Tank resistances should answer
the strongest observed threats, with extra lane weight early. Never recommend selling completed core
items just because the estimated damage mix changed.
Only use these CURRENT PURCHASABLE SUMMONER'S RIFT ITEMS:
${Object.entries(gameData.itemMeta || {}).filter(([, m]) => m.purchasable === true).map(([id]) => item(id)).join(', ')}
AUTHORITATIVE CURRENT ITEM EFFECTS (do not invent effects or confuse crit with on-hit):
${[...new Set([...(build.core || []).map((it) => it.id), build.boots, 3143, 3047, 3111, 3076,
    3075, 3916, 3123, 3165, 3033, 3139, 3157, 3156, 3065, 3110, 3082].filter(Boolean))]
    .map((id) => `${item(id)}: ${gameData.itemMeta[id] && gameData.itemMeta[id].description || 'effect unavailable; do not invent it'}`).join('\n')}
Think about, only where it actually applies:
- armour versus magic resist, given their ${analysis.enemy.adPct}% AD / ${analysis.enemy.apPct}% AP split
- boots: armour, magic resist or tenacity, depending on what actually kills you
- grievous wounds if anyone on their side heals meaningfully
- percent-health damage if they stack health, lethality/penetration if they are squishy
- Zhonya's, Banshee's, Quicksilver or Mercurial against their specific burst or lockdown

Respond with ONLY a JSON object. No markdown fence, no prose. Keep every string under 110 characters.
{"summary":"one sentence: what this enemy team does to you and what the build must answer",
 "boots":{"item":"Name","why":"reason"},
 "core":[{"item":"Name","keep":true,"why":"why it stays or what replaces it"}],
 "situational":[{"item":"Name","insteadOf":"Name or null","why":"when and why to buy it"}]}
Exactly 3 entries in "core" (in build order), 2 or 3 in "situational". Use exact in-game item names.`;
}

function buildPrompt(state, analysis, champions, opts) {
  const o = opts || {};
  const role = state.myPosition || 'my role';
  const action = state.myActionType === 'ban' ? 'ban' : 'pick';

  const banned = [...state.allyBans, ...state.enemyBans].map((id) => nameOf(champions, id)).filter(Boolean);
  const taken = [];
  for (const p of [...state.myTeam, ...state.theirTeam]) {
    if (p.isLocal) continue;
    const n = nameOf(champions, p.championId) || nameOf(champions, p.hoveredId);
    if (n) taken.push(n);
  }

  const roles = o.enemyRoles || inferEnemyRoles(state, champions, o.lanesLookup);
  const alliesAfter = state.myTeam.filter((p) => !p.isLocal && !p.championId).length;
  const isLastPick = alliesAfter === 0;
  const picksLeft = alliesAfter + 1;

  const position = isLastPick
    ? 'you are your team\'s LAST pick'
    : `${alliesAfter} ally pick(s) still come after yours`;

  const task = action === 'ban'
    ? `Recommend the 3 best champions to BAN: what most threatens your team, and what is strongest against ${role}.`
    : `Recommend the 3 best champions for me to PICK as ${role}.`;

  const constraint = action === 'pick' ? damageConstraint(analysis.ally, picksLeft) : null;
  const stats = statsBlock(o.stats, role);

  // A ban is a threat assessment, so the three fields mean different things there.
  const fieldDocs = action === 'ban'
    ? {
      lane: '"how it beats what you intend to play, with the number"',
      fit: '"which of your champions it punishes in a teamfight, and how"',
      risk: '"why this ban might be the wrong call"',
    }
    : {
      lane: '"how the lane goes"',
      fit: '"what it adds to the comp"',
      risk: '"main downside"',
    };

  const allyChampions = state.myTeam
    .filter((p) => !p.isLocal)
    .map((p) => nameOf(champions, p.championId))
    .filter(Boolean);

  const weighting = action === 'pick'
    ? priorityBlock({ opponent: roles.opponent, isLastPick, alliesAfter })
    : banWeighting(o.stats, role, allyChampions);

  return `You are an expert League of Legends draft coach. Patch ${o.patch || 'current'}, 5v5 Summoner's Rift ranked draft.

MY ROLE: ${role}
MY ACTION NOW: ${action.toUpperCase()}
DRAFT POSITION: ${position}

MY TEAM:
${describeAllies(state, champions)}

ENEMY TEAM (Riot hides their assigned roles - the roles below are INFERRED, so correct them if a
champion is obviously played elsewhere):
${describeEnemies(state, roles)}

YOUR LIKELY LANE OPPONENT: ${roles.opponent || 'not revealed yet'}

BANNED - MUST NOT BE SUGGESTED (${banned.length}): ${banned.join(', ') || 'none'}
ALREADY TAKEN - MUST NOT BE SUGGESTED (${taken.length}): ${taken.join(', ') || 'none'}

MY COMP SO FAR: ${compLine(analysis.ally)}
${analysis.ally.gaps.length ? 'MY GAPS: ' + analysis.ally.gaps.join('; ') : ''}
ENEMY COMP SO FAR: ${compLine(analysis.enemy)}
${analysis.enemy.gaps.length ? 'ENEMY GAPS: ' + analysis.enemy.gaps.join('; ') : ''}
${stats ? '\n' + stats + '\n' : ''}
HOW TO WEIGH THIS ${action.toUpperCase()}:
${weighting}
${constraint ? '\n' + constraint + '\n' : ''}
${task}

Respond with ONLY a JSON object. No markdown fence, no commentary. Keep every string under 110 characters.
{"read":"one-sentence read of the draft","picks":[{"champ":"Name","score":0-100,"lane":${fieldDocs.lane},"fit":${fieldDocs.fit},"risk":${fieldDocs.risk}}],"avoid":[{"champ":"Name","why":"reason"}]}
Exactly 3 entries in "picks", 1 or 2 in "avoid". Use exact in-game champion names.`;
}

module.exports = {
  buildPrompt, buildBuildPrompt, inferEnemyRoles, describeEnemies, damageConstraint, priorityBlock, statsBlock,
  banWeighting,
};
