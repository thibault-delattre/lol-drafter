'use strict';
const { attributesFor } = require('./attributes');

// Visible item investment is a proxy for power, not enemy gold or measured DPS.
function threatProfile(state, champions, meta, opponent) {
  const threats = state.theirTeam.filter(p => champions[p.championId]).map(p => {
    const champion = champions[p.championId];
    const kit = attributesFor(champion).damage;
    let physical = kit === 'AD' ? 900 : kit === 'AP' ? 150 : 500;
    let magic = kit === 'AP' ? 900 : kit === 'AD' ? 150 : 500;
    let investment = 0; let armor = 0; let mr = 0;
    for (const id of p.items || []) {
      const m = meta[id];
      if (!m || m.consumable || m.trinket) continue;
      const s = m.stats || {};
      investment += m.gold || 0;
      armor += s.FlatArmorMod || 0;
      mr += s.FlatSpellBlockMod || 0;
      // Scale purchased offensive stats to comparable gold-value evidence.
      physical += (s.FlatPhysicalDamageMod || 0) * 35 + (s.FlatCritChanceMod || 0) * 2000;
      magic += (s.FlatMagicDamageMod || 0) * 22;
    }
    const scores = p.scores || {};
    const power = 1 + investment / 3000 + (p.level || 1) / 9 +
      Math.min(1.5, ((scores.kills || 0) * 0.12 + (scores.assists || 0) * 0.035)) +
      Math.min(0.5, (scores.cs || 0) / 400);
    const laneWeight = champion.name === opponent && (!state.live || state.gameTime < 840) ? 1.7 : 1;
    const apShare = magic / (physical + magic);
    return { name: champion.name, investment, armor, mr, apShare, power: power * laneWeight,
      level: p.level, scores, evidence: 'Item investment + level + K/A/CS; estimated damage mix' };
  });
  const total = threats.reduce((sum, t) => sum + t.power, 0) || 1;
  const apShare = threats.reduce((sum, t) => sum + t.power * t.apShare, 0) / total;
  return { apShare, threats: threats.sort((a, b) => b.power - a.power), estimated: true };
}

