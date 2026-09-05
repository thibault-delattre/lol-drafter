'use strict';
// Curated champion attributes driving the composition meters.
// Columns: name | damage type | frontline 0-2 | cc 0-3 | engage 0-1
// damage: AD, AP, MIXED (meaningful damage in both), TRUE
// frontline: 0 none, 1 bruiser/offtank, 2 full tank
// cc: 0 none, 1 light, 2 good, 3 heavy lockdown
// engage: 1 if the kit can start a teamfight on its own
const TABLE = `
Aatrox AD 1 2 1
Ahri AP 0 2 0
Akali AP 0 1 0
Akshan AD 0 1 0
Alistar AP 2 3 1
Ambessa AD 1 2 1
Amumu AP 2 3 1
Anivia AP 0 2 0
Annie AP 0 2 1
Aphelios AD 0 1 0
Ashe AD 0 2 1
Aurelion Sol AP 0 2 0
Aurora AP 0 2 0
Azir AP 0 2 1
Bard AP 0 2 0
Bel'Veth AD 1 1 0
Blitzcrank AP 2 3 1
Brand AP 0 1 0
Braum AP 2 2 0
Briar AD 1 2 1
Caitlyn AD 0 1 0
Camille AD 1 2 1
Cassiopeia AP 0 2 0
Cho'Gath AP 2 2 0
Corki MIXED 0 0 0
Darius AD 1 1 0
Diana AP 1 2 1
Dr. Mundo AD 2 1 0
Draven AD 0 1 0
Ekko AP 1 2 1
Elise AP 0 1 1
Evelynn AP 0 1 1
Ezreal AD 0 0 0
Fiddlesticks AP 0 3 1
Fiora AD 1 1 0
Fizz AP 0 2 1
Galio AP 2 3 1
Gangplank AD 0 1 0
Garen AD 2 1 0
Gnar AD 2 2 1
Gragas AP 2 2 1
Graves AD 1 1 0
Gwen AP 1 1 0
Hecarim AD 1 2 1
Heimerdinger AP 0 1 0
Hwei AP 0 2 0
Illaoi AD 1 1 0
Irelia AD 1 2 1
Ivern AP 0 2 0
Janna AP 0 2 0
Jarvan IV AD 1 2 1
Jax AD 1 1 0
Jayce AD 0 1 0
Jhin AD 0 1 0
Jinx AD 0 1 0
K'Sante AD 2 2 1
Kai'Sa MIXED 0 0 0
Kalista AD 0 1 0
Karma AP 0 1 0
Karthus AP 0 1 0
Kassadin AP 0 1 0
Katarina AP 0 0 0
Kayle MIXED 0 1 0
Kayn AD 1 1 1
Kennen AP 0 2 1
Kha'Zix AD 0 0 0
Kindred AD 0 1 0
Kled AD 1 1 1
Kog'Maw MIXED 0 0 0
LeBlanc AP 0 1 0
Lee Sin AD 1 2 1
Leona AP 2 3 1
Lillia AP 1 2 1
Lissandra AP 1 3 1
Lucian AD 0 0 0
Lulu AP 0 2 0
Lux AP 0 2 0
Malphite AP 2 3 1
Malzahar AP 0 3 0
Maokai AP 2 3 1
Master Yi AD 0 0 0
Mel AP 0 1 0
Milio AP 0 1 0
Miss Fortune AD 0 1 0
Mordekaiser AP 2 2 1
Morgana AP 0 3 0
Naafiri AD 0 1 0
Nami AP 0 2 0
Nasus AD 2 1 0
Nautilus AP 2 3 1
Neeko AP 0 2 1
Nidalee AP 0 1 0
Nilah AD 0 2 1
Nocturne AD 1 1 1
Nunu & Willump AP 2 2 1
Olaf AD 1 1 0
Orianna AP 0 2 1
Ornn AP 2 3 1
Pantheon AD 1 2 1
Poppy AP 2 2 0
Pyke AD 0 3 1
Qiyana AD 0 2 1
Quinn AD 0 1 0
Rakan AP 1 3 1
Rammus AP 2 2 1
Rek'Sai AD 1 2 1
Rell AP 2 3 1
Renata Glasc AP 0 3 0
Renekton AD 1 2 1
Rengar AD 0 1 1
Riven AD 1 2 1
Rumble AP 1 2 0
Ryze AP 0 1 0
Samira AD 0 1 0
Sejuani AP 2 3 1
Senna AD 0 2 0
Seraphine AP 0 2 0
Sett AD 2 2 1
Shaco MIXED 0 1 0
Shen AP 2 2 0
Shyvana MIXED 1 1 1
Singed AP 2 2 0
Sion AD 2 3 1
Sivir AD 0 0 0
Skarner AD 2 3 1
Smolder AD 0 1 0
Sona AP 0 1 0
Soraka AP 0 1 0
Swain AP 1 2 0
Sylas AP 1 2 0
Syndra AP 0 2 0
Tahm Kench AP 2 2 0
Taliyah AP 0 2 0
Talon AD 0 0 0
Taric AP 2 2 0
Teemo AP 0 1 0
Thresh AP 2 3 1
Tristana AD 0 1 0
Trundle AD 2 1 0
Tryndamere AD 1 1 0
Twisted Fate AP 0 2 0
Twitch AD 0 0 0
Udyr MIXED 2 1 0
Urgot AD 2 2 0
Varus AD 0 2 0
Vayne AD 0 1 0
Veigar AP 0 2 0
Vel'Koz AP 0 2 0
Vex AP 0 2 1
Vi AD 1 3 1
Viego AD 1 1 0
Viktor AP 0 2 0
Vladimir AP 0 1 0
Volibear MIXED 2 2 1
Warwick MIXED 1 2 1
Wukong AD 1 2 1
Xayah AD 0 2 0
Xerath AP 0 2 0
Xin Zhao AD 1 2 1
Yasuo AD 0 1 0
Yone MIXED 0 2 1
Yorick AD 1 1 0
Yuumi AP 0 1 0
Yunara AD 0 0 0
Zac AP 2 3 1
Zed AD 0 0 0
Zeri AD 0 1 0
Ziggs AP 0 1 0
Zilean AP 0 2 0
Zoe AP 0 2 0
Zyra AP 0 2 0
`;

const CURATED = {};
for (const line of TABLE.trim().split('\n')) {
  const parts = line.trim().split(' ');
  const engage = parseInt(parts.pop(), 10);
  const cc = parseInt(parts.pop(), 10);
  const frontline = parseInt(parts.pop(), 10);
  const damage = parts.pop();
  const name = parts.join(' ');
  CURATED[name] = { damage, frontline, cc, engage };
}

// Champions released after this table was written still need sane values, so
// derive them from Data Dragon tags rather than dropping them from the meters.
function derive(champ) {
  const tags = champ.tags || [];
  const has = (t) => tags.includes(t);
  const melee = champ.attackRange < 300;

  let damage;
  if (has('Marksman')) damage = 'AD';
  else if (has('Mage')) damage = 'AP';
  else if (has('Fighter') || has('Assassin')) damage = 'AD';
  else damage = 'AP';

  const frontline = has('Tank') ? 2 : (has('Fighter') && melee ? 1 : 0);
  const cc = has('Tank') || has('Support') ? 2 : 1;
  const engage = has('Tank') ? 1 : 0;

  return { damage, frontline, cc, engage, derived: true };
}

function attributesFor(champ) {
  return CURATED[champ.name] || derive(champ);
}

module.exports = { attributesFor, CURATED };
