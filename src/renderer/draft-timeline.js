'use strict';
// Shared by the HTML playback controls and Node regression tests.
(function (root) {
  const roles = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];
  const order = ['blue', 'red', 'red', 'blue', 'blue', 'red', 'red', 'blue', 'blue', 'red'];
  const slots = { blue: [1, 3, 4, 2, 0], red: [1, 3, 2, 4, 0] };
  const champions = { blue: ['Gragas', 'Viego', 'Yasuo', "Kai'Sa", 'Bard'],
    red: ['Gnar', 'Diana', 'Viktor', 'Xayah', 'Karma'] };
  const bans = { blue: ['Aatrox', 'Jax', 'Renekton', 'Fiora', 'Darius'],
    red: ['Camille', 'Malphite', 'Vayne', 'Nasus', 'Teemo'] };
  function frames(mySide = 'blue', localChampion, role = 'Top', alliedOrder = slots[mySide], enemyOrder = slots[mySide === 'blue' ? 'red' : 'blue']) {
    const localSlot = roles.indexOf(role);
    if (localSlot < 0) throw new Error('Choose a role');
    if (alliedOrder.length !== 5 || new Set(alliedOrder).size !== 5 || alliedOrder.some(i => !Number.isInteger(i) || i < 0 || i > 4)) throw new Error('Invalid pick order');
    const spec = { title: 'Draft animée · ' + role, mode: 'draft', role,
      allies: Array.from({ length: 5 }, () => ({})), enemies: Array.from({ length: 5 }, () => ({})), bans: [],
      displayOrder: { myTeam: [...alliedOrder], theirTeam: [...enemyOrder] },
      turn: { team: 'allies', slot: localSlot, type: 'ban' } };
    const result = [];
    const push = (label, phase, active = null) => result.push({ label, phase, active,
      spec: JSON.parse(JSON.stringify(spec)) });
    push('La draft commence · bans simultanés', 'ban');
    for (let i = 0; i < 5; i++) {
      spec.bans.push(bans.blue[i], bans.red[i]);
      push(`Révélation des bans · ${i + 1}/5 par équipe`, 'ban-reveal');
    }
    const used = { blue: 0, red: 0 };
    for (let i = 0; i < order.length; i++) {
      const side = order[i]; const slot = (side === mySide ? alliedOrder : enemyOrder)[used[side]++];
      const team = side === mySide ? 'allies' : 'enemies';
      const champion = team === 'allies' && slot === localSlot && localChampion ? localChampion : champions[side][slot];
      const active = { side, team, slot, pick: i + 1 };
      spec.turn = { team, slot, type: 'pick' };
      spec[team][slot] = { hover: champion };
      push(`${side === 'blue' ? 'Bleu' : 'Rouge'} · pick ${i + 1}/10 · ${roles[slot]} · survol`, 'hover', active);
      spec[team][slot] = { champion };
      spec.turn = null;
      push(`${champion} verrouillé · pick ${i + 1}/10`, 'lock', active);
    }
    push('Draft terminée · les dix champions sont verrouillés', 'complete');
    return result;
  }
  function swap(spec, alliedOrder, targetSlot) {
    const mine = roles.indexOf(spec.role);
    if (!Number.isInteger(targetSlot) || targetSlot < 0 || targetSlot > 4 || targetSlot === mine ||
      spec.allies[mine].champion || spec.allies[targetSlot].champion) throw new Error('Swap requires two unlocked teammates');
    const next = [...alliedOrder]; const a = next.indexOf(mine); const b = next.indexOf(targetSlot);
    [next[a], next[b]] = [next[b], next[a]];
    return next;
  }
  function randomSlots(random = Math.random) {
    const result = [0, 1, 2, 3, 4];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  const delay = (phase, pickMs = 15000) => phase === 'hover' ? pickMs : phase === 'ban' ? 15000 : phase === 'ban-reveal' ? 250 : 0;
  const api = { frames, order, roles, swap, delay, randomSlots, defaultSlots: side => [...slots[side]] };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DraftTimeline = api;
})(typeof window !== 'undefined' ? window : globalThis);
