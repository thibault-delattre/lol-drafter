'use strict';
const { parseSession } = require('./draft');
const { parseLiveGame } = require('./live');
const { analyzeDraft } = require('./analyze');
const { inferEnemyRoles } = require('./prompt');
const { lanesFor } = require('./lanes');
const { blindPicks } = require('./blind');
const { itemAdvice } = require('./items');
const ROLES = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];
const RAW_ROLES = ['top', 'jungle', 'middle', 'bottom', 'utility'];

function createState(spec, champions, data) {
  const byName = Object.fromEntries(Object.values(champions).map(c => [c.name.toLowerCase(), c.id]));
  const id = name => {
    if (!name) return 0;
    const value = byName[String(name).toLowerCase()];
    if (!value) throw new Error('Unknown champion: ' + name);
    return value;
  };
  if (!ROLES.includes(spec.role)) throw new Error('Choose Top, Jungle, Mid, Bot or Support');
  if (!['draft', 'live'].includes(spec.mode)) throw new Error('Mode must be draft or live');
  for (const team of ['allies', 'enemies']) {
    if (!Array.isArray(spec[team]) || spec[team].length !== 5) throw new Error(team + ' needs five slots');
    for (const p of spec[team]) {
      if (!p || typeof p !== 'object') throw new Error('Each player slot must be an object');
      for (const field of ['level', 'kills', 'deaths', 'assists', 'cs']) {
        if (p[field] !== undefined && (!Number.isInteger(p[field]) || p[field] < 0)) throw new Error(field + ' must be a non-negative integer');
      }
      if (p.level !== undefined && (p.level < 1 || p.level > 18)) throw new Error('Level must be 1–18');
      if (p.items !== undefined && (!Array.isArray(p.items) || p.items.length > 6)) throw new Error('Items must contain at most six slot IDs');
    }
  }
  const picked = [...spec.allies, ...spec.enemies].filter(p => p.champion).map(p => id(p.champion));
  if (new Set(picked).size !== picked.length) throw new Error('A champion cannot occupy two slots');
  const bans = (spec.bans || []).map(id);
  if (picked.some(c => bans.includes(c))) throw new Error('A picked champion is also banned');
  const localIndex = ROLES.indexOf(spec.role);
  let state;
  if (spec.mode === 'live') {
    if (!spec.allies[localIndex].champion) throw new Error('Live mode needs your locked champion');
    const players = (team, side) => team.filter(p => p.champion).map(p => {
      const index = team.indexOf(p);
      const mine = side === 'ORDER' && index === localIndex;
      const items = (p.items || []).map(value => {
        const itemID = Number(value);
        if (!data.itemMeta[itemID]) throw new Error('Unknown item ID: ' + value);
        return { itemID };
      });
      return { riotId: mine ? 'Simulator#LOCAL' : side + index, championName: p.champion,
        team: side, position: RAW_ROLES[ROLES.indexOf(p.role || ROLES[index])], items,
        level: p.level || 1, scores: { kills: p.kills || 0, deaths: p.deaths || 0,
          assists: p.assists || 0, creepScore: p.cs || 0 } };
    });
    state = parseLiveGame({ activePlayer: { riotId: 'Simulator#LOCAL', currentGold: spec.gold || 0 },
      gameData: { gameTime: spec.time || 0 },
      allPlayers: [...players(spec.allies, 'ORDER'), ...players(spec.enemies, 'CHAOS')] }, champions);
  } else {
    const team = (players, enemy) => players.map((p, i) => ({ cellId: i + (enemy ? 5 : 0),
      assignedPosition: enemy ? RAW_ROLES[ROLES.indexOf(p.role)] || '' : RAW_ROLES[i],
      championId: id(p.champion), championPickIntent: id(p.hover) }));
    const mine = spec.allies[localIndex];
    const action = spec.turn === undefined ? [{ actorCellId: localIndex, type: 'pick',
      championId: id(mine.champion || mine.hover), completed: !!mine.champion, isInProgress: !mine.champion }]
      : spec.turn ? [{ actorCellId: (spec.turn.team === 'enemies' ? 5 : 0) + spec.turn.slot,
        type: spec.turn.type || 'pick', championId: id(spec[spec.turn.team][spec.turn.slot].hover),
        completed: false, isInProgress: true }] : [];
    state = parseSession({ localPlayerCellId: localIndex, myTeam: team(spec.allies, false),
      theirTeam: team(spec.enemies, true), bans: { myTeamBans: bans, theirTeamBans: [] },
      timer: { adjustedTimeLeftInPhase: 22000, phase: 'BAN_PICK' },
      actions: [action] });
  }
  if (spec.opponent) {
    const override = id(spec.opponent);
    if (!state.theirTeam.some(p => p.championId === override)) throw new Error('Lane override is not on the enemy team');
    state.opponentOverrideId = override;
  }
  return state;
}

async function simulate(spec, champions, data, provider = {}) {
  const state = createState(spec, champions, data);
  const analysis = analyzeDraft(state, champions);
  const roles = inferEnemyRoles(state, champions, lanesFor);
  const picture = id => champions[id] ? { ...champions[id],
    img: `https://ddragon.leagueoflegends.com/cdn/${data.version}/img/champion/${champions[id].slug}.png` } : null;
  let counters = null;
  if (!state.me.championId) {
    if (!roles.opponent) counters = { mode: 'blind', warning: roles.warning, enemies: roles.picked,
      list: blindPicks(state, champions, analysis).map(p => ({ ...p, img: picture(p.championId).img })) };
    else {
      const opponentId = Object.values(champions).find(c => c.name === roles.opponent).id;
      const stats = provider.buildLaneStats && await provider.buildLaneStats({ opponentId,
        opponentName: roles.opponent, role: state.myPosition, patch: data.version, champions, unavailable: state.unavailable });
      counters = { ...(stats || {}), opponent: roles.opponent, totalGames: stats ? stats.totalGames : 0,
        unavailable: !stats, list: stats ? stats.counters.slice(0, 3).map(p => ({ ...p, img: picture(p.championId).img })) : [] };
    }
  }
  const baseline = state.me.championId && provider.championBuild
    ? await provider.championBuild(state.me.championId, state.myPosition, data.version, data.itemMeta) : null;
  const items = state.me.championId ? itemAdvice(state, champions, data, roles, baseline) : null;
  const player = p => ({ ...p, champion: picture(p.championId), hovered: picture(p.hoveredId) });
  const checks = [];
  const expect = spec.expect || {};
  const check = (label, expected, actual) => checks.push({ label, expected, actual, pass: JSON.stringify(expected) === JSON.stringify(actual) });
  if ('topPick' in expect) check('Top pick', expect.topPick, counters?.list[0]?.name || null);
  if ('opponent' in expect) check('Lane opponent', expect.opponent, roles.opponent || null);
  if ('target' in expect) check('Next item', expect.target, items?.target?.name || null);
  if ('slots' in expect) check('Final slots', expect.slots, items?.plan.length || 0);
  for (const name of expect.planContains || []) check('Plan contains ' + name, true, !!items?.plan.some(it => it.name === name));
  return { title: spec.title || 'Custom scenario', patch: data.version, checks,
    engine: 'Production deterministic engine; no fabricated Claude response',
    roles, counters, items,
    draft: { ...state, unavailable: [...state.unavailable], analysis, myTeam: state.myTeam.map(player),
      theirTeam: state.theirTeam.map(player), allyBans: state.allyBans.map(picture), enemyBans: state.enemyBans.map(picture) } };
}
module.exports = { createState, simulate };
