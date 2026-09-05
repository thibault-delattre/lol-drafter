'use strict';
// Real matchup statistics from u.gg's public stats files.
//
// These endpoints are undocumented and sit behind Cloudflare, which rejects
// requests without a browser Origin/Referer. Everything here degrades to null on
// any failure so the app keeps working exactly as before when u.gg changes,
// blocks us, or the machine is offline.
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'ugg');
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12000;

// u.gg role ids, confirmed against known champion pools.
const ROLE_IDS = { Jungle: 1, Support: 2, Bot: 3, Top: 4, Mid: 5 };
const ROLE_BY_ID = { 1: 'Jungle', 2: 'Support', 3: 'Bot', 4: 'Top', 5: 'Mid' };

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Encoding': 'gzip, deflate',
  'Origin': 'https://u.gg',
  'Referer': 'https://u.gg/',
};

// "16.17.1" -> "16_17"
function patchKey(ddragonVersion) {
  const m = /^(\d+)\.(\d+)/.exec(ddragonVersion || '');
  return m ? `${m[1]}_${m[2]}` : null;
}

function previousPatch(key) {
  const m = /^(\d+)_(\d+)$/.exec(key || '');
  if (!m) return null;
  const minor = parseInt(m[2], 10);
  return minor > 1 ? `${m[1]}_${minor - 1}` : null;
}

// Cloudflare fingerprints the TLS handshake, and Node's differs from a browser's,
// so plain https.get is answered with a challenge page no matter what headers it
// sends. Electron's net module uses Chromium's own network stack and is let
// through. The https path is kept only as a fallback for running outside Electron.
function electronNet() {
  try {
    const electron = require('electron');
    return electron && electron.net && electron.net.request ? electron.net : null;
  } catch (_) {
    return null;
  }
}

function fetchViaElectron(net, url) {
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    for (const [k, v] of Object.entries(HEADERS)) {
      if (k !== 'Accept-Encoding') req.setHeader(k, v); // Chromium handles encoding
    }
    const timer = setTimeout(() => { try { req.abort(); } catch (_) {} reject(new Error('timeout')); },
                             FETCH_TIMEOUT_MS);
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        res.on('data', () => {});
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

function fetchViaHttps(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: HEADERS, timeout: FETCH_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const enc = (res.headers['content-encoding'] || '').toLowerCase();
      const stream = enc === 'gzip' ? res.pipe(zlib.createGunzip())
                   : enc === 'deflate' ? res.pipe(zlib.createInflate())
                   : res;
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
      stream.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function fetchJson(url) {
  const net = electronNet();
  return net ? fetchViaElectron(net, url) : fetchViaHttps(url);
}

function cacheRead(name) {
  try {
    const file = path.join(CACHE_DIR, name);
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) { return null; }
}

function cacheWrite(name, data) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, name), JSON.stringify(data));
  } catch (_) { /* cache is best-effort */ }
}

