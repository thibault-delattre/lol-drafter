'use strict';
const { attributesFor } = require('./attributes');
const POOLS = {
  Top: [
    ['Gragas', 'Sustain and disengage for an unknown lane; adds magic damage.', 'Mana and cooldown management; can still be counterpicked.'],
    ['Ornn', 'Durable scaling frontline and engage; can adapt resistances.', 'Early ranged pressure; not a guaranteed lane win.'],
    ['Gnar', 'Range and mobility to manage uncertain melee matchups.', 'Manage rage; vulnerable to coordinated dives.'],
    ['Renekton', 'Early wave control and trading strength.', 'Adds physical damage; can be outscaled.'],
    ['Shen', 'Defensive trading and protection for allied carries.', 'Wave control can be difficult; limited damage.']
  ],
  Mid: [['Ahri', 'Mobility and wave control.', 'Skillshot dependent.'], ['Orianna', 'Range and teamfight utility.', 'Immobile vs dives.'], ['Lissandra', 'Control and defensive tools.', 'Shorter range than artillery.']],
  Jungle: [['Vi', 'Reliable engage for allied carries.', 'Commitment exposes you.'], ['Jarvan IV', 'Flexible engage and early pressure.', 'Enemies can escape your arena.'], ['Sejuani', 'Frontline and crowd control.', 'Slower damage scaling.']],
  Bot: [['Ezreal', 'Range and repositioning.', 'Skillshot dependent.'], ['Xayah', 'Defensive ultimate against dives.', 'Short attack range.'], ['Caitlyn', 'Range and lane pressure.', 'Vulnerable when caught.']],
  Support: [['Nami', 'Flexible lane utility.', 'Fragile when engaged on.'], ['Braum', 'Protects carries against incoming attacks.', 'Limited proactive range.'], ['Rakan', 'Engage and disengage.', 'Needs coordinated follow-up.']]
};

function blindPicks(state, champions, analysis) {
  if (!state.myPosition || state.myActionType === 'ban' || (state.me && state.me.championId)) return [];
  return (POOLS[state.myPosition] || []).map(([name, why, risk], order) => {
    const champion = Object.values(champions).find((c) => c.name === name);
    if (!champion || state.unavailable.has(champion.id)) return null;
    const attr = attributesFor(champion);
    let score = 20 - order;
    const reasons = [why];
    if (analysis.ally.frontline < 2 && attr.frontline >= 2) { score += 3; reasons.push('Fills your frontline gap.'); }
    if (analysis.ally.adPct >= 65 && attr.damage === 'AP') { score += 4; reasons.push('Balances your physical-heavy allies.'); }
    if (analysis.enemy.apPct >= 60 && attr.frontline >= 2) reasons.push('Plan MR for the revealed magic threats.');
    return { championId: champion.id, name, why: reasons.join(' '), risk, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 3);
}
module.exports = { blindPicks };
