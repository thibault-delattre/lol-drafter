'use strict';
const { attributesFor } = require('./attributes');

const HEALERS = new Set(['Dr. Mundo', 'Vladimir', 'Aatrox', 'Soraka', 'Yuumi', 'Briar',
  'Warwick', 'Zac', 'Swain', 'Sylas', 'Fiora', 'Illaoi', 'Olaf', 'Red Kayn']);
const TRUE_DAMAGE = new Set(['Vayne', 'Fiora', 'Master Yi', 'Gwen', 'Darius', 'Camille', 'Cho\'Gath', 'Vel\'Koz']);

function singleBootChoice(options, meta, inventory = []) {
  const ownsCompletedBoots = inventory.some((id) => String(id) !== '1001' && meta[id] && meta[id].boots);
  let chosen = false;
  return options.filter((item) => {
    if (!meta[item.id] || !meta[item.id].boots) return true;
    if (ownsCompletedBoots || chosen) return false;
    chosen = true;
    return true;
  });
}

function itemAdvice(state, champions, gameData, roles, baseline, tuned) {
  if (!state.me || !state.me.championId) return null;
  const me = champions[state.me.championId];
  if (!me) return null;
  const names = gameData ? gameData.itemNames : {};
  const meta = gameData ? gameData.itemMeta : {};
  const owned = new Set((state.me.items || []).map(String));
  const mine = attributesFor(me);
  const tank = (me.tags || []).includes('Tank') || mine.frontline >= 2;
  const mage = !tank && mine.damage === 'AP';
  const attackCarry = !tank && (me.tags || []).includes('Marksman');
  const opponent = roles && roles.opponent;
  const enemies = state.theirTeam.filter((p) => champions[p.championId]).map((p) => ({
    ...p, name: champions[p.championId].name, champ: champions[p.championId] }));
  const lane = enemies.find((p) => p.name === opponent);
  const options = [];
  const notes = [];
  const add = (id, why, priority) => {
    id = String(id);
    // Suppress bought components when an owned upgrade already includes them.
    const includes = (root, target, seen = new Set()) => {
      if (root === target) return true;
      if (seen.has(root)) return false;
      seen.add(root);
      return (meta[root] && meta[root].from || []).some((x) => includes(String(x), target, seen));
    };
    if (!names[id] || !meta[id] || meta[id].purchasable !== true ||
        [...owned].some((x) => includes(x, id)) || options.some((x) => x.id === id)) return;
    options.push({ id, name: names[id], why, priority });
  };
  // Preserve the champion's offensive engine. A physical lane opponent alone is
  // insufficient evidence to trade Vayne's attack speed for defensive boots.
  const physicalEnemies = enemies.filter((p) => attributesFor(p.champ).damage === 'AD').length;
  if (me.name === 'Garen') {
    add(3006, 'Default offensive boots for Garen; preserve your attack-speed build. Buy one pair only.', 105);
  } else if (attackCarry) {
    add(me.name === 'Vayne' ? 3006 : (baseline && baseline.boots) || 3006,
      me.name === 'Vayne' ? 'Default: attack speed for Silver Bolts and kiting. A physical laner alone does not justify Steelcaps.'
        : 'Preserve your offensive boots and damage timing; adapt only to a concrete survival problem.', 105);
    if (physicalEnemies < 3) notes.push('Mixed/magic-heavy threats: do not default to armor boots for one physical laner.');
  } else if (baseline && baseline.boots) {
    add(baseline.boots, 'Champion/role baseline boots; lane adaptations below are conditional.', 60);
  }
  if (lane) {
    const damage = attributesFor(lane.champ).damage;
    notes.push(`Lane first: ${opponent}${state.opponentOverrideId ? ' (your selection)' : ' (check role if lane-swapped)'}.`);
    if (opponent === 'Vayne') {
      notes.push('Vayne: physical attacks + max-health true damage. Armor cannot reduce Silver Bolts; avoid long trades.');
      if (!attackCarry) add(3047, 'Early boots vs Vayne attacks; movement helps disengage. Does not stop her true damage.', 100);
      if (tank) add(3082, 'Armor component for physical attacks; do not treat it as a counter to Silver Bolts.', 85);
    } else if (damage === 'AD') {
      if (!attackCarry) add(tank ? 3047 : 1029,
        `Lane option vs ${opponent}'s physical damage; weigh delaying your damage power spike.`, tank ? 90 : 40);
      else if (physicalEnemies >= 3) add(3047,
        'Alternative only if physical attacks prevent you from dealing damage; costs offensive attack speed.', 35);
    } else if (damage === 'AP') {
      add(tank ? 3211 : 1033, `If lane magic damage is forcing you out, consider MR; preserve your core-item timing.`, tank ? 90 : 40);
    }
  } else notes.push(roles && roles.warning || 'Lane opponent unknown: item priorities are provisional.');

  const trueThreats = enemies.filter((p) => TRUE_DAMAGE.has(p.name)).map((p) => p.name);
  if (trueThreats.length && opponent !== 'Vayne') notes.push(`True damage from ${trueThreats.join(', ')} bypasses armor and MR.`);
  const crit = enemies.filter((p) => (p.items || []).some((id) => Number(id) === 3031) ||
    (p.items || []).reduce((n, id) => n + (meta[id] && meta[id].stats && meta[id].stats.FlatCritChanceMod || 0), 0) >= 0.4);
  if (crit.length) {
    if (tank) add(3143, `Observed crit builds: ${crit.map((p) => p.name).join(', ')}. Randuin's reduces critical-strike damage.`, 80 + Math.min(crit.length, 3));
    else notes.push(`Crit threat: ${crit.map((p) => p.name).join(', ')}. Keep carry damage; consider a defensive slot if focused.`);
  }
  const healing = enemies.filter((p) => HEALERS.has(p.name) || (p.items || []).some((id) => {
    const item = meta[id];
    // A Vampiric Scepter on Xayah is not a reason to delay your core for wounds.
    return item && item.gold >= 2000 && /LifeSteal|SpellVamp/.test((item.tags || []).join(' '));
  }));
  const hasWounds = (ids) => (ids || []).some((id) => /Wounds|Grievous/i.test(meta[id] && meta[id].description || ''));
  if (healing.length && !hasWounds(state.me.items)) {
    const healNames = healing.map((p) => p.name).join(', ');
    const laneHeals = healing.some((p) => p.name === opponent);
    add(tank ? 3076 : mage ? 3916 : 3123,
      tank ? `Healing: ${healNames}. Bramble only applies when they attack you; unreliable vs spell-only Vladimir.`
        : `Healing: ${healNames}. Apply wounds with ${mage ? 'magic' : 'physical'} damage; avoid duplicate completed anti-heal.`,
      laneHeals ? 96 : attackCarry ? 30 : 70);
    if (tank) notes.push('Against spell healing, coordinate an ally damage-applied anti-heal item; Bramble is conditional.');
    if (state.myTeam.some((p) => !p.isLocal && hasWounds(p.items))) notes.push('An ally owns anti-heal; check whether they can apply it to your target.');
  }
  // Prefer the statistical core for damage; defensive adaptations are alternatives, not six mandatory purchases.
  if (tuned) for (const it of tuned.core || []) add(it.id, it.why || 'Adapted core item for this draft.', 55);
  if (baseline) for (const it of baseline.core || []) add(it.id, it.opening
    ? `Opening combination${baseline.opening ? ': ' + baseline.opening.winRate + '% / ' + baseline.opening.games + ' games' : ''}; adapt to lane.`
    : `Same-slot result: ${it.winRate}% / ${it.games} games${it.lowSample ? ' (low sample; popularity fallback)' : '; ranked by confidence'}.`, 50);
  return { champion: me.name, opponent, live: !!state.live, notes,
    options: singleBootChoice(options.sort((a, b) => b.priority - a.priority), meta, state.me.items).slice(0, 5),
    source: baseline ? `u.gg ${baseline.tier} / ${baseline.patch} / ${baseline.games} games${baseline.fallback ? ' (previous patch)' : ''}`
      : 'Situational rules; statistical build unavailable', updatedAt: Date.now() };
}

module.exports = { itemAdvice, singleBootChoice };