// Tries the current patch, then the previous one - u.gg can lag a day after a
// patch ships.
async function fetchWithPatchFallback(build, patch) {
  const tries = [patch, previousPatch(patch)].filter(Boolean);
  let lastErr = null;
  for (const p of tries) {
    try { return { data: await fetchJson(build(p)), patch: p }; }
    catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('no patch worked');
}

/**
 * Ordered role preference per champion, e.g. Teemo -> ['Top','Jungle',...].
 * Covers every champion including ones too new for the local lane table.
 */
async function loadPrimaryRoles(ddragonVersion) {
  const patch = patchKey(ddragonVersion);
  if (!patch) return null;
  const cached = cacheRead(`primary_roles_${patch}.json`);
  if (cached) return cached;

  try {
    const { data } = await fetchWithPatchFallback(
      (p) => `https://stats2.u.gg/lol/1.5/primary_roles/${p}/1.5.0.json`, patch);
    const out = {};
    for (const id of Object.keys(data)) {
      const list = Array.isArray(data[id]) ? data[id] : [];
      out[id] = list.map((r) => ROLE_BY_ID[r]).filter(Boolean);
    }
    cacheWrite(`primary_roles_${patch}.json`, out);
    return out;
  } catch (_) {
    return null;
  }
}

// The payload is [region][tier][role] = [rows, timestamp].
//
// Region 12 is World and tier 17 is Emerald+, which is the slice u.gg shows by
// default. Both were pinned down by reproducing a published u.gg figure exactly:
// Gwen 54.68% into K'Sante, top lane, Emerald+. Picking the largest bucket
// instead - as this once did - silently reports a different rank's numbers and
// will not agree with what the site shows you.
const WORLD_REGION = '12';
const EMERALD_PLUS = '17';
const MIN_BUCKET_GAMES = 3000;

function readBucket(data, region, tier, roleId) {
  const bucket = data[region] && data[region][tier] && data[region][tier][roleId];
  const rows = bucket && bucket[0];
  if (!Array.isArray(rows) || !rows.length) return null;
  let games = 0;
  for (const r of rows) games += r[2] || 0;
  return { games, rows, region, tier, asOf: typeof bucket[1] === 'string' ? bucket[1] : null };
}

function largestBucket(data, roleId) {
  let best = null;
  for (const region of Object.keys(data)) {
    const tiers = data[region];
    if (!tiers || typeof tiers !== 'object') continue;
    for (const tier of Object.keys(tiers)) {
      const b = readBucket(data, region, tier, roleId);
      if (b && (!best || b.games > best.games)) best = b;
    }
  }
  return best;
}

// Keep the population consistent even on thin patches; sample filters handle uncertainty.
function pickBucket(data, roleId) {
  return readBucket(data, WORLD_REGION, EMERALD_PLUS, roleId);
}

/**
 * How every champion performs against `championId` in `role`.
 * Rows are [opponentChampionId, wins, games], crediting the named opponent.
 * Returns null (never throws) when the data cannot be had.
 */
async function laneMatchups(championId, role, ddragonVersion) {
  const roleId = ROLE_IDS[role];
  const patch = patchKey(ddragonVersion);
  if (!roleId || !patch || !championId) return null;

  const cacheName = `matchups_v2_${patch}_${championId}_${roleId}.json`;
  const cached = cacheRead(cacheName);
  if (cached) return cached;

  try {
    const { data, patch: dataPatch } = await fetchWithPatchFallback(
      (p) => `https://stats2.u.gg/lol/1.5/matchups/${p}/ranked_solo_5x5/${championId}/1.5.0.json`,
      patch);
    const bucket = pickBucket(data, roleId);
    if (!bucket) return null;

    const against = [];
    for (const r of bucket.rows) {
      const [oppId, wins, games] = r;
      if (!Number.isFinite(games) || games <= 0 || !Number.isFinite(wins) || wins < 0 || wins > games) continue;
      // The wins in each row belong to the champion NAMED in that row, not to the
      // champion whose file this is. Reading it the other way inverts every
      // matchup - it claimed Vayne beat Teemo 62.7% when Teemo in fact wins.
      against.push({
        championId: oppId,
        games,
        wins,
        winRate: +((wins / games) * 100).toFixed(1),
      });
    }
    const result = {
      subject: championId, role, asOf: bucket.asOf, totalGames: bucket.games,
      patch: dataPatch, requestedPatch: patch, fallback: dataPatch !== patch,
      tier: bucket.tier === EMERALD_PLUS && bucket.region === WORLD_REGION ? 'Emerald+' : 'mixed ranks',
      against,
    };
    cacheWrite(cacheName, result);
    return result;
  } catch (_) {
    return null;
  }
}

/**
 * Lower bound of the Wilson score interval - the win rate we can be reasonably
 * confident is real, given the sample size. Ranking on this instead of the raw
 * percentage stops a thin sample from outranking a well-established one purely
 * because it got lucky.
 */
function wilsonLowerBound(wins, games, z = 1.96) {
  if (!games) return 0;
  const p = wins / games;
  const z2 = z * z;
  const denom = 1 + z2 / games;
  const centre = p + z2 / (2 * games);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * games)) / games);
  return ((centre - margin) / denom) * 100;
}

// Emerald+ is a far narrower slice than all-ranks: the median matchup there has
// well under a hundred games, so a floor of a few thousand leaves some champions
// with no counters at all. 300 keeps roughly 40-55 matchups per champion, and the
// confidence ordering below is what stops the thin ones from leading.
const MIN_MATCHUP_GAMES = 300;

/**
 * Champions that genuinely beat `championId` in `role`, most trustworthy first.
 * A champion below 50% is not a counter, so it is excluded outright rather than
 * padding the list - an empty result means "no reliable counter data", which the
 * caller must say plainly instead of inventing one.
 */
