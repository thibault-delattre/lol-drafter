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
    await win.webContents.executeJavaScript(`(async () => {
      document.getElementById('role').value = 'Top';
      resetDraft();
      alliedOrder = [4, 1, 3, 2, 0];
      enemyOrder = [2, 0, 4, 1, 3];
      draftFrames = DraftTimeline.frames('blue', undefined, 'Top', alliedOrder, enemyOrder);
      frameIndex = 6; await showFrame();
    })()`);
    assert.ok(await win.webContents.executeJavaScript('document.querySelector("#roster .card").innerText.includes("Support")'), 'Support must be displayed first when first in pick order');
    const duration = await win.webContents.executeJavaScript(`
      document.getElementById('play').click();
      const duration = deadline - Date.now(); pauseDraft(); duration;
    `);
    assert.ok(duration > 14500 && duration <= 15000, 'default pick duration must be 15 seconds');
    await win.webContents.executeJavaScript(`
      document.getElementById('swapMate').value = '4';
      document.getElementById('swapTurn').click();
    `);
    assert.equal(await win.webContents.executeJavaScript('draftFrames[frameIndex].spec.role'), 'Top');
    assert.equal(await win.webContents.executeJavaScript('draftFrames[frameIndex].active.slot'), 0);
    await win.webContents.executeJavaScript(`(async () => {
      resetDraft(); frameIndex = 6; await showFrame();
    })()`);
    assert.ok(await win.webContents.executeJavaScript('document.getElementById("roster").innerText.includes("survol")'));
    await win.webContents.executeJavaScript('frameIndex = 7; showFrame()');
    assert.ok(await win.webContents.executeJavaScript('document.getElementById("roster").innerText.includes("verrouillé")'));
    await win.webContents.executeJavaScript(`(async () => {
      document.getElementById('speed').value = '900';
      document.getElementById('play').click();
      await new Promise(resolve => setTimeout(resolve, 1100));
      document.getElementById('play').click();
    })()`);
    const paused = await win.webContents.executeJavaScript('frameIndex');
    assert.ok(paused > 7, 'autoplay must advance');
    await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 1100))');
    assert.equal(await win.webContents.executeJavaScript('frameIndex'), paused, 'pause must stop playback');
    await win.webContents.executeJavaScript('frameIndex = 22; showFrame()');
    await win.webContents.executeJavaScript('Promise.all([...document.images].map(img => img.decode()))');
    fs.writeFileSync(path.resolve(__dirname, 'artifacts/animated-draft.png'), (await win.webContents.capturePage()).toPNG());
    console.log('PASS: simulator presets, production calculation, portraits, custom editing and invalid JSON');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
