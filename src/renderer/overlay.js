'use strict';
function render(data) {
  if (!data) return;
  document.getElementById('champion').textContent = data.champion + ' · item options';
  const status = document.getElementById('status');
  status.textContent = data.disconnected ? 'Feed unavailable · stale' : data.live ? 'Live inventory' : 'Locked in';
  status.className = data.disconnected ? 'stale' : '';
  const notes = document.getElementById('notes');
  notes.replaceChildren();
  for (const text of data.notes.slice(0, 3)) {
    const p = document.createElement('p'); p.textContent = text; notes.appendChild(p);
  }
  const options = document.getElementById('options');
  options.replaceChildren();
  for (const item of data.options.slice(0, 4)) {
    const article = document.createElement('article');
    const name = document.createElement('b'); name.textContent = item.name;
    const why = document.createElement('p'); why.textContent = item.why;
    article.append(name, why); options.appendChild(article);
  }
  if (!data.options.length) options.textContent = 'No additional item option from the current data.';
  document.getElementById('source').textContent = data.source;
}
window.coach.onItems(render);
window.coach.itemsInit().then(render);
