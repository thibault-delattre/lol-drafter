'use strict';
// Real engine output from fictional inputs. No hand-written recommendations or AI scores.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { champions } = require('../src/data/champions.cache.json');
const data = require('../src/data/gamedata.cache.json');
const { simulate } = require('../src/main/simulation');
const fixtures = require('../test/simulation-fixtures');
const ugg = require('../src/main/ugg');
let items = null;
ipcMain.handle('init', () => ({ patch: data.version, championCount: Object.keys(champions).length }));
ipcMain.handle('items-init', () => items);
ipcMain.handle('overlay-interactive', () => null);
async function capture(win, file) {
  await win.webContents.executeJavaScript(`(async () => {
    const images = [...document.images];
    if (!images.length) throw new Error('No images rendered');
    await Promise.race([Promise.all(images.map(img => img.decode())),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Portrait timeout')), 20000))]);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
}
app.whenReady().then(async () => {
  try {
    const output = path.resolve(__dirname, '../docs/screenshots');
    const records = path.resolve(__dirname, '../docs/examples');
    fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(records, { recursive: true });
    const spec = fixtures[0];
    const draft = await simulate(spec, champions, data, ugg);
    const recommended = draft.counters.list[0].name;
    const chosen = draft.counters.list.find(p => p.name === 'Ornn').name;
    const liveSpec = { title: chosen + ' chosen from the top 3 · fed Viktor', mode: 'live', role: 'Top', time: 1500,
      allies: [{ champion: chosen, items: [3111], level: 13 }, ...spec.allies.slice(1)],
      enemies: [{ champion: 'Gnar', items: [1036], level: 11 }, { champion: 'Diana', items: [1052], level: 10 },
        { champion: 'Viktor', items: [3089, 3137, 3157], level: 17, kills: 13, assists: 9, cs: 240 },
        { champion: 'Xayah', items: [1036], level: 10 }, { champion: 'Karma', items: [1052], level: 9 }], bans: [] };
    const live = await simulate(liveSpec, champions, data, ugg);
    items = live.items;
    if (!items.planComplete) throw new Error('Statistical build is incomplete; do not publish an invented example');
    const baselines = await Promise.all([recommended, chosen, 'Dr. Mundo', 'Vayne'].map(name => {
      const champion = Object.values(champions).find(c => c.name === name);
      return ugg.championBuild(champion.id, 'Top', data.version, data.itemMeta);
    }));
    fs.writeFileSync(path.join(records, 'baselines.json'), JSON.stringify(baselines.filter(Boolean), null, 2));
    fs.writeFileSync(path.join(records, 'worked-example.json'), JSON.stringify({ generatedAt: new Date().toISOString(),
      provenance: 'Fictional draft and scoreboard; real deterministic production functions and u.gg build data. No Claude call.',
      draftInput: spec, draftResult: draft, liveInput: liveSpec, liveResult: live }, null, 2));
    const make = (width, height) => new BrowserWindow({ show: false, frame: false, width, height,
      webPreferences: { preload: path.resolve(__dirname, '../src/main/preload.js'), contextIsolation: true, nodeIntegration: false } });
    const win = make(620, 1040);
    await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'));
    win.webContents.send('state', { status: 'draft', draft: draft.draft });
    win.webContents.send('counters', draft.counters);
    await capture(win, path.join(output, 'draft-coach.png'));
    const overlay = make(320, 390);
    await overlay.loadFile(path.resolve(__dirname, '../src/renderer/overlay.html'));
    await overlay.webContents.executeJavaScript('window.coach.itemsInit().then(render)');
    await capture(overlay, path.join(output, 'item-overlay.png'));
    console.log('Actual instant recommendations:', draft.counters.list.map(p => p.name).join(', '));
    console.log('Live target:', items.target && items.target.name, '|', items.planLabel);
    console.log('Wrote screenshots + reproducible inputs, outputs and statistical snapshots.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
