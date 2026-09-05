'use strict';

const $ = (id) => document.getElementById(id);
const ROLE_ORDER = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];

let aiStartedAt = null;
let elapsedTimer = null;
let hasResult = false;
let currentEnemies = [];   // enemy champions locked right now
let adviceBasedOn = null;  // enemy champions the shown advice was built from
let buildMode = false;     // champion locked: showing item build instead of picks

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function setStatus(text, kind) {
  $('statusText').textContent = text;
  const dot = $('statusDot');
  dot.className = 'dot' + (kind ? ' ' + kind : '');
}

function showIdle(title, sub) {
  $('idle').classList.remove('off');
  $('main').classList.remove('on');
  $('idleTitle').textContent = title;
  $('idleSub').textContent = sub;
}

function showDraft() {
  $('idle').classList.add('off');
  $('main').classList.add('on');
}

// ---- roster -----------------------------------------------------------------

function renderRoster(ul, players, isAlly) {
  ul.textContent = '';
  const ordered = players; // Preserve the client slots, including pick-order swaps.

  ordered.forEach((p, i) => {
    const li = el('li', p.isLocal ? 'me' : '');
    li.appendChild(el('span', 'role', p.position || (isAlly ? '-' : 'P' + (i + 1))));

    const champ = p.champion || p.hovered;
    if (champ) {
      const img = document.createElement('img');
      img.src = champ.img;
      img.alt = champ.name;
      li.appendChild(img);
    } else {
      li.appendChild(el('div', 'slot'));
    }

    let cls = 'cname';
    let label;
    if (p.champion) {
      label = p.champion.name;
    } else if (p.hovered) {
      label = p.hovered.name;
      cls += ' hover';
    } else {
      label = p.isLocal ? 'you' : 'not picked';
      cls += ' empty';
    }
    li.appendChild(el('span', cls, label));
    ul.appendChild(li);
  });
}

function sortByRole(players) {
  const known = [];
  const unknown = [];
  for (const p of players) (p.position ? known : unknown).push(p);
  known.sort((a, b) => ROLE_ORDER.indexOf(a.position) - ROLE_ORDER.indexOf(b.position));
  return known.concat(unknown);
}

// ---- bans -------------------------------------------------------------------

function renderBans(container, ally, enemy) {
  container.textContent = '';
  const add = (list, cls) => {
    for (const c of list) {
      const d = el('div', 'ban ' + cls);
      const img = document.createElement('img');
      img.src = c.img;
      img.alt = c.name;
      img.title = c.name + ' (banned)';
      d.appendChild(img);
      container.appendChild(d);
    }
  };
  add(ally, 'ally');
  add(enemy, 'enemy');
  if (!ally.length && !enemy.length) {
    container.appendChild(el('span', 'hint', 'no bans yet'));
  }
}

// ---- composition ------------------------------------------------------------

function renderComp(node, title, t) {
  node.textContent = '';
  node.appendChild(el('h2', null, title));

  if (!t.picked) {
    node.appendChild(el('div', 'hint', 'nothing picked yet'));
    return;
  }

  const bar = el('div', 'bar');
  const ad = el('div', 'ad');
  ad.style.width = t.adPct + '%';
  const ap = el('div', 'ap');
  ap.style.width = t.apPct + '%';
  bar.appendChild(ad);
  bar.appendChild(ap);
  node.appendChild(bar);

  const split = el('div', 'split');
  split.appendChild(el('span', 'l', t.adPct + '% AD'));
  split.appendChild(el('span', 'r', t.apPct + '% AP'));
  node.appendChild(split);

  const stats = el('div', 'stats');
  const addStat = (k, v) => {
    const s = el('div', 'stat');
    s.appendChild(el('div', 'k', k));
    s.appendChild(el('div', 'v', String(v)));
    stats.appendChild(s);
  };
  addStat('Frontline', t.frontline);
  addStat('CC', t.cc);
  addStat('Engage', t.engage);
  node.appendChild(stats);

  const chips = el('div', 'chips');
  for (const g of t.gaps) chips.appendChild(el('span', 'chip gap', g));
  for (const s of t.strengths) chips.appendChild(el('span', 'chip good', s));
  if (chips.childNodes.length) node.appendChild(chips);
}

