'use strict';
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { champions } = require('../src/data/champions.cache.json');
const data = require('../src/data/gamedata.cache.json');
const { simulate } = require('../src/main/simulation');
const fixtures = require('../test/simulation-fixtures');
const ugg = require('../src/main/ugg');
const example = require('../docs/examples/worked-example.json');
let win;
function offlineProvider() {
  const file = path.resolve(__dirname, '../docs/examples/baselines.json');
  const records = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  return { championBuild: async (id, role) => records.find(b => b.championId === id && b.role === role) || null };
}
ipcMain.handle('sim-init', () => ({ fixtures: [...fixtures, example.liveInput], patch: data.version,
  champions: Object.values(champions).map(c => c.name),
  items: Object.entries(data.itemNames).filter(([id]) => data.itemMeta[id]?.purchasable).map(([id, name]) => ({ id, name })) }));
ipcMain.handle('sim-run', async (_event, spec, online) => {
  try { return { result: await simulate(spec, champions, data, online === true ? ugg : offlineProvider()),
    source: online ? 'u.gg: current fetch or cache, patch shown in results' : 'Offline: recorded build snapshots; no matchup fetch, no Claude' }; }
  catch (error) { return { error: error.message }; }
});
app.whenReady().then(async () => {
  console.log('Opening Draft Coach laboratory…');
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  win = new BrowserWindow({ width: Math.min(1400, area.width), height: Math.min(950, area.height),
    x: area.x, y: area.y, show: false, backgroundColor: '#09121b',
    webPreferences: { preload: path.join(__dirname, 'simulator-preload.js'), contextIsolation: true, nodeIntegration: false } });
  win.setMenuBarVisibility(false);
  win.on('closed', () => { win = null; });
  win.webContents.on('render-process-gone', (_event, details) => console.error('Laboratory renderer stopped:', details.reason));
  await win.loadFile(path.resolve(__dirname, '../src/renderer/simulator.html'));
  win.show();
  win.focus();
  console.log('Laboratory window opened. Keep this terminal running; close the window to exit.');
}).catch(error => { console.error('Could not open laboratory:', error); app.exit(1); });
app.on('window-all-closed', () => app.quit());