function rankCounters(matchups, { minGames = MIN_MATCHUP_GAMES, limit = 20 } = {}) {
  if (!matchups || !matchups.against) return [];
  return matchups.against
    .filter((m) => m.games >= minGames && m.winRate > 50)
    .map((m) => ({
      ...m,
      confidence: wilsonLowerBound(
        m.wins != null ? m.wins : (m.winRate / 100) * m.games, m.games),
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

/** The mirror image: champions that measurably lose to `championId`. */
function rankVictims(matchups, { minGames = MIN_MATCHUP_GAMES, limit = 6 } = {}) {
  if (!matchups || !matchups.against) return [];
  return matchups.against
    .filter((m) => m.games >= minGames && m.winRate < 50)
    .sort((a, b) => a.winRate - b.winRate)
    .slice(0, limit);
}

function winRateAgainst(matchups, championId) {
  if (!matchups || !matchups.against) return null;
  return matchups.against.find((m) => m.championId === championId) || null;
}

/**
 * Everything the prompt needs about the lane we are about to play: the champions
 * that beat our opponent and the ones that lose to them, named and already
 * filtered to what is still legal to pick. Null whenever u.gg is unavailable.
 */
async function buildLaneStats({ opponentId, opponentName, mode, role, patch, champions, unavailable }) {
  if (!opponentId || !role) return null;
  const m = await laneMatchups(opponentId, role, patch);
  if (!m) return null;

  const named = (x) => ({ ...x, name: champions[x.championId] ? champions[x.championId].name : null });
  const pickable = (x) => x.name && !(unavailable && unavailable.has(x.championId));

  const counters = rankCounters(m, { limit: 60 }).map(named).filter(pickable).slice(0, 14);
  const losers = rankVictims(m, { limit: 30 }).map(named).filter(pickable).slice(0, 6);


  return { opponent: opponentName, mode: mode || 'pick', asOf: m.asOf, patch: m.patch,
    tier: m.tier, fallback: m.fallback, totalGames: m.totalGames, counters, losers, matchups: m };
}

// Layout of u.gg's overview payload, confirmed by decoding a champion whose build
// is well known (Darius: Flash+Ghost, Doran's Blade, Conqueror).
const BUILD = { runes: 0, spells: 1, starting: 2, boots: 3, skills: 4, items: 5, record: 6, shards: 8 };

function pickBuildBucket(data, roleId) {
  const bucket = data && data[WORLD_REGION] && data[WORLD_REGION][EMERALD_PLUS] &&
    data[WORLD_REGION][EMERALD_PLUS][roleId];
  const secs = bucket && bucket[0];
  const record = Array.isArray(secs) && secs[BUILD.record];
  if (!Array.isArray(record) || !Number.isFinite(record[1]) || record[1] <= 0 ||
      !Number.isFinite(record[0]) || record[0] < 0 || record[0] > record[1]) return null;
  return { secs, games: record[1], asOf: typeof bucket[1] === 'string' ? bucket[1] : null };
}

// Slots contain potions and repeats of an item already bought earlier, so a raw
// "most played" pick produces nonsense like Thresh building Thornmail twice.
function pickTop(rows, { isRealItem, taken } = {}) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const usable = rows
    .filter((r) => Array.isArray(r) && r.length >= 3)
    .filter((r) => !isRealItem || isRealItem(r[0]))
    .filter((r) => !taken || !taken.has(r[0]))
    .sort((a, b) => (b[2] || 0) - (a[2] || 0));
  const best = usable[0];
  if (!best) return null;
  const games = best[2] || 0;
  return { id: best[0], games, winRate: games ? +((best[1] / games) * 100).toFixed(1) : null };
}

function rankBuildOptions(rows, { isRealItem, taken, minGames = 300 } = {}) {
  if (!Array.isArray(rows)) return [];
  const options = rows.filter((r) => Array.isArray(r) && Number.isFinite(r[1]) &&
    Number.isFinite(r[2]) && r[2] > 0 && r[1] >= 0 && r[1] <= r[2])
    .filter((r) => (!isRealItem || isRealItem(r[0])) && (!taken || !taken.has(r[0])))
    .map(([id, wins, games]) => ({ id, wins, games,
      winRate: +(100 * wins / games).toFixed(1), confidence: wilsonLowerBound(wins, games),
      lowSample: games < minGames }));
  // Compare within a purchase slot only. Late completed items naturally have inflated rates.
  const supported = options.filter((it) => !it.lowSample);
  return supported.length ? supported.sort((a, b) => b.confidence - a.confidence || b.games - a.games)
    : options.sort((a, b) => b.games - a.games); // Explicit low-sample popularity fallback.
}

function openingRecord(section) {
  if (!Array.isArray(section) || !Array.isArray(section[2])) return null;
  const [games, wins, items] = section;
  if (!Number.isFinite(games) || games <= 0 || !Number.isFinite(wins) || wins < 0 || wins > games) return null;
  return { games, wins, items, winRate: +(100 * wins / games).toFixed(1),
    confidence: wilsonLowerBound(wins, games), lowSample: games < 300 };
}

function buildCore(sections, itemMeta, limit = 3) {
  const isRealItem = (id) => {
    const m = itemMeta && itemMeta[String(id)];
    return !!m && m.purchasable !== false && !m.consumable && !m.trinket && !m.boots && m.gold >= 1600;
  };
  const core = [];
  const taken = new Set();
  // Section 3 includes the OPENING core and boots. Section 5 starts AFTER it.
  // Starting at section 5 told Mundo to rush Spirit Visage and skipped Warmog/Heartsteel.
  const opening = sections[BUILD.boots];
  for (const id of opening && Array.isArray(opening[2]) ? opening[2] : []) {
    if (!isRealItem(id) || taken.has(id)) continue;
    core.push({ id, games: opening[0], winRate: null, opening: true });
    taken.add(id);
  }
  for (const slot of Array.isArray(sections[BUILD.items]) ? sections[BUILD.items] : []) {
    if (core.length >= limit) break;
    const top = rankBuildOptions(slot, { isRealItem, taken })[0];
    if (!top) continue;
    core.push(top); taken.add(top.id);
  }
  return core.slice(0, limit);
}

/**
 * The statistically standard build for a champion in a role: runes, spells,
 * starting items and the usual first three item slots, each with its win rate.
 * Returns null (never throws) when u.gg cannot be reached.
 */
async function championBuild(championId, role, ddragonVersion, itemMeta) {
  const roleId = ROLE_IDS[role];
  const patch = patchKey(ddragonVersion);
  if (!roleId || !patch || !championId) return null;

  const cacheName = `build_v5_${patch}_${championId}_${roleId}.json`;
  const cached = cacheRead(cacheName);
  if (cached) return cached;

  try {
    const { data, patch: dataPatch } = await fetchWithPatchFallback(
      (p) => `https://stats2.u.gg/lol/1.5/overview/${p}/ranked_solo_5x5/${championId}/1.5.0.json`,
      patch);

    const best = pickBuildBucket(data, roleId);
    if (!best) return null;

    const s = best.secs;
    const sec = (i) => (Array.isArray(s[i]) ? s[i] : null);
    const runes = sec(BUILD.runes);
    const spells = sec(BUILD.spells);
    const starting = sec(BUILD.starting);
    const skills = sec(BUILD.skills);
    const itemSlots = sec(BUILD.items);
    const record = sec(BUILD.record);
    const shards = sec(BUILD.shards);

    const wins = record ? record[0] : 0;
    const games = record ? record[1] : 0;

    const result = {
      championId,
      tier: 'Emerald+', patch: dataPatch, requestedPatch: patch, fallback: dataPatch !== patch,
      role,
      asOf: best.asOf,
      games,
      winRate: games ? +((wins / games) * 100).toFixed(1) : null,
      runes: runes ? { primary: runes[2], secondary: runes[3], perks: runes[4] || [] } : null,
      shards: shards ? (shards[2] || []).map(Number) : [],
      spells: spells ? (spells[2] || []) : [],
      starting: starting ? (starting[2] || []) : [],
      skillOrder: skills ? (skills[3] || null) : null,
      core: buildCore(s, itemMeta),
      fullBuild: buildCore(s, itemMeta, 5),
      opening: openingRecord(sec(BUILD.boots)),
      alternatives: (itemSlots || []).map((rows, index) => ({ slot: index + 1,
        options: rankBuildOptions(rows, { isRealItem: (id) => {
          const m = itemMeta && itemMeta[id];
          return m && m.purchasable !== false && !m.boots && !m.consumable && !m.trinket && m.gold >= 1600;
        } }).slice(0, 3) })).filter((slot) => slot.options.length),
    };

    // Boots share the opening-build section with the first core items.
    const bootsSec = sec(BUILD.boots);
    if (bootsSec && Array.isArray(bootsSec[2]) && itemMeta) {
      const b = bootsSec[2].find((id) => itemMeta[String(id)] && itemMeta[String(id)].boots);
      if (b) result.boots = b;
    }
    cacheWrite(cacheName, result);
    return result;
  } catch (_) {
    return null;
  }
}

module.exports = {
  loadPrimaryRoles, laneMatchups, rankCounters, winRateAgainst, buildLaneStats, championBuild, pickTop, wilsonLowerBound, rankVictims, MIN_MATCHUP_GAMES,
  patchKey, previousPatch, largestBucket, pickBucket, pickBuildBucket, buildCore, rankBuildOptions, openingRecord, ROLE_IDS,
};
