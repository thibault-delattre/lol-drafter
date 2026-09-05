'use strict';
const clone = value => JSON.parse(JSON.stringify(value));
const blind = { title: 'Blind Top · Diana / Xayah / Viktor / Karma', mode: 'draft', role: 'Top',
  allies: [{}, { champion: 'Viego' }, { champion: 'Yasuo' }, { champion: "Kai'Sa" }, { champion: 'Bard' }],
  enemies: [{ champion: 'Diana' }, { champion: 'Xayah' }, { champion: 'Viktor' }, { champion: 'Karma' }, {}],
  bans: ['Aatrox', 'Jax', 'Renekton', 'Camille', 'Malphite', 'Vayne'] };
const known = clone(blind); known.title = 'Known lane · Teemo Top';
blind.expect = { topPick: 'Gragas', opponent: null };
known.enemies[4] = { champion: 'Teemo', role: 'Top' };
const hover = clone(blind); hover.title = 'Hover only · Gragas'; hover.allies[0].hover = 'Gragas';
const flex = clone(blind); flex.title = 'Flex uncertainty · Nasus'; flex.bans = [];
flex.enemies = [{ champion: 'Nasus' }, { champion: 'Bard' }, { champion: 'Kayn' }, { champion: "Kai'Sa" }, {}];
flex.allies = [{}, { champion: 'Master Yi' }, { champion: 'Caitlyn' }, { champion: 'Swain' }, { champion: 'Seraphine' }];
const resolved = clone(flex); resolved.title = 'Final pick · Gnar resolves Nasus flex'; resolved.enemies[4] = { champion: 'Gnar' };
const live = { title: 'Mundo · fed AP Jax vs weak AD carries', mode: 'live', role: 'Top', time: 1500,
  allies: [{ champion: 'Dr. Mundo', items: [3047, 3083], level: 13 }, {}, {}, {}, {}],
  enemies: [{ champion: 'Jax', items: [3089, 3115, 3157], level: 17, kills: 14, assists: 8, cs: 230 },
    { champion: 'Kayn', items: [1036], level: 9 }, {},
    { champion: 'Jinx', items: [1036], level: 10, kills: 1, cs: 90 }, {}], bans: [] };
const armor = clone(live); armor.title = 'Vayne · enemy armor stacking';
armor.allies[0] = { champion: 'Vayne', items: [3006, 3153], level: 13 };
armor.enemies[0] = { champion: 'Gnar', items: [3143, 3075], level: 13, cs: 180 };
const complete = clone(armor); complete.title = 'Vayne · six slots already complete';
complete.allies[0].items = [3006, 3153, 3124, 3091, 3072, 3026];
complete.expect = { slots: 6, target: null };
resolved.expect = { opponent: 'Gnar' };
module.exports = [blind, known, hover, flex, resolved, live, armor, complete];
