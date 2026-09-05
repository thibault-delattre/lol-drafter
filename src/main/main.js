'use strict';
const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const { LcuClient } = require('./lcu');
const { loadChampions, loadGameData, squareUrl } = require('./champdata');
const { parseSession, signature } = require('./draft');
const { analyzeDraft } = require('./analyze');
const { attributesFor } = require('./attributes');
const { buildPrompt, buildBuildPrompt, inferEnemyRoles } = require('./prompt');
const { lanesFor } = require('./lanes');
const ugg = require('./ugg');
const { Analyzer, extractJson, validate, progressivePicks } = require('./ai');
const { readLiveGame, parseLiveGame, inventorySignature } = require('./live');
const { itemAdvice, singleBootChoice } = require('./items');
const { blindPicks } = require('./blind');

const POLL_MS = 1500;
const AI_DEBOUNCE_MS = 700;

let win = null;
let lcu = new LcuClient();
let champions = null;
let patch = null;
let analyzer = new Analyzer({ model: 'sonnet' });

let lastSignature = null;
let aiTimer = null;
let aiRunId = 0;
let pollTimer = null;
let readyInfo = null;
let lastAiAt = 0;
let prevIsMyTurn = false;
let aiBusy = false;
let pendingRun = null;
let uggRoles = null;   // u.gg primary roles, null until loaded
let idByName = {};
let gameData = null;
let lastOpponent = null;
let overlay = null;
let overlayPayload = null;
let overlayEnabled = true;
let liveSignature = null;
let polling = false;
let schedulerId = 0;
let counterId = 0;
let currentBaseline = null;
let tunedBuild = null;
let roleOverride = null;
let opponentOverrideId = null;

function applyOverrides(state) {
  if (roleOverride) { state.myPosition = roleOverride; if (state.me) state.me.position = roleOverride; }
  state.opponentOverrideId = opponentOverrideId;
  return state;
}

function publishItems(state, roles) {
  const baseline = currentBaseline && currentBaseline.championId === state.me.championId &&
    currentBaseline.role === state.myPosition ? currentBaseline : null;
  const tuned = tunedBuild && tunedBuild.championId === state.me.championId &&
    tunedBuild.signature === inventorySignature(state) ? tunedBuild.build : null;
  overlayPayload = itemAdvice(state, champions, gameData, roles, baseline, tuned);
  send('items', overlayPayload);
  if (!overlay || overlay.isDestroyed()) return;
  overlay.webContents.send('items', overlayPayload);
  if (overlayPayload && overlayEnabled) overlay.showInactive();
  else overlay.hide();
}

