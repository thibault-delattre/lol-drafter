'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(CACHE_DIR, 'champions.cache.json');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('TIMEOUT')); });
  });
}

async function fetchFromDdragon() {
  const versions = await fetchJson('https://ddragon.leagueoflegends.com/api/versions.json');
  const version = versions[0];
  const data = await fetchJson(
    `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`);

  const champions = {};
  for (const key of Object.keys(data.data)) {
    const c = data.data[key];
    champions[c.key] = {
      id: parseInt(c.key, 10),
      slug: c.id,               // "Aatrox" - used for image URLs
      name: c.name,             // "Aatrox" - display name
      tags: c.tags,             // ["Fighter","Tank"]
      attackRange: c.stats.attackrange,
      partype: c.partype,
    };
  }
  return { version, champions };
}

// Returns { version, champions: { [id]: {...} } }, preferring the network but
// falling back to the on-disk cache so the app still works offline.
async function loadChampions() {
  try {
    const fresh = await fetchFromDdragon();
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(fresh));
    return fresh;
  } catch (err) {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
    throw err;
  }
}

// Item, rune and summoner-spell names, so build advice can be written in words
// rather than numeric ids. Cached next to the champion list.
async function loadGameData() {
  const cacheFile = path.join(CACHE_DIR, 'gamedata.cache.json');
  try {
    const versions = await fetchJson('https://ddragon.leagueoflegends.com/api/versions.json');
    const version = versions[0];
    const base = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US`;
    const [items, runes, spells] = await Promise.all([
      fetchJson(`${base}/item.json`),
      fetchJson(`${base}/runesReforged.json`),
      fetchJson(`${base}/summoner.json`),
    ]);

    const itemNames = {};
    const itemMeta = {};
    for (const id of Object.keys(items.data)) {
      const it = items.data[id];
      itemNames[id] = it.name;
      itemMeta[id] = {
        gold: (it.gold && it.gold.total) || 0,
        consumable: !!(it.tags && it.tags.includes('Consumable')),
        boots: !!(it.tags && it.tags.includes('Boots')),
        trinket: !!(it.tags && it.tags.includes('Trinket')),
        purchasable: !!(it.gold && it.gold.purchasable) && !!(it.maps && it.maps['11']) && !it.requiredAlly,
        description: it.description.replace(/<[^>]*>/g, ' '),
        tags: it.tags || [],
        stats: it.stats || {},
        from: it.from || [],
        into: it.into || [],
      };
    }

    const runeNames = {};
    for (const tree of runes) {
      runeNames[tree.id] = tree.name;
      for (const slot of tree.slots) for (const p of slot.runes) runeNames[p.id] = p.name;
    }

    const spellNames = {};
    for (const key of Object.keys(spells.data)) {
      const sp = spells.data[key];
      spellNames[sp.key] = sp.name;
    }

    const data = { version, itemNames, itemMeta, runeNames, spellNames };
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(data));
    return data;
  } catch (err) {
    if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    return null;
  }
}

function squareUrl(version, slug) {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${slug}.png`;
}

module.exports = { loadChampions, loadGameData, squareUrl };