// ---- recommendations --------------------------------------------------------

function renderPicks(picks) {
  const box = $('recs');
  box.textContent = '';
  if (!picks || !picks.length) {
    box.appendChild(el('div', 'placeholder', 'Waiting for the first recommendation...'));
    return;
  }
  for (const p of picks) {
    const card = el('div', 'rec');
    if (p.slug) {
      const img = document.createElement('img');
      img.src = 'https://ddragon.leagueoflegends.com/cdn/' + (window.__patch || '') +
                '/img/champion/' + p.slug + '.png';
      img.alt = p.champ;
      card.appendChild(img);
    }
    const body = el('div', 'rec-body');
    const top = el('div', 'rec-top');
    top.appendChild(el('span', 'rec-name', p.champ));
    if (p.score != null) top.appendChild(el('span', 'score', String(p.score)));
    body.appendChild(top);

    const addLine = (label, value) => {
      if (!value) return;
      const line = el('div', 'line');
      line.appendChild(el('b', null, label));
      line.appendChild(document.createTextNode(value));
      body.appendChild(line);
    };
    // Measured win rate, when u.gg had a big enough sample for this matchup.
    if (p.winRate != null) {
      const wr = el('div', 'wr' + (p.winRate >= 50 ? ' good' : ' bad'));
      wr.appendChild(el('b', null, p.winRate + '%'));
      wr.appendChild(document.createTextNode(
        ' vs ' + p.versus + '  ·  ' + p.winRateGames.toLocaleString() + ' games'));
      body.appendChild(wr);
    }
    addLine('Lane', p.lane);
    addLine('Fit', p.fit);
    addLine('Risk', p.risk);

    card.appendChild(body);
    box.appendChild(card);
  }
}

function renderAvoid(avoid) {
  const box = $('avoid');
  box.textContent = '';
  if (!avoid || !avoid.length) return;
  box.appendChild(el('h2', null, 'Avoid'));
  for (const a of avoid) {
    box.appendChild(el('div', 'item', a.champ + ' - ' + (a.why || '')));
  }
}

function renderRejected(rejected) {
  const box = $('rejected');
  box.textContent = '';
  if (!rejected || !rejected.length) return;
  const names = rejected.map((r) => r.champ).join(', ');
  box.textContent = 'Filtered out as unavailable (banned or taken): ' + names;
}

function startElapsed() {
  stopElapsed();
  elapsedTimer = setInterval(() => {
    if (!aiStartedAt) return;
    const s = Math.round((Date.now() - aiStartedAt) / 1000);
    $('aiStatus').textContent = (hasResult ? 'refreshing... ' : 'analysing... ') + s + 's';
  }, 500);
}

function stopElapsed() {
  clearInterval(elapsedTimer);
  elapsedTimer = null;
}


