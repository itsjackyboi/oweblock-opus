// Match modes. One entry per mode; the engine never refers to a mode id directly.
// Loot, zone and hazards are filled in by later stages.

import { generateMines } from './maps/mines.js';

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
    hazards: [],
    music: 'mines',
  },
];

export const DEFAULT_MODE = MODES[0].id;

export function getMode(id) {
  return MODES.find((m) => m.id === id) || MODES[0];
}