function buildPlan(state, champions, data, roles, baseline, options, tuned) {
  const meta = data.itemMeta || {};
  const me = champions[state.me.championId];
  const owned = (state.me.items || []).map(String);
  const profile = threatProfile(state, champions, meta, roles && roles.opponent);
  const tank = (me.tags || []).includes('Tank') || attributesFor(me).frontline >= 2;
  const icon = id => data.version ? `https://ddragon.leagueoflegends.com/cdn/${data.version}/img/item/${id}.png` : null;
  const entry = (id, why) => ({ id: String(id), name: data.itemNames[id], image: icon(id), why,
    shortWhy: why, owned: owned.includes(String(id)) });
  const finished = id => meta[id] && meta[id].purchasable && !meta[id].consumable &&
    !meta[id].trinket && (meta[id].boots && String(id) !== '1001' ||
      meta[id].gold >= 1600 && !(meta[id].into || []).length);
  const plan = [];
  const add = (id, why) => {
    id = String(id);
    if (plan.length >= 6 || !finished(id) || plan.some(it => it.id === id)) return;
    if (meta[id].boots && plan.some(it => meta[it.id].boots)) return;
    // Do not combine mutually exclusive Last Whisper upgrades.
    const pen = new Set(['3036', '3033', '6694']);
    if (pen.has(id) && plan.some(it => pen.has(it.id))) return;
    plan.push(entry(id, why));
  };
  owned.filter(finished).forEach(id => add(id, 'Owned · keep'));
  const boots = owned.find(id => finished(id) && meta[id].boots) ||
    options.find(it => meta[it.id] && meta[it.id].boots)?.id || baseline && baseline.boots;
  if (boots) add(boots, 'Boots · one pair');
  const core = baseline && (baseline.fullBuild || baseline.core) || [];
  const armorStack = profile.threats.some(t => t.armor >= 100);
  let adaptation = null;
  const observedBuild = profile.threats.some(t => t.investment >= 2000);
  if (state.live && observedBuild && tank && profile.apShare >= 0.6) {
    const id = me.name === 'Dr. Mundo' ? 3065 : 4401;
    adaptation = entry(id, 'MR priority · strongest weighted threats');
  } else if (state.live && observedBuild && tank && profile.apShare <= 0.35) {
    const crit = options.find(it => it.id === '3143');
    adaptation = entry(crit ? 3143 : 3068, crit ? 'Observed crit · armor priority' : 'Physical pressure · armor + health');
  }
  if (state.live && !tank && baseline) {
    const wanted = me.name === 'Vayne' ? profile.apShare >= 0.65 ? 'SpellBlock' : null
      : attributesFor(me).damage === 'AD' && armorStack ? 'ArmorPenetration'
      : attributesFor(me).damage === 'AP' && profile.threats.some(t => t.mr >= 80) ? 'MagicPenetration' : null;
    const candidates = (baseline.alternatives || []).flatMap(slot => slot.options);
    const candidate = candidates.find(it => !it.lowSample && (meta[it.id]?.tags || []).includes(wanted) &&
      (me.name !== 'Vayne' || (meta[it.id]?.tags || []).includes('AttackSpeed')));
    if (candidate) adaptation = entry(candidate.id, `Stat-supported adaptation · ${candidate.winRate}% WR / ${candidate.games} games`);
  }
  // Preserve the first damage item for carries; a tank may need immediate resistance.
  if (!tank) for (const it of core.slice(0, 2)) add(it.id, 'Damage core · preserve timing');
  if (adaptation && baseline) add(adaptation.id, adaptation.why);
  // AI has already been validated by main; keep the deterministic carry opening above.
  for (const it of tuned && tuned.core || []) add(it.id, it.why || 'Draft adaptation');
  for (const it of core) add(it.id, it.opening && baseline.opening
    ? `Opening · ${baseline.opening.winRate}% WR / ${baseline.opening.games} games`
    : `${it.winRate == null ? 'Baseline' : it.winRate + '% WR'} · ${it.games || '?'} games`);
  // Older cache entries may only have three core items. Same-slot alternatives fill gaps.
  for (const slot of baseline && baseline.alternatives || []) {
    const candidate = slot.options.find(it => !plan.some(p => p.id === String(it.id)) && finished(it.id));
    if (candidate) add(candidate.id, `${candidate.winRate}% WR · ${candidate.games} games · same slot`);
  }
  const alerts = [];
  if (armorStack && me.name === 'Vayne') alerts.push('Armor stack: keep attack speed · Silver Bolts bypass armor');
  if (state.live && profile.threats.length) alerts.push(`Top threat: ${profile.threats[0].name} · estimated ${Math.round(profile.apShare * 100)}% magic pressure`);
  const startCounts = new Map();
  owned.forEach(id => startCounts.set(id, (startCounts.get(id) || 0) + 1));
  const starting = (!state.live || state.gameTime < 90)
    ? (baseline && baseline.starting || []).filter(id => {
      id = String(id);
      if (startCounts.get(id)) { startCounts.set(id, startCounts.get(id) - 1); return false; }
      return meta[id] && meta[id].purchasable;
    }).map(id => entry(id, 'Starting purchase')) : [];
  const target = plan.find(it => !it.owned);
  // Consume inventory counts through the recipe: two bows really need two bows.
  const counts = new Map();
  owned.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
  let credit = 0;
  const remaining = (id, seen = new Set()) => {
    id = String(id);
    if ((counts.get(id) || 0) > 0) {
      counts.set(id, counts.get(id) - 1); credit += meta[id]?.gold || 0; return [];
    }
    if (seen.has(id) || !meta[id]) return [];
    const parts = meta[id].from || [];
    if (!parts.length) return [entry(id, `${meta[id].gold}g · component → ${target.name}`)];
    const next = new Set(seen); next.add(id);
    return parts.flatMap(part => remaining(part, next));
  };
  const missing = target ? remaining(target.id) : [];
  const grouped = new Map();
  for (const part of missing) {
    if (grouped.has(part.id)) grouped.get(part.id).quantity++;
    else grouped.set(part.id, { ...part, quantity: 1 });
  }
  const components = [...grouped.values()].map(part => ({ ...part,
    name: part.name + (part.quantity > 1 ? ` ×${part.quantity}` : ''),
    shortWhy: `${meta[part.id].gold * part.quantity}g · for ${target.name}` }));
  if (target) {
    target.remainingGold = Math.max(0, meta[target.id].gold - credit);
    target.shortWhy = `${target.remainingGold}g remaining · ${target.why}`;
  }
  return { plan, starting, components, target, profile, alerts, adaptation,
    planComplete: plan.length === 6, planLabel: plan.length === 6 ? '6-slot plan · provisional' : `${plan.length}/6 slots · limited build data` };
}
module.exports = { buildPlan, threatProfile };