// Statistical counters, straight from u.gg. These land in milliseconds, so they
// are what you read when the pick timer is nearly out.
function renderCounters(payload) {
  const section = $('countersSection');
  const box = $('counters');
  if (!payload || !payload.list) {
    section.hidden = true;
    box.textContent = '';
    return;
  }
  section.hidden = false;
  if (payload.mode === 'blind') {
    $('countersTitle').textContent = 'Blind picks · enemy laner unknown';
    $('countersMeta').textContent = 'Instant provisional advice · no matchup win-rate claim';
    box.replaceChildren(el('p', 'hint', (payload.warning || 'Enemy can counterpick your lane.') +
      ' Revealed: ' + (payload.enemies.join(', ') || 'none')));
    for (const pick of payload.list) {
      const row = el('div', 'b-item');
      if (pick.img) {
        const portrait = document.createElement('img');
        portrait.src = pick.img; portrait.alt = pick.name; portrait.className = 'blind-portrait';
        row.appendChild(portrait);
      }
      const body = el('div');
      body.append(el('b', null, pick.name), el('div', 'w', pick.why), el('div', 'hint', 'Risk: ' + pick.risk));
      row.append(body); box.append(row);
    }
    return;
  }
  // Banning inverts the question: the subject is your own champion, and the list
  // is what beats it - i.e. what is worth denying.
  $('countersTitle').textContent = payload.mode === 'ban'
    ? 'Biggest threats to ' + payload.opponent
    : 'Best into ' + payload.opponent;
  $('countersMeta').textContent = 'u.gg ' + (payload.tier || '') + ' / ' + (payload.patch || '') +
    (payload.fallback ? ' (previous patch)' : '') + ' · ' + payload.totalGames.toLocaleString() + ' games' +
    (payload.asOf ? ' · ' + String(payload.asOf).slice(0, 10) : '');

  box.textContent = '';
  if (!payload.list.length) {
    box.textContent = payload.unavailable ? 'Matchup statistics unavailable. Check your role selection or refresh later.'
      : 'No winning matchup clears the 300-game sample threshold.';
  }
  for (const c of payload.list) {
    const row = el('div', 'ctr-row');
    if (c.img) {
      const img = document.createElement('img');
      img.src = c.img;
      img.alt = c.name;
      row.appendChild(img);
    }
    row.appendChild(el('span', 'ctr-name', c.name));
    if (c.damage) row.appendChild(el('span', 'ctr-dmg', c.damage));
    row.appendChild(el('span', 'ctr-wr', c.winRate + '%'));
    row.appendChild(el('span', 'ctr-games', c.games.toLocaleString()));
    box.appendChild(row);
  }
}

// Advice generated before a new enemy pick is still useful, but you must be able
// to see that it did not know about them.
function refreshStaleWarning() {
  const warn = $('staleWarn');
  if (!adviceBasedOn || !hasResult) { warn.hidden = true; return; }
  const missing = currentEnemies.filter((n) => !adviceBasedOn.includes(n));
  if (!missing.length) { warn.hidden = true; return; }
  warn.hidden = false;
  warn.textContent = missing.join(' and ') +
    (missing.length > 1 ? ' were' : ' was') +
    ' picked after this advice was written - it does not account for ' +
    (missing.length > 1 ? 'them' : 'that') + ' yet.';
}

// Item icons come from Data Dragon by item id.
function itemIcon(id) {
  if (!id) return null;
  const img = document.createElement('img');
  img.src = 'https://ddragon.leagueoflegends.com/cdn/' + (window.__patch || '') + '/img/item/' + id + '.png';
  img.alt = '';
  return img;
}

function buildItemRow(entry, order) {
  const row = el('div', 'b-item');
  if (order != null) row.appendChild(el('div', 'b-order', String(order)));
  const icon = itemIcon(entry.id);
  if (icon) row.appendChild(icon);
  const body = el('div');
  body.style.flex = '1';
  body.style.minWidth = '0';
  const nameEl = el('div', 'n', entry.name);
  if (entry.note) nameEl.appendChild(el('span', 'b-note', ' ' + entry.note));
  body.appendChild(nameEl);
  if (entry.insteadOf) body.appendChild(el('div', 'swap', 'instead of ' + entry.insteadOf));
  if (entry.why) body.appendChild(el('div', 'w', entry.why));
  row.appendChild(body);
  return row;
}