function send(channel, payload) {
  if (process.env.COACH_DEBUG && channel === 'ai') {
    const bits = [payload.status];
    if (payload.picks) bits.push('picks=' + payload.picks.length);
    if (payload.elapsed) bits.push('elapsed=' + payload.elapsed + 'ms');
    if (payload.message) bits.push(payload.message);
    console.log('[ai] ' + bits.join(' '));
  }
  if (process.env.COACH_DEBUG && channel === 'counters') {
    console.log('[counters] ' + (payload
      ? payload.opponent + ' -> ' + payload.list.length + ' entries'
      : 'none (no opponent or no stats)'));
  }
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function champView(id) {
  if (!id || !champions[id]) return null;
  const c = champions[id];
  const a = attributesFor(c);
  return { id: c.id, name: c.name, slug: c.slug, img: squareUrl(patch, c.slug), damage: a.damage };
}

// Everything the renderer needs, already resolved - keeps the UI logic dumb.
function toViewModel(state, analysis) {
  const player = (p) => ({
    position: p.position,
    isLocal: p.isLocal,
    champion: champView(p.championId),
    hovered: champView(p.hoveredId),
  });
  return {
    myPosition: state.myPosition,
    isMyTurn: state.isMyTurn,
    myActionType: state.myActionType,
    timeLeft: state.timeLeft,
    myTeam: state.myTeam.map(player),
    theirTeam: state.theirTeam.map(player),
    allyBans: state.allyBans.map(champView).filter(Boolean),
    enemyBans: state.enemyBans.map(champView).filter(Boolean),
    analysis,
    opponentOverrideId,
  };
}

// u.gg knows every champion's real role distribution, including ones too new for
// the bundled lane table. Falls back to that table when the fetch failed.
function lanesLookup(name) {
  if (uggRoles) {
    const id = idByName[name];
    const roles = id && uggRoles[id];
    if (roles && roles.length) return roles;
  }
  return lanesFor(name);
}

/**
 * Which champion the matchup statistics should be about.
 *
 * Picking and banning ask mirrored questions of the same data. For a pick the
 * subject is the enemy laner, and "who beats the subject" is your shortlist. For
 * a ban the subject is the champion YOU intend to play, and the same list is
 * what you should be denying.
 */
function statsFocus(state, roles) {
  if (state.myActionType === 'ban') {
    const mine = state.me && (state.me.championId || state.me.hoveredId);
    if (!mine || !champions[mine]) return null;
    return { mode: 'ban', id: mine, name: champions[mine].name };
  }
  if (!roles.opponent) return null;
  return { mode: 'pick', id: idByName[roles.opponent], name: roles.opponent };
}

// Returns null whenever u.gg is unavailable, and the prompt simply omits the
// section rather than failing.
function gatherStats(state, roles) {
  const focus = statsFocus(state, roles);
  if (!state.myPosition || !focus || !focus.id) return Promise.resolve(null);
  return ugg.buildLaneStats({
    opponentId: focus.id,
    opponentName: focus.name,
    mode: focus.mode,
    role: state.myPosition,
    patch,
    champions,
    unavailable: state.unavailable,
  });
}

/**
 * Your lane opponent dominates the answer, so an analysis that predates their
 * pick is largely wasted. This is the one case where abandoning a run in flight
 * beats waiting for it. Bumping the run id first orphans its callbacks so the
 * cancellation is not reported to the UI as a failure.
 */
function preemptAi() {
  if (!aiBusy) return;
  aiRunId++;
  analyzer.cancel();
}

// u.gg answers in milliseconds once cached, so the statistical counters can be on
// screen long before Claude finishes writing. This is what you read when the pick
// timer is nearly out.
async function pushCounters(state, roles) {
  const requestId = ++counterId;
  if (isLockedIn(state)) return send('counters', null);
  const focus = statsFocus(state, roles);
  if (!focus) {
    const list = blindPicks(state, champions, analyzeDraft(state, champions));
    return send('counters', list.length ? { mode: 'blind',
      warning: roles.warning, enemies: roles.picked, list: list.map((p) => ({ ...p,
        img: squareUrl(patch, champions[p.championId].slug) })) } : null);
  }
  let stats = null;
  try { stats = await gatherStats(state, roles); } catch (_) { stats = null; }
  if (requestId !== counterId) return;
  if (!stats) return send('counters', { opponent: focus.name, mode: focus.mode, list: [],
    unavailable: true, totalGames: 0 });

  send('counters', {
    opponent: stats.opponent,
    mode: stats.mode || 'pick',
    asOf: stats.asOf,
    patch: stats.patch, tier: stats.tier, fallback: stats.fallback,
    totalGames: stats.totalGames,
    list: stats.counters.slice(0, 6).map((c) => {
      const champ = champions[c.championId];
      return {
        name: c.name,
        winRate: c.winRate,
        games: c.games,
        img: champ ? squareUrl(patch, champ.slug) : null,
        damage: champ ? attributesFor(champ).damage : null,
      };
    }),
  });
}

// Turns Claude's item names back into ids so the UI can show icons, and keeps the
// statistical baseline alongside the tuned advice.
function shapeBuild(parsed, baseline) {
  const byItemName = {};
  if (gameData) {
    for (const id of Object.keys(gameData.itemNames)) {
      if (!gameData.itemMeta[id] || gameData.itemMeta[id].purchasable !== true) continue;
      byItemName[gameData.itemNames[id].toLowerCase()] = id;
    }
  }
  const resolve = (name) => {
    if (!name) return null;
    const raw = String(name).trim();
    // The model sometimes qualifies a name ("Seeker's Armguard (rush)"), which
    // would otherwise lose the icon. Try the bare item name too.
    const bare = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const id = byItemName[raw.toLowerCase()] || byItemName[bare.toLowerCase()];
    return id ? { id, name: gameData.itemNames[id], note: bare !== raw ? raw.slice(bare.length).trim() : null }
              : { id: null, name: raw, note: null };
  };
  const entry = (e) => {
    if (!e || typeof e.item !== 'string') return null;
    const it = resolve(e.item);
    if (!it || !it.id) return null;
    return {
      name: it ? it.name : e.item,
      id: it ? it.id : null,
      note: it ? it.note : null,
      why: e.why || '',
      insteadOf: e.insteadOf || null,
      keep: e.keep,
    };
  };
  const core = Array.isArray(parsed.core) ? parsed.core.map(entry).filter(Boolean) : [];
  const situational = Array.isArray(parsed.situational) ? parsed.situational.map(entry).filter(Boolean) : [];
  const isBoot = (it) => gameData && gameData.itemMeta[it.id] && gameData.itemMeta[it.id].boots;
  const bootCandidates = [parsed.boots && entry(parsed.boots), ...core, ...situational].filter(Boolean).filter(isBoot);
  const boots = singleBootChoice(bootCandidates, gameData ? gameData.itemMeta : {},
    lastState && lastState.me ? lastState.me.items : []);
  return {
    summary: parsed.summary || '',
    boots: boots[0] || null,
    core: core.filter((it) => !isBoot(it)),
    situational: situational.filter((it) => !isBoot(it)),
    baseline: {
      games: baseline.games,
      patch: baseline.patch, tier: baseline.tier, fallback: baseline.fallback,
      winRate: baseline.winRate,
      opening: baseline.opening ? { ...baseline.opening,
        names: baseline.opening.items.map((id) => gameData.itemNames[id] || String(id)) } : null,
      spells: baseline.spells.map((x) => (gameData ? gameData.spellNames[x] : x) || x),
      starting: baseline.starting.map((x) => (gameData ? gameData.itemNames[x] : x) || x),
      boots: baseline.boots && gameData ? gameData.itemNames[baseline.boots] : null,
      core: baseline.core.map((c) => ({
        name: (gameData ? gameData.itemNames[c.id] : null) || String(c.id),
        id: String(c.id),
        winRate: c.winRate,
        games: c.games, lowSample: c.lowSample,
      })),
      skills: baseline.skillOrder ? baseline.skillOrder.split('').join(' > ') : null,
    },
  };
}

function isLockedIn(state) {
  return !!(state.me && state.me.championId);
}

async function runAi(state, analysis) {
  const runId = ++aiRunId;
  const started = Date.now();
  const roles = inferEnemyRoles(state, champions, lanesLookup);

  // Champion locked: switch from "what should I pick" to "how do I build to beat
  // this team", which is the only question still open.
  if (isLockedIn(state)) {
    publishItems(state, roles);
    const build = gameData ? await ugg.championBuild(state.me.championId, state.myPosition, patch, gameData.itemMeta)
      .catch(() => null) : null;
    if (runId !== aiRunId) return;
    currentBaseline = build;
    publishItems(lastState || state, inferEnemyRoles(lastState || state, champions, lanesLookup));
    const bp = build && buildBuildPrompt(state, analysis, champions, gameData, build, { patch, enemyRoles: roles });
    if (bp) {
      send('ai', { status: 'running', mode: 'build', startedAt: started });
      return analyzer.run(bp, {}).then((raw) => {
        if (runId !== aiRunId) return;
        if (lastState && inventorySignature(lastState) !== inventorySignature(state)) return;
        const parsed = extractJson(raw);
        if (!parsed) return send('ai', { status: 'error', message: 'Claude did not return usable JSON.' });
        const shaped = shapeBuild(parsed, build);
        tunedBuild = { championId: state.me.championId, signature: inventorySignature(state), build: shaped };
        publishItems(lastState || state, inferEnemyRoles(lastState || state, champions, lanesLookup));
        send('ai', {
          status: 'done',
          mode: 'build',
          build: shaped,
          elapsed: Date.now() - started,
        });
      }).catch((err) => {
        if (runId !== aiRunId) return;
        send('ai', { status: 'error', message: err.message });
      });
    }
    send('ai', { status: 'done', mode: 'build', build: {
      summary: 'Statistical build unavailable. Use the lane and item options above.', core: [], situational: [] }, elapsed: Date.now() - started });
    return;
  }
  const basedOn = state.theirTeam
    .map((p) => (p.championId && champions[p.championId] ? champions[p.championId].name : null))
    .filter(Boolean);
  const stats = await gatherStats(state, roles).catch(() => null);
  if (runId !== aiRunId) return;
  const prompt = buildPrompt(state, analysis, champions, {
    patch, stats, enemyRoles: roles, lanesLookup,
  });

  send('ai', { status: 'running', startedAt: started });

  let lastCount = 0;
  return analyzer.run(prompt, {
    onDelta: (_chunk, full) => {
      if (runId !== aiRunId) return;
      const partial = progressivePicks(full);
      if (partial.length > lastCount) {
        lastCount = partial.length;
        const shaped = validate({ picks: partial }, lastState || state, champions);
        send('ai', { status: 'streaming', picks: shaped.picks, rejected: shaped.rejected, startedAt: started });
      }
    },
  }).then((raw) => {
    if (runId !== aiRunId) return;
    const parsed = extractJson(raw);
    if (!parsed) {
      return send('ai', { status: 'error', message: 'Claude did not return usable JSON.', raw: raw.slice(0, 400) });
    }
    const result = validate(parsed, lastState || state, champions);
    if (stats && stats.matchups) {
      for (const p of result.picks) {
        const wr = ugg.winRateAgainst(stats.matchups, p.championId);
        if (wr && wr.games >= 300) {
          p.winRate = wr.winRate;
          p.winRateGames = wr.games;
          p.versus = stats.opponent;
        }
      }
    }
    send('ai', { status: 'done', ...result, basedOn, opponent: roles.opponent, elapsed: Date.now() - started });
  }).catch((err) => {
    if (runId !== aiRunId) return;
    send('ai', { status: 'error', message: err.message });
  });
}

// An analysis takes longer than the gap between draft actions, so cancelling the
// running one on every pick meant none ever finished. Runs are serialised
// instead: a newer draft state waits its turn rather than killing the run in
// flight, and the last finished answer stays on screen until it is replaced.
function finishAi() {
  aiBusy = false;
  if (!pendingRun) return;
  const next = pendingRun;
  pendingRun = null;
  startAi(next.state, next.analysis);
}

function startAi(state, analysis) {
  if (aiBusy) {
    pendingRun = { state, analysis };
    send('ai', { status: 'queued' });
    return;
  }
  aiBusy = true;
  const ticket = ++schedulerId;
  lastAiAt = Date.now();
  Promise.resolve(runAi(state, analysis)).catch((err) => {
    if (ticket === schedulerId) send('ai', { status: 'error', message: err.message });
  }).finally(() => { if (ticket === schedulerId) finishAi(); });
}

function scheduleAi(state, analysis, urgent) {
  clearTimeout(aiTimer);
  aiTimer = setTimeout(() => startAi(state, analysis), state.live ? 12000 : urgent ? 200 : AI_DEBOUNCE_MS);
}

let lastState = null;
let lastAnalysis = null;

// COACH_MOCK=1 renders a sample draft without a live game, for testing the UI.
function mockSession() {
  const { buildSession } = require('../../test/fixture');
  const byName = {};
  for (const k of Object.keys(champions)) byName[champions[k].name] = parseInt(k, 10);
  const session = buildSession((n) => byName[n]);
  // COACH_MOCK=build locks my champion, which switches the app into build advice.
  if (process.env.COACH_MOCK === 'build') {
    session.myTeam[3].championId = byName.Orianna;
    session.actions = [[]];
  }
  return session;
}

async function tick() {
  if (polling) return;
  polling = true;
  try {
    if (process.env.COACH_MOCK) {
      const state = applyOverrides(parseSession(mockSession()));
      const analysis = analyzeDraft(state, champions);
      lastState = state;
      lastAnalysis = analysis;
      send('state', { status: 'draft', draft: toViewModel(state, analysis) });
      if (isLockedIn(state)) publishItems(state, inferEnemyRoles(state, champions, lanesLookup));
      const sig = signature(state);
      if (sig !== lastSignature) {
        lastSignature = sig;
        const roles = inferEnemyRoles(state, champions, lanesLookup);
        lastOpponent = roles.opponent;
        pushCounters(state, roles);
        scheduleAi(state, analysis, state.isMyTurn && !prevIsMyTurn);
      }
      prevIsMyTurn = state.isMyTurn;
      return;
    }

    // Game data is independent of the launcher, which may close/minimize during a match.
    const live = parseLiveGame(await readLiveGame(), champions, lastState);
    if (live) {
      applyOverrides(live);
      if (!liveSignature) {
        clearTimeout(aiTimer);
        preemptAi();
        pendingRun = null;
      }
      lastState = live;
      lastAnalysis = analyzeDraft(live, champions);
      send('state', { status: 'live', draft: toViewModel(live, lastAnalysis) });
      publishItems(live, inferEnemyRoles(live, champions, lanesLookup));
      const sig = inventorySignature(live) + ':' + opponentOverrideId;
      if (sig !== liveSignature) {
        liveSignature = sig;
        scheduleAi(live, lastAnalysis, false);
      }
      return;
    }
    const phase = await lcu.getPhase();
    if (['InProgress', 'GameStart', 'Reconnect'].includes(phase)) {
      if (overlayPayload && overlay) overlay.webContents.send('items', { ...overlayPayload,
        disconnected: true });
      return;
    }
    if (phase !== 'ChampSelect') {
      // The draft is over - this is the one place a running analysis is dropped.
      {
        clearTimeout(aiTimer);
        aiRunId++;
        schedulerId++;
        counterId++;
        analyzer.cancel();
        aiBusy = false;
        pendingRun = null;
      }
      lastSignature = null;
      prevIsMyTurn = false;
      lastOpponent = null;
      lastState = null;
      lastAnalysis = null;
      liveSignature = null;
      currentBaseline = null;
      tunedBuild = null;
      overlayPayload = null;
      opponentOverrideId = null;
      send('items', null);
      if (overlay) overlay.hide();
      return send('state', { status: 'waiting', phase: phase || 'Unknown' });
    }

    const session = await lcu.getSession();
    const state = parseSession(session);
    if (!state) return send('state', { status: 'waiting', phase: 'ChampSelect (loading)' });
    applyOverrides(state);

    const analysis = analyzeDraft(state, champions);
    const justLocked = isLockedIn(state) && (!lastState || !isLockedIn(lastState));
    lastState = state;
    lastAnalysis = analysis;
    send('state', { status: 'draft', draft: toViewModel(state, analysis) });
    if (isLockedIn(state)) publishItems(state, inferEnemyRoles(state, champions, lanesLookup));
    else { overlayPayload = null; if (overlay) overlay.hide(); send('items', null); }
    if (justLocked) preemptAi();

    const sig = signature(state);
    if (sig !== lastSignature) {
      lastSignature = sig;
      const roles = inferEnemyRoles(state, champions, lanesLookup);
      const focus = statsFocus(state, roles);
      const focusKey = focus ? focus.mode + ':' + focus.id : null;
      const opponentChanged = focusKey !== lastOpponent;
      lastOpponent = focusKey;

      // Refresh the instant counter list; cached u.gg data makes this ~free.
      pushCounters(state, roles);

      // Learning who you actually face outranks finishing an analysis that did
      // not know it.
      if (opponentChanged) preemptAi();

      const urgent = (state.isMyTurn && !prevIsMyTurn) || (opponentChanged && !!focus);
      scheduleAi(state, analysis, urgent);
    }
    prevIsMyTurn = state.isMyTurn;
  } catch (err) {
    const msg = err.message === 'CLIENT_NOT_FOUND'
      ? 'League client not running'
      : err.message;
    send('state', { status: 'error', message: msg });
    if (overlayPayload && overlay) overlay.webContents.send('items', { ...overlayPayload, disconnected: true });
  } finally {
    polling = false;
  }
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(tick, POLL_MS);
  tick();
}

function createWindow() {
  win = new BrowserWindow({
    width: 560,
    height: 940,
    minWidth: 420,
    minHeight: 600,
    title: 'LoL Draft Coach',
    backgroundColor: '#0a0e14',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  const bounds = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  overlay = new BrowserWindow({ x: bounds.x + 12, y: bounds.y + 12,
    width: 380, height: Math.min(540, bounds.height - 24), frame: false, show: false,
    focusable: false, skipTaskbar: true, resizable: false, alwaysOnTop: true,
    backgroundColor: '#101722', webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true);
  overlay.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
  globalShortcut.register('CommandOrControl+Shift+O', () => {
    overlayEnabled = !overlayEnabled;
    if (overlayEnabled && overlayPayload) overlay.showInactive(); else overlay.hide();
  });
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    overlay.setPosition(area.x + 12, area.y + 12);
  });
  win.on('closed', () => app.quit());
}

app.whenReady().then(() => {
  createWindow();

  // Load data and start polling only once the renderer can receive messages,
  // otherwise the first 'ready' event is delivered to nobody.
  win.webContents.on('did-finish-load', async () => {
    if (champions) {
      send('ready', readyInfo);
      return;
    }
    try {
      const data = await loadChampions();
      champions = data.champions;
      patch = data.version;
      idByName = {};
      for (const k of Object.keys(champions)) idByName[champions[k].name] = parseInt(k, 10);
      readyInfo = { patch, championCount: Object.keys(champions).length };
      loadGameData().then((g) => {
        gameData = g;
        lastSignature = null;
        if (process.env.COACH_DEBUG) {
          console.log('[gamedata] ' + (g ? Object.keys(g.itemNames).length + ' items' : 'unavailable'));
        }
      });
      ugg.loadPrimaryRoles(patch).then((r) => {
        uggRoles = r;
        // Anything inferred before this arrived used the rougher local table, so
        // force the next tick to redo it with the real role data.
        lastSignature = null;
        if (process.env.COACH_DEBUG) {
          console.log('[ugg] primary roles: ' + (r ? Object.keys(r).length + ' champions' : 'unavailable'));
        }
      });
      send('ready', readyInfo);
      startPolling();
    } catch (err) {
      send('state', { status: 'error', message: 'Could not load champion data: ' + err.message });
    }
  });
});

ipcMain.handle('init', () => readyInfo);
ipcMain.handle('items-init', () => overlayPayload);
ipcMain.handle('set-role', (_e, role) => {
  roleOverride = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'].includes(role) ? role : null;
  lastSignature = null;
  liveSignature = null;
  return roleOverride;
});
ipcMain.handle('set-opponent', (_e, id) => {
  opponentOverrideId = lastState && lastState.theirTeam.some((p) => p.championId === Number(id))
    ? Number(id) : null;
  lastSignature = null;
  liveSignature = null;
  return opponentOverrideId;
});

ipcMain.handle('refresh', () => {
  if (lastState && lastAnalysis) {
    lastAiAt = Date.now();
    clearTimeout(aiTimer);
    startAi(lastState, lastAnalysis);
    return true;
  }
  return false;
});

ipcMain.handle('set-model', (_e, model) => {
  preemptAi();
  analyzer.cancel();
  analyzer = new Analyzer({ model });
  return model;
});

ipcMain.handle('set-always-on-top', (_e, value) => {
  if (win) win.setAlwaysOnTop(!!value);
  return !!value;
});

app.on('window-all-closed', () => { app.quit(); });
app.on('will-quit', () => { globalShortcut.unregisterAll(); analyzer.cancel(); clearInterval(pollTimer); clearTimeout(aiTimer); });
