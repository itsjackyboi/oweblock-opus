// Mines (Dig Dug's mines, Bully Hill): cave chambers joined by narrow, twisting
// tunnels with chokepoints. Close quarters.

import { T } from '../../game/map.js';
import {
  makeGrid, carveBlob, carveTunnel, smooth, sprinkle, keepLargestRegion,
  distanceField, poissonDisc, spreadPoints, openPoints, mst,
} from '../../game/mapgen.js';
import { TILE } from '../../config.js';

export function generateMines(rng, size, assets) {
  const [w, h] = size;
  const grid = makeGrid(w, h, T.WALL);

  // 1. Chambers: Poisson-disc centers, wobbly blobs of varied size.
  const centers = poissonDisc(9, 9, w - 9, h - 9, 19, rng, () => true, 24);
  const chambers = centers.map((p) => ({
    x: Math.round(p.x),
    y: Math.round(p.y),
    r: rng.chance(0.25) ? rng.range(8, 10.5) : rng.range(4.5, 7.5),
  }));
  for (const c of chambers) carveBlob(grid, w, h, c.x, c.y, c.r, rng);
  sprinkle(grid, w, h, 0.1, rng);
  smooth(grid, w, h, 2, 5, 4);

  // 2. Tunnels: spanning tree plus a few loops so there are alternative routes.
  const edges = mst(chambers);
  for (let i = 0; i < chambers.length; i++) {
    for (let j = i + 1; j < chambers.length; j++) {
      const a = chambers[i];
      const b = chambers[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < 30 && rng.chance(0.22) && !edges.some(([p, q]) => (p === i && q === j) || (p === j && q === i))) {
        edges.push([i, j]);
      }
    }
  }
  for (const [i, j] of edges) {
    const a = chambers[i];
    const b = chambers[j];
    const width = rng.chance(0.35) ? 2 : 3; // width 2 = chokepoint
    carveTunnel(grid, w, h, a.x, a.y, b.x, b.y, width, rng, 0.18);
  }
  smooth(grid, w, h, 1, 6, 3); // soften tunnel edges without closing them

  // 3. Connectivity: unreachable pockets are filled in.
  keepLargestRegion(grid, w, h);

  // 4. Deepest chamber (relic vault later): farthest walk from the most central chamber.
  let central = chambers[0];
  let bestC = Infinity;
  for (const c of chambers) {
    const d = Math.hypot(c.x - w / 2, c.y - h / 2);
    if (grid[c.y * w + c.x] === T.FLOOR && d < bestC) { bestC = d; central = c; }
  }
  const dist = distanceField(grid, w, h, central.x, central.y);
  let deepest = central;
  for (const c of chambers) {
    const d = dist[c.y * w + c.x];
    if (d > (dist[deepest.y * w + deepest.x] ?? -1)) deepest = c;
  }
  const liveChambers = chambers.filter((c) => dist[c.y * w + c.x] >= 0);

  // 5. Floor deco (rubble, cracks) from the tileset's deco role.
  const deco = new Int16Array(w * h).fill(-1);
  const decoList = assets?.tileset('mines')?.roles?.deco || [];
  if (decoList.length) {
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === T.FLOOR && rng.chance(0.025)) deco[i] = rng.pick(decoList);
    }
  }

  // 6. Spawn points: well-spread open floor, in pixels.
  const cands = openPoints(grid, w, h, TILE);
  const spawns = spreadPoints(cands, 110, 48, rng);

  // 7. Loot clusters in chambers; the vault is the deepest chamber.
  const inChamber = (c, p, k) => Math.hypot(p.x / TILE - c.x, p.y / TILE - c.y) < c.r * k;
  const chamberCands = cands.filter((p) => liveChambers.some((c) => inChamber(c, p, 0.9)));
  const lootPoints = spreadPoints(chamberCands, 52, 0, rng);
  const vaultPoints = spreadPoints(cands.filter((p) => inChamber(deepest, p, 0.8)), 20, 3, rng).slice(0, 3);

  return { w, h, tiles: grid, deco, meta: { chambers: liveChambers, central, deepest, spawns, lootPoints, vaultPoints } };
}