// Shown once your champion is locked: the statistical build, bent toward the
// enemy composition.
function renderBuild(b) {
  const section = $('buildSection');
  const box = $('build');
  if (!b) { section.hidden = true; box.textContent = ''; return; }
  section.hidden = false;
  box.textContent = '';
  $('buildMeta').textContent = '';

  if (b.baseline) {
    $('buildMeta').textContent = 'u.gg ' + (b.baseline.tier || '') + ' / ' + (b.baseline.patch || '') +
      (b.baseline.fallback ? ' (previous patch)' : '') + ' · champion overall ' + b.baseline.winRate + '% · ' +
      b.baseline.games.toLocaleString() + ' games';
  }
  if (b.summary) box.appendChild(el('div', 'b-sum', b.summary));

  if (b.core && b.core.length) {
    const g = el('div', 'b-group');
    g.appendChild(el('div', 'b-label', 'Core, in order'));
    b.core.forEach((c, i) => g.appendChild(buildItemRow(c, i + 1)));
    box.appendChild(g);
  }
  if (b.boots) {
    const g = el('div', 'b-group');
    g.appendChild(el('div', 'b-label', 'Boots'));
    g.appendChild(buildItemRow(b.boots, null));
    box.appendChild(g);
  }
  if (b.situational && b.situational.length) {
    const g = el('div', 'b-group');
    g.appendChild(el('div', 'b-label', 'Situational vs this team'));
    for (const it of b.situational) g.appendChild(buildItemRow(it, null));
    box.appendChild(g);
  }

  // The unmodified statistical build, so you can see what was changed.
  const base = b.baseline;
  if (base) {
    const d = el('div', 'b-base');
    const add = (label, value) => {
      if (!value) return;
      const line = el('div');
      line.appendChild(el('b', null, label + ': '));
      line.appendChild(document.createTextNode(value));
      d.appendChild(line);
    };
    add('Standard', base.core.map((c) => c.name).join(' > '));
    if (base.opening) add('Opening combination', base.opening.names.join(' + ') + ' — ' +
      base.opening.winRate + '% / ' + base.opening.games.toLocaleString() + ' games' +
      (base.opening.lowSample ? ' (low sample)' : ''));
    for (const c of base.core) if (c.winRate != null) add(c.name + ' (later slot)',
      c.winRate + '% / ' + (c.games || 0).toLocaleString() + ' games' + (c.lowSample ? ' (low sample)' : ''));
    add('Start', base.starting.join(', '));
    add('Summoners', base.spells.join(' + '));
    add('Skills', base.skills);
    box.appendChild(d);
  }
}

// ---- wiring -----------------------------------------------------------------

function applyReady(info) {
  if (!info) return;
  window.__patch = info.patch;
  setStatus('patch ' + info.patch + ' - ' + info.championCount + ' champions', null);
}

window.coach.onCounters(renderCounters);
$('turnBanner').after($('countersSection')); // Put the instant answer above the tall roster/meters.
window.coach.onItems((data) => {
  $('itemsSection').hidden = !data;
  if (!data) return;
  $('recsSection').hidden = true;
  $('itemNotes').textContent = data.notes.join(' ');
  $('itemOptions').replaceChildren();
  if (data.plan && data.plan.length) {
    $('itemOptions').appendChild(el('p', 'hint', data.planLabel + ' · highlighted in popup; owned items kept'));
    for (const option of data.plan) $('itemOptions').appendChild(buildItemRow(option, null));
    if (data.starting.length) {
      $('itemOptions').appendChild(el('p', 'hint', 'Starting purchase'));
      for (const option of data.starting) $('itemOptions').appendChild(buildItemRow(option, null));
    }
    if (data.components.length) {
      $('itemOptions').appendChild(el('p', 'hint', 'Remaining components for ' + data.target.name));
      for (const option of data.components) $('itemOptions').appendChild(buildItemRow(option, null));
    }
    $('itemOptions').appendChild(el('p', 'hint', 'Situational options'));
  }
  for (const option of data.options) $('itemOptions').appendChild(buildItemRow(option, null));
  $('itemSource').textContent = data.source;
});
window.coach.onReady(applyReady);
window.coach.init().then(applyReady);

