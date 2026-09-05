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
  for (const text of (data.alerts || []).slice(0, 2)) {
    const p = document.createElement('p'); p.textContent = text; notes.appendChild(p);
  }
  const options = document.getElementById('options');
  options.replaceChildren();
  for (const item of data.options.slice(0, 4)) {
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
  if (!data.options.length) options.textContent = 'No additional item suggestion';
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
