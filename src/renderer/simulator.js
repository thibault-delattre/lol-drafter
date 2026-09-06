'use strict';
const $ = id => document.getElementById(id);
let catalog; let timer; let revision = 0; let previous = '';
let playbackTimer; let playing = false; let frameIndex = 0; let playbackGeneration = 0;
let draftFrames = DraftTimeline.frames('blue');
function pauseDraft() {
  playing = false; clearTimeout(playbackTimer); playbackGeneration++;
  $('play').textContent = '▶ Continuer';
}
async function showFrame() {
  const frame = draftFrames[frameIndex];
  $('turnLabel').textContent = frame.label;
  $('banList').textContent = 'Bans : ' + (frame.spec.bans.join(' · ') || 'en attente');
  $('editor').value = JSON.stringify(frame.spec, null, 2);
  $('turnOrder').replaceChildren();
  DraftTimeline.order.forEach((side, i) => {
    const token = document.createElement('span');
    token.className = 'turn-token ' + side + (frame.active?.pick === i + 1 ? ' active' : '');
    token.textContent = (side === 'blue' ? 'B' : 'R') + (i + 1);
    $('turnOrder').append(token);
  });
  await run();
  if (frame === draftFrames[frameIndex] && frame.phase === 'complete') { pauseDraft(); $('play').textContent = '✓ Draft terminée'; }
}
async function playbackTick(generation) {
  if (!playing || generation !== playbackGeneration) return;
  if (frameIndex < draftFrames.length - 1) frameIndex++;
  await showFrame();
  if (playing && generation === playbackGeneration) playbackTimer = setTimeout(() => playbackTick(generation), Number($('speed').value));
}
function resetDraft() {
  pauseDraft(); clearTimeout(timer); revision++;
  draftFrames = DraftTimeline.frames($('side').value); frameIndex = 0;
  $('allyTitle').textContent = 'Mon équipe · ' + ($('side').value === 'blue' ? 'Bleu' : 'Rouge');
  $('enemyTitle').textContent = 'Adversaires · ' + ($('side').value === 'blue' ? 'Rouge' : 'Bleu');
  $('play').textContent = '▶ Lancer la draft';
  showFrame();
}
$('play').onclick = () => {
  if (playing) return pauseDraft();
  if (frameIndex === draftFrames.length - 1) resetDraft();
  playing = true; $('play').textContent = '⏸ Pause';
  const generation = ++playbackGeneration;
  playbackTimer = setTimeout(() => playbackTick(generation), Number($('speed').value));
};
$('step').onclick = async () => { pauseDraft(); if (frameIndex < draftFrames.length - 1) frameIndex++; await showFrame(); };
$('restart').onclick = resetDraft; $('side').onchange = resetDraft;
function card(parent, image, name, detail) {
  const row = document.createElement('div'); row.className = 'card';
  if (image) { const img = document.createElement('img'); img.src = image; img.alt = name; row.append(img); }
  const text = document.createElement('div'); const b = document.createElement('b'); b.textContent = name;
  const p = document.createElement('p'); p.textContent = detail || ''; text.append(b, p); row.append(text); parent.append(row);
}
async function run() {
  const current = ++revision;
  let spec;
  try { spec = JSON.parse($('editor').value); }
  catch (error) { $('status').textContent = 'JSON invalide : ' + error.message; return; }
  $('status').textContent = 'Calcul…';
  const response = await window.simulator.run(spec, $('online').checked);
  if (current !== revision) return;
  if (response.error) { $('status').textContent = response.error; return; }
  const r = response.result;
  $('title').textContent = r.title; $('status').textContent = response.source;
  $('summary').textContent = 'Lane : ' + (r.roles.opponent || 'inconnue') + ' · ' + (r.roles.warning || '') + ' · Patch ' + r.patch;
  $('roster').replaceChildren();
  for (let i = 0; i < 5; i++) for (const team of ['myTeam','theirTeam']) {
    const p = r.draft[team][i]; const c = p && (p.champion || p.hovered);
    card($('roster'), c && c.img, c ? c.name : 'Non choisi',
      (p && p.position || 'Rôle incertain') + (p?.hovered ? ' · survol, non verrouillé' : p?.champion ? ' · verrouillé' : ''));
    $('roster').lastElementChild.classList.toggle('hover', !!p?.hovered);
  }
  $('results').replaceChildren();
  for (const check of r.checks) card($('results'), null, (check.pass ? '✓ ' : '✗ ') + check.label,
    'Attendu : ' + JSON.stringify(check.expected) + ' · Obtenu : ' + JSON.stringify(check.actual));
  for (const p of r.counters && r.counters.list || []) card($('results'), p.img, p.name,
    p.why || p.winRate + '% WR · ' + p.games + ' parties');
  if (r.counters && !r.counters.list.length) card($('results'), null,
    r.draft.myActionType === 'ban' ? 'Bans en cours' : 'Aucune recommandation statistique',
    r.draft.myActionType === 'ban' ? 'Les picks commencent après les dix bans.' : 'Activez u.gg ou vérifiez les échantillons disponibles.');
  if (r.items) {
    card($('results'), null, r.items.planLabel, r.items.alerts.join(' · '));
    for (const p of r.items.plan) card($('results'), p.image, p.name + (p.owned ? ' ✓ possédé' : ''), p.why);
    for (const p of [...r.items.starting, ...r.items.components]) card($('results'), p.image, p.name, p.shortWhy);
    if (!r.items.planComplete) for (const p of r.items.options) card($('results'), p.image, p.name, p.shortWhy);
  }
  const signature = JSON.stringify({ lane: r.roles.opponent, picks: r.counters?.list.map(p => p.name),
    plan: r.items?.plan.map(p => p.name), target: r.items?.target?.name, threats: r.items?.profile });
  $('changes').textContent = previous ? signature === previous ? 'Priorités inchangées.' : 'Lane, recommandations ou menaces modifiées. Le résultat affiché a été recalculé.' : 'Premier calcul.';
  previous = signature; $('raw').textContent = JSON.stringify(r, null, 2);
}
function loadPreset() { pauseDraft(); revision++; $('turnLabel').textContent = 'Scénario statique · relancer la draft pour reprendre'; $('editor').value = JSON.stringify(catalog.fixtures[$('preset').value], null, 2); run(); }
$('run').onclick = run; $('online').onchange = run; $('preset').onchange = loadPreset;
$('next').onclick = () => { $('preset').selectedIndex = ($('preset').selectedIndex + 1) % catalog.fixtures.length; loadPreset(); };
$('editor').oninput = () => { pauseDraft(); revision++; clearTimeout(timer); timer = setTimeout(run, 600); };
$('itemSearch').oninput = () => { $('itemResults').textContent = catalog.items.filter(it => it.name.toLowerCase().includes($('itemSearch').value.toLowerCase())).slice(0, 25).map(it => it.id + ' — ' + it.name).join('\n'); $('itemResults').style.whiteSpace = 'pre-line'; };
$('export').onclick = () => {
  try { JSON.parse($('editor').value); } catch (_) { $('status').textContent = 'Corrigez le JSON avant export.'; return; }
  const url = URL.createObjectURL(new Blob([$('editor').value], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'draft-scenario.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('import').onchange = async () => { pauseDraft(); const file = $('import').files[0]; if (file) { $('editor').value = await file.text(); run(); } };
window.simulator.init().then(value => { catalog = value;
  value.fixtures.forEach((f, i) => { const option = document.createElement('option'); option.value = i; option.textContent = f.title; $('preset').append(option); });
  resetDraft();
});
