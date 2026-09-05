'use strict';
const https = require('https');
const { prettyPosition } = require('./draft');

// Certificate verification is disabled only for Riot's loopback game endpoint.
function readLiveGame() {
  return new Promise((resolve) => {
    const req = https.get({ hostname: '127.0.0.1', port: 2999,
      path: '/liveclientdata/allgamedata', rejectUnauthorized: false, timeout: 1200 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('error', () => resolve(null));
      res.on('end', () => {
        try { resolve(res.statusCode === 200 ? JSON.parse(body) : null); }
        catch (_) { resolve(null); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

function parseLiveGame(data, champions, previous) {
  if (!data || !Array.isArray(data.allPlayers) || !data.activePlayer) return null;
  const active = data.activePlayer;
  const local = data.allPlayers.find((p) =>
    (active.riotId && p.riotId === active.riotId) ||
    (active.summonerName && p.summonerName === active.summonerName));
  if (!local || !local.team) return null;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const player = (p, i) => {
    const slug = String(p.rawChampionName || '').replace(/^game_character_displayname_/, '');
    const champ = Object.values(champions).find((c) => norm(c.slug) === norm(slug) ||
      norm(c.name) === norm(p.championName));
    return { cellId: i, championId: champ ? champ.id : 0, hoveredId: 0,
      isLocal: p === local, position: prettyPosition(p.position),
      items: (Array.isArray(p.items) ? p.items : []).map((it) => Number(it.itemID)).filter(Boolean) };
  };
  const myTeam = data.allPlayers.filter((p) => p.team === local.team).map(player);
  const theirTeam = data.allPlayers.filter((p) => p.team !== local.team).map(player);
  const me = myTeam.find((p) => p.isLocal);
  if (!me || !me.championId) return null;
  const myPosition = me.position || (previous && previous.myPosition) || null;
  me.position = myPosition;
  return { me, myPosition, myTeam, theirTeam, allyBans: previous ? previous.allyBans : [],
    enemyBans: previous ? previous.enemyBans : [], unavailable: new Set([...myTeam, ...theirTeam].map((p) => p.championId)),
    isMyTurn: false, myActionType: null, timeLeft: null, live: true,
    gameTime: Number(data.gameData && data.gameData.gameTime) || 0 };
}

function inventorySignature(state) {
  return JSON.stringify([state.me.championId, state.myPosition, state.opponentOverrideId || null,
    ...[...state.myTeam, ...state.theirTeam].map((p) => [p.championId, [...(p.items || [])].sort()])]);
}

module.exports = { readLiveGame, parseLiveGame, inventorySignature };
