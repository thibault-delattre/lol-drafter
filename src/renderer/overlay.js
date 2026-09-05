'use strict';
let lastContent;
function render(data) {
  if (!data) return;
  // Polling must not reload portraits or disturb the link under the cursor.
  const content = JSON.stringify({ ...data, updatedAt: undefined });
  if (content === lastContent) return;
  lastContent = content;
  document.getElementById('champion').textContent = data.champion;
  document.getElementById('lane').textContent = data.laneLabel;
  const status = document.getElementById('status');
  status.textContent = data.disconnected ? 'Stale' : data.live ? 'Live' : 'Locked in';
  status.className = data.disconnected ? 'stale' : '';
  const notes = document.getElementById('notes');
  notes.replaceChildren();
  for (const text of (data.alerts || []).slice(0, data.plan && data.plan.length > 1 ? 1 : 2)) {
    const p = document.createElement('p'); p.textContent = text; notes.appendChild(p);
  }
  const options = document.getElementById('options');
  options.replaceChildren();
  const plan = document.getElementById('plan');
  plan.replaceChildren();
  const hasPlan = data.plan && data.plan.length > 1;
  document.getElementById('planLabel').textContent = hasPlan ? data.planLabel : '';
  if (hasPlan) for (let i = 0; i < 6; i++) {
    const slot = document.createElement('div'); slot.className = 'plan-slot';
    const item = data.plan[i];
    if (item) {
      const img = document.createElement('img'); img.src = item.image; img.alt = item.name;
      slot.title = item.name + ' · ' + item.why;
      slot.classList.toggle('owned', item.owned);
      slot.appendChild(img);
    } else slot.textContent = '?';
    plan.appendChild(slot);
  }
  const rows = data.starting && data.starting.length ? data.starting : hasPlan
    ? data.target ? [data.target, ...(data.components || []).slice(0, 2)] : [] : data.options;
  for (const item of rows.slice(0, hasPlan ? 3 : 4)) {
    const article = document.createElement('article');
    const portrait = document.createElement('div'); portrait.className = 'portrait';
    const img = document.createElement('img'); img.alt = '';
    img.addEventListener('error', () => img.classList.add('failed'));
    if (item.image) img.src = item.image; else img.className = 'failed';
    portrait.appendChild(img);
    const copy = document.createElement('div');
    const name = document.createElement('b'); name.textContent = item.name;
    const why = document.createElement('p'); why.textContent = item.shortWhy;
    copy.append(name, why); article.append(portrait, copy); options.appendChild(article);
  }
  if (!rows.length) options.textContent = hasPlan ? 'Plan complete · keep current items' : 'No additional item suggestion';
  document.getElementById('source').textContent = data.shortSource;
}
const author = document.getElementById('author');
let interactive = false;
function setInteractive(value) {
  if (interactive === value) return;
  interactive = value;
  window.coach.overlayInteractive(value);
}
document.addEventListener('mousemove', (event) => setInteractive(author.contains(event.target)));
document.documentElement.addEventListener('mouseleave', () => setInteractive(false));
author.addEventListener('click', () => window.coach.openAuthor());
window.coach.onItems(render);
window.coach.itemsInit().then(render);
