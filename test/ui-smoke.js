'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { itemAdvice } = require('../src/main/items');
const { parseLiveGame } = require('../src/main/live');
const { champions } = require('../src/data/champions.cache.json');
const gameData = require('../src/data/gamedata.cache.json');
const errors = [];
const raw = { activePlayer: { riotId: 'Coach#EUW' }, gameData: { gameTime: 100 }, allPlayers: [
  { riotId: 'Coach#EUW', championName: 'Dr. Mundo', position: 'TOP', team: 'ORDER', items: [] },
  { championName: 'Vayne', position: 'TOP', team: 'CHAOS', items: [{ itemID: 3031 }] },
  { championName: 'Vladimir', position: 'MIDDLE', team: 'CHAOS', items: [] },
  { championName: 'Jinx', position: 'BOTTOM', team: 'CHAOS', items: [{ itemID: 3031 }] }
] };
const state = parseLiveGame(raw, champions);
const payload = itemAdvice(state, champions, gameData, { opponent: 'Vayne' });
ipcMain.handle('init', () => ({ patch: gameData.version, championCount: Object.keys(champions).length }));
ipcMain.handle('items-init', () => payload);
const interactions = [];
let authorClicks = 0;
ipcMain.handle('overlay-interactive', (_e, value) => interactions.push(value));
ipcMain.handle('overlay-author', () => { authorClicks++; });
app.whenReady().then(async () => {
  const make = () => {
    const w = new BrowserWindow({ show: false, width: 380, height: 540, frame: false,
      webPreferences: { preload: path.resolve(__dirname, '../src/main/preload.js'), contextIsolation: true, nodeIntegration: false } });
    w.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
    return w;
  };
  try {
    const overlay = make();
    overlay.setSize(320, 390);
    await overlay.loadFile(path.resolve(__dirname, '../src/renderer/overlay.html'));
    await overlay.webContents.executeJavaScript('window.coach.itemsInit().then(render)');
    const text = await overlay.webContents.executeJavaScript('document.body.innerText');
    assert.ok(text.includes('Silver Bolts'));
    assert.ok(text.includes("Randuin's Omen"));
    assert.ok(text.includes('Bramble'));
    const size = await overlay.webContents.executeJavaScript('({height:document.documentElement.scrollHeight,client:window.innerHeight})');
    assert.ok(size.height <= size.client, 'overlay is clipped: ' + JSON.stringify(size));
    assert.ok(await overlay.webContents.executeJavaScript('document.querySelector("main").scrollHeight <= document.querySelector("main").clientHeight'), 'item content clipped');
    const images = await overlay.webContents.executeJavaScript(`Promise.all([...document.images].map(async img => {
      await img.decode(); return img.naturalWidth > 0;
    }))`);
    assert.equal(images.length, 4);
    assert.ok(images.every(Boolean), 'item icons must load');
    await overlay.webContents.executeJavaScript(`
      document.getElementById('author').dispatchEvent(new MouseEvent('mousemove', {bubbles:true}));
      document.getElementById('author').click();
      document.body.dispatchEvent(new MouseEvent('mousemove', {bubbles:true}));
      window.coach.itemsInit();
    `);
    assert.deepEqual(interactions, [true, false]);
    assert.equal(authorClicks, 1);
    fs.mkdirSync(path.resolve(__dirname, 'artifacts'), { recursive: true });
    fs.writeFileSync(path.resolve(__dirname, 'artifacts/overlay.png'), (await overlay.webContents.capturePage()).toPNG());
    const main = make();
    await main.loadFile(path.resolve(__dirname, '../src/renderer/index.html'));
    main.webContents.send('ai', { status: 'done', mode: 'build', build: { summary: 'test', core: [] } });
    assert.equal(await main.webContents.executeJavaScript('document.getElementById("recsSection").hidden'), true);
    main.webContents.send('state', { status: 'waiting', phase: 'Lobby' });
    assert.equal(await main.webContents.executeJavaScript('document.getElementById("recsSection").hidden'), false);
    main.webContents.send('ai', { status: 'done', picks: [], avoid: [], rejected: [] });
    assert.equal(await main.webContents.executeJavaScript('document.getElementById("buildSection").hidden'), true);
    main.webContents.send('counters', { opponent: 'Vayne', list: [], totalGames: 0, unavailable: true });
    assert.ok(await main.webContents.executeJavaScript('document.getElementById("counters").innerText.includes("unavailable")'));
    main.webContents.send('counters', { mode: 'blind', enemies: ['Diana', 'Xayah', 'Viktor', 'Karma'],
      list: [{ name: 'Gragas', why: 'Magic damage and disengage.', risk: 'Counterpick still possible.' }] });
    assert.ok(await main.webContents.executeJavaScript('document.getElementById("counters").innerText.includes("Gragas")'));
    assert.ok(await main.webContents.executeJavaScript('document.getElementById("countersTitle").innerText.includes("unknown")'));
    const order = await main.webContents.executeJavaScript(`
      renderRoster(document.getElementById('myTeam'), [
        {position:'Bot'}, {position:'Jungle'}, {position:'Mid'}, {position:'Top',isLocal:true}, {position:'Support'}
      ], true);
      [...document.querySelectorAll('#myTeam .role')].map(n=>n.innerText).join(',');
    `);
    assert.equal(order, 'Bot,Jungle,Mid,Top,Support');
    assert.deepEqual(errors, []);
    console.log('PASS: overlay rendering, fit, item rules, and second-draft renderer reset');
    app.exit(0);
  } catch (err) { console.error(err); app.exit(1); }
});
