'use strict';
// Shared mock champ-select session: I am Mid (cellId 3) and it is my turn to pick.
function buildSession(id) {
  return {
    localPlayerCellId: 3,
    timer: { adjustedTimeLeftInPhase: 24500, phase: 'BAN_PICK' },
    bans: {
      myTeamBans: [id('Yasuo'), id('Katarina')],
      theirTeamBans: [id('Ahri'), id('Sylas')],
    },
    myTeam: [
      { cellId: 0, assignedPosition: 'top',     championId: id('Malphite'), championPickIntent: 0 },
      { cellId: 1, assignedPosition: 'jungle',  championId: 0,              championPickIntent: 0 },
      { cellId: 2, assignedPosition: 'bottom',  championId: id('Jinx'),     championPickIntent: 0 },
      { cellId: 3, assignedPosition: 'middle',  championId: 0,              championPickIntent: 0 },
      { cellId: 4, assignedPosition: 'utility', championId: id('Leona'),    championPickIntent: 0 },
    ],
    theirTeam: [
      { cellId: 5, assignedPosition: '', championId: id('Darius'), championPickIntent: 0 },
      { cellId: 6, assignedPosition: '', championId: id('Zed'),    championPickIntent: 0 },
      { cellId: 7, assignedPosition: '', championId: 0,            championPickIntent: 0 },
      { cellId: 8, assignedPosition: '', championId: 0,            championPickIntent: 0 },
      { cellId: 9, assignedPosition: '', championId: 0,            championPickIntent: 0 },
    ],
    actions: [
      [{ actorCellId: 3, championId: 0, completed: false, type: 'pick', isAllyAction: true, isInProgress: true }],
    ],
  };
}
module.exports = { buildSession };
