'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { simulate } = require('../src/main/simulation');
const { champions } = require('../src/data/champions.cache.json');
const data = require('../src/data/gamedata.cache.json');
const fixtures = require('./simulation-fixtures');
const baselines = require('../docs/examples/baselines.json');
const provider = { championBuild: async (id, role) => baselines.find(b => b.championId === id && b.role === role) || null };
ipcMain.handle('sim-init', () => ({ fixtures, items: [{ id: '1043', name: 'Recurve Bow' }] }));
ipcMain.handle('sim-run', async (_event, spec) => {
  try { return { result: await simulate(spec, champions, data, provider), source: 'Offline recorded data' }; }
  catch (error) { return { error: error.message }; }
});
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, width: 1400, height: 950,
      webPreferences: { preload: path.resolve(__dirname, '../scripts/simulator-preload.js'), contextIsolation: true, nodeIntegration: false } });
    await win.loadFile(path.resolve(__dirname, '../src/renderer/simulator.html'));
    await win.webContents.executeJavaScript(`(async () => {
      await window.simulator.init();
      document.getElementById('editor').value = ${JSON.stringify(JSON.stringify(fixtures[0]))};
      await run();
    })()`);
    assert.ok(await win.webContents.executeJavaScript('document.getElementById("results").innerText.includes("Gragas")'));
    await win.webContents.executeJavaScript('Promise.all([...document.images].map(img => img.decode()))');
    fs.mkdirSync(path.resolve(__dirname, 'artifacts'), { recursive: true });
    fs.writeFileSync(path.resolve(__dirname, 'artifacts/simulator.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`document.getElementById('editor').value = ${JSON.stringify(JSON.stringify(fixtures[7]))}; run()`);
    assert.ok(await win.webContents.executeJavaScript('document.getElementById("results").innerText.includes("6-slot")'));
    await win.webContents.executeJavaScript("document.getElementById('editor').value = '{'; run()");
    assert.ok(await win.webContents.executeJavaScript('document.getElementById("status").innerText.includes("JSON invalide")'));
    console.log('PASS: simulator presets, production calculation, portraits, custom editing and invalid JSON');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
