'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { champions } = require('../src/data/champions.cache.json');
const gameData = require('../src/data/gamedata.cache.json');

const outputDir = path.resolve(__dirname, '../docs/screenshots');
const byName = Object.fromEntries(Object.values(champions).map((c) => [c.name, c]));
const champ = (name) => {
  const c = byName[name];
  return c ? { id: c.id, name: c.name, slug: c.slug,
    img: `https://ddragon.leagueoflegends.com/cdn/${gameData.version}/img/champion/${c.slug}.png` } : null;
};
const player = (position, name, isLocal = false) => ({
  position, isLocal, champion: champ(name), hovered: null,
});

ipcMain.handle('init', () => ({ patch: gameData.version,
  championCount: Object.keys(champions).length }));
ipcMain.handle('items-init', () => null);
ipcMain.handle('set-role', () => null);
ipcMain.handle('set-opponent', () => null);
ipcMain.handle('refresh', () => true);
ipcMain.handle('set-always-on-top', () => false);

app.whenReady().then(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const win = new BrowserWindow({ show: false, width: 620, height: 980,
    backgroundColor: '#0a0e14', webPreferences: {
      preload: path.resolve(__dirname, '../src/main/preload.js'),
      contextIsolation: true, nodeIntegration: false,
    } });
  try {
    await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'));
    win.webContents.send('state', { status: 'draft', draft: {
      myPosition: 'Top', isMyTurn: true, myActionType: 'pick', timeLeft: 22,
      myTeam: [player('Bot', "Kai'Sa"), player('Jungle', 'Viego'), player('Mid', 'Yasuo'),
        player('Top', null, true), player('Support', 'Bard')],
      theirTeam: [player(null, 'Diana'), player(null, 'Xayah'), player(null, 'Viktor'),
        player(null, 'Karma'), player(null, null)],
      allyBans: ['Aatrox', 'Jax', 'Renekton'].map(champ),
      enemyBans: ['Camille', 'Malphite', 'Vayne'].map(champ),
      opponentOverrideId: null,
      analysis: {
        ally: { picked: 4, adPct: 63, apPct: 37, frontline: 1, cc: 4, engage: 0,
          gaps: ['Very little frontline', 'No hard engage - hard to start fights'], strengths: [] },
        enemy: { picked: 4, adPct: 25, apPct: 75, frontline: 1, cc: 7, engage: 1,
          gaps: ['Very little frontline'], strengths: [] },
      },
    } });
    win.webContents.send('counters', { mode: 'blind',
      warning: 'Enemy Top is unconfirmed. Prefer a safe blind pick that also fits the draft.',
      enemies: ['Diana', 'Xayah', 'Viktor', 'Karma'],
      list: [
        { name: 'Gragas', why: 'Safe sustain and disengage; adds magic damage and frontline.', risk: 'Mana management and execution.' },
        { name: 'Ornn', why: 'Reliable frontline and engage into the revealed backline.', risk: 'Can concede early ranged pressure.' },
        { name: 'Gnar', why: 'Range and mobility cover many unknown melee matchups.', risk: 'Rage timing decides teamfights.' },
      ] });
    win.webContents.send('ai', { status: 'done', elapsed: 8400,
      basedOn: ['Diana', 'Xayah', 'Viktor', 'Karma'],
      read: 'AP-heavy enemy core with peel and scaling; blind durable engage without sacrificing lane safety.',
      picks: [
        { championId: byName.Gragas.id, slug: byName.Gragas.slug, champ: 'Gragas', score: 91, lane: 'Safe blind with sustain and disengage.', fit: 'AP damage, frontline and engage.', risk: 'Needs clean spacing and mana use.' },
        { championId: byName.Ornn.id, slug: byName.Ornn.slug, champ: 'Ornn', score: 87, lane: 'Stable into many unrevealed tops.', fit: 'Frontline and initiation for Kai\'Sa/Yasuo.', risk: 'Limited early pressure.' },
        { championId: byName.Gnar.id, slug: byName.Gnar.slug, champ: 'Gnar', score: 83, lane: 'Range and mobility limit hard counters.', fit: 'Side-lane pressure and AoE engage.', risk: 'Rage can be mistimed.' },
      ], avoid: [], rejected: [] });
    // Fail the capture if a portrait is missing, instead of publishing empty slots.
    await win.webContents.executeJavaScript(`(async () => {
      const images = [...document.images];
      if (images.length < 14) throw new Error('Draft portraits not rendered');
      await Promise.race([
        Promise.all(images.map(img => img.decode())),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Portrait loading timed out')), 20000))
      ]);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    fs.writeFileSync(path.join(outputDir, 'draft-coach.png'),
      (await win.webContents.capturePage()).toPNG());
    console.log('Created docs/screenshots/draft-coach.png');
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
