'use strict';

const POSITIONS = { top: 'Top', jungle: 'Jungle', middle: 'Mid', bottom: 'Bot', utility: 'Support' };

function prettyPosition(p) {
  if (!p) return null;
  return POSITIONS[p.toLowerCase()] || null;
}

// Flattens the LCU's 2D action array and pulls out bans plus the action in progress.
function readActions(session) {
  const flat = [];
  for (const group of session.actions || []) for (const a of group) flat.push(a);

  const allyBans = [];
  const enemyBans = [];
  for (const a of flat) {
    if (a.type !== 'ban' || !a.completed || !a.championId) continue;
    (a.isAllyAction ? allyBans : enemyBans).push(a.championId);
  }

  const inProgress = flat.filter((a) => a.isInProgress);
  return { flat, allyBans, enemyBans, inProgress };
}

function buildPlayer(p, isLocal, actions) {
  // A player's own in-progress action reveals what they are hovering.
  const own = actions.flat.find((a) => a.actorCellId === p.cellId && a.isInProgress);
  const hovered = p.championPickIntent || (own && own.type === 'pick' ? own.championId : 0) || 0;
  return {
    cellId: p.cellId,
    position: prettyPosition(p.assignedPosition),
    championId: p.championId || 0,
    hoveredId: p.championId ? 0 : hovered,
    isLocal,
  };
}

/**
 * Normalises an LCU champ-select session into the shape the UI and AI layer use.
 * Returns null when there is no usable session.
 */
function parseSession(session) {
  if (!session || !session.myTeam) return null;

  const actions = readActions(session);
  const localCellId = session.localPlayerCellId;

  const myTeam = (session.myTeam || []).map((p) => buildPlayer(p, p.cellId === localCellId, actions));
  const theirTeam = (session.theirTeam || []).map((p) => buildPlayer(p, false, actions));

  // Bans reported directly by the client are authoritative; fall back to actions.
  const bans = session.bans || {};
  const allyBans = (bans.myTeamBans && bans.myTeamBans.length ? bans.myTeamBans : actions.allyBans)
    .filter(Boolean);
  const enemyBans = (bans.theirTeamBans && bans.theirTeamBans.length ? bans.theirTeamBans : actions.enemyBans)
    .filter(Boolean);

  // Anything banned, locked, or hovered by an ally cannot be picked by us.
  const unavailable = new Set([...allyBans, ...enemyBans]);
  for (const p of [...myTeam, ...theirTeam]) {
    if (p.championId) unavailable.add(p.championId);
    if (p.hoveredId && !p.isLocal) unavailable.add(p.hoveredId);
  }

  const localAction = actions.inProgress.find((a) => a.actorCellId === localCellId);
  const me = myTeam.find((p) => p.isLocal) || null;

  return {
    localCellId,
    me,
    myPosition: me ? me.position : null,
    myTeam,
    theirTeam,
    allyBans,
    enemyBans,
    unavailable,
    isMyTurn: !!localAction,
    myActionType: localAction ? localAction.type : null,
    timeLeft: session.timer ? Math.round((session.timer.adjustedTimeLeftInPhase || 0) / 1000) : null,
    phase: session.timer ? session.timer.phase : null,
  };
}

/**
 * Fingerprint of everything that should trigger a fresh analysis.
 * Your own hover is deliberately excluded: scrolling the champion grid must not
 * restart the analysis, and what is good for you does not depend on which
 * champion you happen to be hovering.
 */
function signature(state) {
  const picks = [...state.myTeam, ...state.theirTeam]
    .map((p) => `${p.championId}:${p.isLocal ? 0 : p.hoveredId}`).join(',');
  return [picks, state.allyBans.join('-'), state.enemyBans.join('-'),
          state.isMyTurn, state.myActionType].join('|');
}

module.exports = { parseSession, prettyPosition, signature };
