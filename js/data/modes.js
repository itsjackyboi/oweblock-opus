// Match modes. One entry per mode; the engine never refers to a mode id directly.
//   tileset    manifest tileset id      size        map size in tiles
//   generate   (rng, size, assets) -> { w, h, tiles, deco, meta }
//   loot       weights per item id (x rarity), density, relic share, vault boost
//   zone       { scale } multiplies the police sweep timings
//   hazards    [{ type, ...params }] (js/game/hazards.js)
//   fall       what a fall into a pit costs: { damage } and/or { maxHpFrac, stun }
//   pitsWalkable  walking can take you over the edge (otherwise only knockback/dash ends do)
//   hint       one line shown on the mode card

import { generateMines } from './maps/mines.js';
import { generateRooftops } from './maps/rooftops.js';
import { generatePipePit } from './maps/pipepit.js';

export const MODES = [
  {
    id: 'mines',
    name: 'MINES',
    place: "DIG DUG'S MINES, BULLY HILL",
    tileset: 'mines',
    size: [120, 120],
    generate: generateMines,
    background: '#472d3c', // drawn outside the map
    // Loot: weight per item id (x rarity weight), density = share of loot points
    // filled at match start; vault points get relics boosted.
    loot: {
      weights: {
        cutlass: 1, shiv: 1, wagwans_whopper: 1, keg_flail: 1, singing_bow: 1, gaol_arbalest: 1,
        drifters_call: 1, beast_hook: 1, bully_hill_mantrap: 2.2, ancient_pot: 1, powder_keg: 1,
        old_staff: 1, veilwalker_net: 1, sad_sermon: 1,
        wolendi_wind_pouch: 1, clockheart_tonic: 1.2, amethyst_shard: 2.2,
      },
      density: 0.55,
      relicShare: 0.06,
      vaultRelicBoost: 6,
    },
    zone: { scale: 1.1 }, // sweep timings x1.1: about 7:15 until it fully closes
    hazards: [
      { type: 'darkness', light: 130, otherLight: 56, fireLight: 40 },
      { type: 'caveIn', every: [5, 9], shadow: 1.2, radius: 20, damage: 25, stun: 0.8 },
    ],
    fall: { damage: 20 },
    pitsWalkable: true,
    hint: 'DARK TUNNELS, CAVE-INS, VOID PITS',
    music: 'mines',
  },
  {
    id: 'rooftops',
    name: 'ROOFTOPS',
    place: 'THE FINAL GANG WAR',
    tileset: 'rooftops',
    size: [100, 100],
    generate: generateRooftops,
    background: '#1a1c2c',
    loot: {
      weights: {
        cutlass: 1, shiv: 1, wagwans_whopper: 1, keg_flail: 1, singing_bow: 2.2, gaol_arbalest: 1.3,
        drifters_call: 1, beast_hook: 2.2, bully_hill_mantrap: 0.8, ancient_pot: 1, powder_keg: 1,
        old_staff: 1, veilwalker_net: 1, sad_sermon: 1,
        wolendi_wind_pouch: 2.2, clockheart_tonic: 1, amethyst_shard: 1,
      },
      density: 0.6,
      relicShare: 0.06,
      vaultRelicBoost: 8,
    },
    zone: { scale: 1.1 },
    hazards: [{ type: 'skylight', crack: 1, fall: { maxHpFrac: 0.15, stun: 0.8 } }],
    fall: { maxHpFrac: 0.15, stun: 0.8 },
    pitsWalkable: false,
    hint: 'ALLEY GAPS, PLANKS, CRACKING SKYLIGHTS',
    music: 'rooftops',
  },
  {
    id: 'pipepit',
    name: 'PIPE PIT',
    place: "MICKEY'S PIPE CLUB",
    tileset: 'pipepit',
    size: [110, 110],
    generate: generatePipePit,
    background: '#2a1d24',
    loot: {
      weights: {
        cutlass: 1, shiv: 1, wagwans_whopper: 2.2, keg_flail: 2.2, singing_bow: 1, gaol_arbalest: 1,
        drifters_call: 1, beast_hook: 1, bully_hill_mantrap: 1, ancient_pot: 2.2, powder_keg: 1.4,
        old_staff: 1, veilwalker_net: 1, sad_sermon: 1,
        wolendi_wind_pouch: 1, clockheart_tonic: 1, amethyst_shard: 1,
      },
      density: 0.7,
      relicShare: 0.06,
      vaultRelicBoost: 8,
    },
    zone: { scale: 1.1 },
    hazards: [
      { type: 'conveyor', speed: 55 },
      { type: 'vent', every: [4, 8], hiss: 1, burst: 0.6, radius: 18, damage: 14, knockback: 220 },
    ],
    fall: { damage: 20 },
    pitsWalkable: false,
    hint: 'CONVEYORS, STEAM VENTS, OPEN PIT',
    music: 'pipepit',
  },
];

export const DEFAULT_MODE = MODES[0].id;

export function getMode(id) {
  return MODES.find((m) => m.id === id) || MODES[0];
}
