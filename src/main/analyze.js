'use strict';
const { attributesFor } = require('./attributes');

/**
 * Scores a partial or complete team composition.
 * `champs` is the list of champion records already locked or hovered on that team.
 */
function analyzeTeam(champs) {
  let ad = 0, ap = 0, frontline = 0, cc = 0, engage = 0;

  for (const c of champs) {
    const a = attributesFor(c);
    if (a.damage === 'AD') ad += 1;
    else if (a.damage === 'AP') ap += 1;
    else if (a.damage === 'MIXED') { ad += 0.5; ap += 0.5; }
    frontline += a.frontline;
    cc += a.cc;
    engage += a.engage;
  }

  const dmgTotal = ad + ap;
  const adPct = dmgTotal ? Math.round((ad / dmgTotal) * 100) : 50;

  return {
    picked: champs.length,
    ad, ap,
    adPct,
    apPct: 100 - adPct,
    frontline,
    cc,
    engage,
  };
}

// Turns raw totals into the short warnings shown in the UI and handed to the AI.
function findGaps(t) {
  const gaps = [];
  const strengths = [];
  if (!t.picked) return { gaps, strengths };

  const remaining = 5 - t.picked;

  if (t.frontline === 0 && t.picked >= 2) gaps.push('No frontline at all - nothing absorbs damage');
  else if (t.frontline <= 1 && t.picked >= 3) gaps.push('Very little frontline');
  else if (t.frontline >= 4) strengths.push('Strong frontline');

  if (t.picked >= 2) {
    if (t.adPct >= 85) gaps.push(`Damage is ${t.adPct}% AD - enemy just builds armor`);
    else if (t.adPct <= 15) gaps.push(`Damage is ${t.apPct}% AP - enemy just builds MR`);
    else if (t.adPct >= 40 && t.adPct <= 60) strengths.push('Well-balanced AD/AP damage');
  }

  if (t.cc <= 2 && t.picked >= 3) gaps.push('Low crowd control');
  else if (t.cc >= 9) strengths.push('Heavy crowd control');

  if (t.engage === 0 && t.picked >= 3) gaps.push('No hard engage - hard to start fights');
  else if (t.engage >= 2) strengths.push('Multiple engage tools');

  if (remaining > 0) gaps.forEach((g, i) => { gaps[i] = g; });
  return { gaps, strengths };
}

// Champions on a team, resolved from ids, counting hovers as intent.
function teamChampions(team, champions) {
  const out = [];
  for (const p of team) {
    const id = p.championId || p.hoveredId;
    if (id && champions[id]) out.push(champions[id]);
  }
  return out;
}

function analyzeDraft(state, champions) {
  const allyChamps = teamChampions(state.myTeam, champions);
  const enemyChamps = teamChampions(state.theirTeam, champions);

  const ally = analyzeTeam(allyChamps);
  const enemy = analyzeTeam(enemyChamps);
  const allyFlags = findGaps(ally);
  const enemyFlags = findGaps(enemy);

  return {
    ally: { ...ally, ...allyFlags, champions: allyChamps.map((c) => c.name) },
    enemy: { ...enemy, ...enemyFlags, champions: enemyChamps.map((c) => c.name) },
  };
}

module.exports = { analyzeTeam, findGaps, analyzeDraft, teamChampions };