window.coach.onState((msg) => {
  if (msg.status === 'error') {
    setStatus(msg.message, 'err');
    showIdle('Not connected', msg.message);
    return;
  }
  if (msg.status === 'waiting') {
    setStatus('client: ' + msg.phase, null);
    hasResult = false;
    adviceBasedOn = null;
    currentEnemies = [];
    $('staleWarn').hidden = true;
    renderCounters(null);
    renderBuild(null);
    buildMode = false;
    $('recsSection').hidden = false;
    stopElapsed();
    $('aiStatus').textContent = '';
    showIdle('Waiting for champion select...', 'Currently in ' + msg.phase + '. This updates automatically.');
    return;
  }

  const d = msg.draft;
  const opponentSelect = $('opponentOverride');
  const choices = d.theirTeam.filter((p) => p.champion).map((p) => p.champion);
  const key = choices.map((c) => c.id).join(',');
  if (opponentSelect.dataset.key !== key) {
    opponentSelect.replaceChildren(new Option('Auto (inferred)', ''), ...choices.map((c) => new Option(c.name, c.id)));
    opponentSelect.dataset.key = key;
  }
  opponentSelect.value = d.opponentOverrideId || '';
  showDraft();
  setStatus(msg.status === 'live' ? 'in game · inventory updates active' :
    d.myPosition ? 'drafting as ' + d.myPosition : 'draft in progress', 'live');
  $('timer').textContent = d.timeLeft != null && d.timeLeft > 0 ? d.timeLeft : '';

  const banner = $('turnBanner');
  if (d.isMyTurn) {
    banner.hidden = false;
    banner.textContent = d.myActionType === 'ban'
      ? 'YOUR BAN - choose now'
      : 'YOUR PICK - choose now';
  } else {
    banner.hidden = true;
  }

  $('recsTitle').textContent = d.myActionType === 'ban' ? 'Recommended bans' : 'Recommended picks';

  currentEnemies = d.theirTeam.map((p) => (p.champion ? p.champion.name : null)).filter(Boolean);
  refreshStaleWarning();

  renderRoster($('myTeam'), d.myTeam, true);
  renderRoster($('theirTeam'), d.theirTeam, false);
  renderBans($('bans'), d.allyBans, d.enemyBans);
  renderComp($('compAlly'), 'Your composition', d.analysis.ally);
  renderComp($('compEnemy'), 'Enemy composition', d.analysis.enemy);
});

window.coach.onAi((msg) => {
  if (msg.status === 'running') {
    aiStartedAt = msg.startedAt || Date.now();
    buildMode = msg.mode === 'build';
    $('recsSection').hidden = buildMode;
    if (!buildMode) renderBuild(null);
    startElapsed();
    // Keep the previous answer up while refreshing - a slightly old read is far
    // more useful mid-draft than an empty panel.
    if (hasResult) {
      $('recs').classList.add('stale');
    } else {
      renderPicks([]);
      renderAvoid([]);
      renderRejected([]);
    }
    return;
  }
  if (msg.status === 'queued') {
    $('aiStatus').textContent = 'update queued';
    return;
  }
  if (msg.status === 'streaming') {
    $('recsSection').hidden = false;
    $('recs').classList.remove('stale');
    hasResult = true;
    renderPicks(msg.picks);
    renderRejected(msg.rejected);
    return;
  }
  if (msg.status === 'done' && msg.mode === 'build') {
    stopElapsed();
    hasResult = true;
    $('aiStatus').textContent = 'updated in ' + Math.round((msg.elapsed || 0) / 1000) + 's';
    $('recsSection') && ($('recsSection').hidden = true);
    renderBuild(msg.build);
    return;
  }
  if (msg.status === 'done') {
    $('recsSection').hidden = false;
    renderBuild(null);
    stopElapsed();
    $('recs').classList.remove('stale');
    hasResult = true;
    adviceBasedOn = msg.basedOn || [];
    refreshStaleWarning();
    $('aiStatus').textContent = 'updated in ' + Math.round((msg.elapsed || 0) / 1000) + 's';
    if (msg.read) {
      const box = $('recs');
      renderPicks(msg.picks);
      box.insertBefore(el('div', 'read', msg.read), box.firstChild);
    } else {
      renderPicks(msg.picks);
    }
    renderAvoid(msg.avoid);
    renderRejected(msg.rejected);
    return;
  }
  if (msg.status === 'error') {
    stopElapsed();
    $('recs').classList.remove('stale');
    $('aiStatus').textContent = 'analysis failed';
    // A failed refresh must not destroy a good earlier answer.
    if (!hasResult) {
      const box = $('recs');
      box.textContent = '';
      box.appendChild(el('div', 'placeholder', msg.message));
    }
  }
});

$('refresh').addEventListener('click', () => window.coach.refresh());
$('roleOverride').addEventListener('change', (e) => window.coach.setRole(e.target.value));
$('opponentOverride').addEventListener('change', (e) => window.coach.setOpponent(e.target.value));
$('ontop').addEventListener('change', (e) => window.coach.setAlwaysOnTop(e.target.checked));
