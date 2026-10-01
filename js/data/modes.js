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
    loot: { weights: {}, density: 0, vaultRelicBoost: 0 },
    zone: { scale: 1 },
    hazards: [],
    music: 'mines',
  },
];

export const DEFAULT_MODE = MODES[0].id;

export function getMode(id) {
  return MODES.find((m) => m.id === id) || MODES[0];
}
