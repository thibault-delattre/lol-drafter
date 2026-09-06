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
  function frames(mySide = 'blue', localChampion) {
    const spec = { title: 'Draft animée · Top', mode: 'draft', role: 'Top',
      allies: Array.from({ length: 5 }, () => ({})), enemies: Array.from({ length: 5 }, () => ({})), bans: [], turn: { team: 'allies', slot: 0, type: 'ban' } };
    const result = [];
    const push = (label, phase, active = null) => result.push({ label, phase, active,
      spec: JSON.parse(JSON.stringify(spec)) });
    push('La draft commence · bans simultanés', 'ban');
    for (let i = 0; i < 5; i++) {
      spec.bans.push(bans.blue[i], bans.red[i]);
      push(`Bans ${i + 1}/5 par équipe`, 'ban');
    }
    const used = { blue: 0, red: 0 };
    for (let i = 0; i < order.length; i++) {
      const side = order[i]; const slot = slots[side][used[side]++];
      const team = side === mySide ? 'allies' : 'enemies';
      const champion = team === 'allies' && slot === 0 && localChampion ? localChampion : champions[side][slot];
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
  const api = { frames, order, roles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DraftTimeline = api;
})(typeof window !== 'undefined' ? window : globalThis);
