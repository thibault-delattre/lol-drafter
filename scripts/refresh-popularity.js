'use strict';
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { loadRolePopularity } = require('../src/main/ugg');
const { champions } = require('../src/data/champions.cache.json');
const { version } = require('../src/data/gamedata.cache.json');
app.whenReady().then(async () => {
  const result = await loadRolePopularity(version, champions);
  if (!result) { console.error('Insufficient popularity data; snapshot unchanged'); return app.exit(1); }
  fs.writeFileSync(path.resolve(__dirname, '../src/data/role-popularity.json'), JSON.stringify(result, null, 2));
  console.log(result.patch, result.loaded + '/' + result.totalChampions, 'champions');
  for (const [role, pool] of Object.entries(result.pools)) console.log(role, pool.length, pool.slice(0, 3).map(p => p.name + ' ' + p.roleShare.toFixed(1) + '%').join(', '));
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
