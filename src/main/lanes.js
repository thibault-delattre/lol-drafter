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
        Yasuo, Yone, Zed, Ziggs, Zoe, Ambessa, Vel'Koz, Kayle`,

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
  const entries = names.map((name) => ({ name, lanes: lanesOf(name) || [] }));

  // Every (champion, lane) pairing, tagged with how strongly that champion
  // belongs in that lane - position 0 is their main lane.
  const pairs = [];
  entries.forEach((e, order) => {
    e.lanes.forEach((role, rank) => {
      pairs.push({ name: e.name, role, rank, order, breadth: e.lanes.length });
    });
  });

  // Settle the most confident pairings first, so a flex pick cannot claim a lane
  // another champion mains - Kled takes Top ahead of Neeko whichever order they
  // were picked in. Rank comes first (u.gg lists a champion's real main lane
  // first); breadth breaks ties for sources that only say which lanes are
  // plausible, letting a one-lane Teemo beat a three-lane Gragas to Top.
  pairs.sort((a, b) => a.rank - b.rank || a.breadth - b.breadth || a.order - b.order);

  const assigned = {};
  const placed = new Set();
  for (const p of pairs) {
    if (placed.has(p.name) || assigned[p.role]) continue;
    assigned[p.role] = p.name;
    placed.add(p.name);
  }

  const unplaced = entries.filter((e) => !placed.has(e.name)).map((e) => e.name);
  return { assigned, unplaced };
}

module.exports = { lanesFor, assignRoles, ROLES };
