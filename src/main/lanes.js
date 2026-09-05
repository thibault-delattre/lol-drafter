'use strict';
// Which lanes each champion actually gets played in. Riot's own data only exposes
// classes (Teemo is "marksman/mage"), which cannot tell you he is a toplaner, so
// this is curated. Champions may appear in several lanes.
const BY_LANE = {
  Top: `Aatrox, Akali, Ambessa, Aurora, Camille, Cho'Gath, Darius, Dr. Mundo, Fiora, Gangplank,
        Garen, Gnar, Gragas, Gwen, Heimerdinger, Illaoi, Irelia, Jax, Jayce, K'Sante, Kayle,
        Kennen, Kled, Malphite, Maokai, Mordekaiser, Nasus, Olaf, Ornn, Pantheon, Poppy, Quinn,
        Renekton, Riven, Rumble, Sett, Shen, Singed, Sion, Sylas, Tahm Kench, Teemo, Trundle,
        Tryndamere, Udyr, Urgot, Vayne, Vladimir, Volibear, Warwick, Wukong, Yasuo, Yone, Yorick,
        Zac, Swain, Rengar, Briar, Mel`,

  Jungle: `Amumu, Bel'Veth, Briar, Diana, Ekko, Elise, Evelynn, Fiddlesticks, Gragas, Graves,
        Gwen, Hecarim, Ivern, Jarvan IV, Jax, Karthus, Kayn, Kha'Zix, Kindred, Lee Sin, Lillia,
        Master Yi, Maokai, Naafiri, Nidalee, Nocturne, Nunu & Willump, Olaf, Poppy, Rammus,
        Rek'Sai, Rengar, Sejuani, Shaco, Shyvana, Skarner, Talon, Trundle, Udyr, Vi, Viego,
        Volibear, Warwick, Wukong, Xin Zhao, Zac, Zed, Diana, Kayn`,

  Mid: `Ahri, Akali, Akshan, Anivia, Annie, Aurelion Sol, Aurora, Azir, Brand, Cassiopeia, Corki,
        Diana, Ekko, Fizz, Galio, Gragas, Heimerdinger, Hwei, Irelia, Kassadin, Katarina, LeBlanc,
        Lissandra, Lux, Malzahar, Mel, Naafiri, Neeko, Orianna, Pantheon, Qiyana, Ryze, Seraphine,
        Swain, Sylas, Syndra, Taliyah, Talon, Twisted Fate, Veigar, Vex, Viktor, Vladimir, Xerath,
        Yasuo, Yone, Zed, Ziggs, Zoe, Ambessa, Vel'Koz, Kayle, Nasus`,

  Bot: `Aphelios, Ashe, Caitlyn, Corki, Draven, Ezreal, Jhin, Jinx, Kai'Sa, Kalista, Kog'Maw,
        Lucian, Miss Fortune, Nilah, Samira, Senna, Sivir, Smolder, Tristana, Twitch, Varus,
        Vayne, Xayah, Yunara, Zeri, Ziggs, Seraphine, Karthus, Swain`,

  Support: `Alistar, Bard, Blitzcrank, Brand, Braum, Janna, Karma, Leona, Lulu, Lux, Maokai,
        Milio, Morgana, Nami, Nautilus, Neeko, Pantheon, Poppy, Pyke, Rakan, Rell, Renata Glasc,
        Senna, Seraphine, Shen, Sona, Soraka, Swain, Taric, Thresh, Vel'Koz, Xerath, Yuumi,
        Zilean, Zyra, Amumu, Zac, Velkoz`,
};

const ROLES = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];

const LANES_BY_NAME = {};
for (const role of ROLES) {
  for (const raw of BY_LANE[role].split(',')) {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!name) continue;
    if (!LANES_BY_NAME[name]) LANES_BY_NAME[name] = [];
    if (!LANES_BY_NAME[name].includes(role)) LANES_BY_NAME[name].push(role);
  }
}

function lanesFor(name) {
  return LANES_BY_NAME[name] || [];
}

/**
 * Best-guess role for each enemy champion. Riot hides enemy assigned positions in
 * ranked, so this is inference: champions with the fewest plausible lanes are
 * placed first, which pins single-lane picks (Teemo -> Top) before flexible ones.
 * Returns { role: championName } plus the names it could not place.
 */
function assignRoles(names, lookup) {
  const lanesOf = lookup || lanesFor;
  const entries = names.map((name) => {
    const raw = lanesOf(name) || [];
    const supported = lanesFor(name);
    // The provider lists ALL five lanes, including fringe play. They are not five plausible roles.
    const lanes = supported.length ? raw.filter((r) => supported.includes(r)) : raw.slice(0, 1);
    return { name, lanes };
  }).sort((a, b) => a.lanes.length - b.lanes.length || a.name.localeCompare(b.name));

  // Optimize the whole assignment: Diana can jungle, but Viktor needs Mid. A greedy
  // Diana->Mid assignment previously pushed Viktor into a fictitious Top matchup.
  let best = { count: -1, cost: Infinity, assigned: {} };
  function visit(i, assigned, count, cost) {
    if (i === entries.length) {
      if (count > best.count || (count === best.count && cost < best.cost))
        best = { count, cost, assigned: { ...assigned } };
      return;
    }
    const entry = entries[i];
    entry.lanes.forEach((role, rank) => {
      if (assigned[role]) return;
      assigned[role] = entry.name;
      visit(i + 1, assigned, count + 1, cost + rank);
      delete assigned[role];
    });
    visit(i + 1, assigned, count, cost);
  }
  visit(0, {}, 0, 0);
  const assigned = best.assigned;
  const placed = new Set(Object.values(assigned));
  return { assigned, unplaced: names.filter((name) => !placed.has(name)) };
}

module.exports = { lanesFor, assignRoles, ROLES };
