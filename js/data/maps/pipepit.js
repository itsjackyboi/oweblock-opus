// Pipe Pit (Mickey's Pipe Club fight pit): a big open central pit ringed by a maze
// of pipe-walled corridors with conveyors and steam vents; long sightlines across
// the pit. High-value loot sits in the pit (risky); crates line the conveyors.

import { T, DECO_FLIP_X, DECO_FLIP_Y } from '../../game/map.js';
import { makeGrid, carveDisc, carveTunnel, keepLargestRegion, spreadPoints, openPoints, mst } from '../../game/mapgen.js';
import { TILE } from '../../config.js';

export function generatePipePit(rng, size, assets) {
  const [w, h] = size;
  const grid = makeGrid(w, h, T.WALL);
  const deco = new Int16Array(w * h).fill(-1);
  const roles = assets?.tileset('pipepit')?.roles || {};
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const PIT_R = 19;

  // 1. Maze cells on a grid outside the pit; corridors between neighbors (tree + loops).
  const CELL = 8;
  const cells = [];
  const key = (i, j) => `${i},${j}`;
  const cellAt = new Map();
  for (let j = 0; j * CELL + 6 < h - 4; j++) {
    for (let i = 0; i * CELL + 6 < w - 4; i++) {
      const x = 6 + i * CELL;
      const y = 6 + j * CELL;
      const d = Math.hypot(x - cx, y - cy);
      if (d < PIT_R + 4) continue;
      const c = { i, j, x, y };
      cells.push(c);
      cellAt.set(key(i, j), c);
    }
  }
  const pts = cells.map((c) => ({ x: c.x, y: c.y }));
  const links = mst(pts).map(([a, b]) => [cells[a], cells[b]]);
  for (const c of cells) {
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const n = cellAt.get(key(c.i + di, c.j + dj));
      if (n && rng.chance(0.3)) links.push([c, n]);
    }
  }
  const segs = [];
  for (const [a, b] of links) {
    // Only straight links between grid neighbors read as corridors; long MST links bend once.
    if (a.x === b.x || a.y === b.y) {
      carveTunnel(grid, w, h, a.x, a.y, b.x, b.y, 4, rng, 0);
      segs.push([a, b]);
    } else {
      carveTunnel(grid, w, h, a.x, a.y, b.x, a.y, 4, rng, 0);
      carveTunnel(grid, w, h, b.x, a.y, b.x, b.y, 4, rng, 0);
    }
  }

  // 2. The pit, and 6 ways in from the maze.
  carveDisc(grid, w, h, cx, cy, PIT_R);
  const ring = rng.shuffle(cells.filter((c) => Math.hypot(c.x - cx, c.y - cy) < PIT_R + 13));
  for (const c of ring.slice(0, 6)) carveTunnel(grid, w, h, c.x, c.y, cx, cy, 4, rng, 0);
  keepLargestRegion(grid, w, h);

  // 3. Floors: checker pit, caution ring, plain corridors.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (grid[i] !== T.FLOOR) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d < PIT_R - 1.5) { if (roles.pitFloor?.length) deco[i] = roles.pitFloor[0]; }
      else if (d < PIT_R + 0.5) { if (roles.stripe?.length) deco[i] = roles.stripe[0]; }
    }
  }

  // 4. Conveyors along some straight corridors (2 tiles wide, down the middle).
  const conveyors = [];
  for (const [a, b] of rng.shuffle(segs).slice(0, Math.floor(segs.length * 0.18))) {
    const horiz = a.y === b.y;
    const sgn = rng.sign();
    const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    for (let t = horiz ? x0 : y0; t <= (horiz ? x1 : y1); t++) {
      for (let k = 0; k <= 1; k++) { // corridor tiles span x-1..x+2: the middle two
        const x = horiz ? t : a.x + k;
        const y = horiz ? a.y + k : t;
        const i = y * w + x;
        if (grid[i] !== T.FLOOR || Math.hypot(x - cx, y - cy) < PIT_R + 1) continue;
        conveyors.push({ tx: x, ty: y, dx: horiz ? sgn : 0, dy: horiz ? 0 : sgn });
        const f = horiz ? roles.conveyorH : roles.conveyorV;
        if (f?.length) deco[i] = f[0] | (horiz && sgn < 0 ? DECO_FLIP_X : 0) | (!horiz && sgn > 0 ? DECO_FLIP_Y : 0);
      }
    }
  }
  const onBelt = new Set(conveyors.map((c) => c.ty * w + c.tx));

  // 5. Crates beside the belts (single solid tiles), never closing a corridor.
  const crates = [];
  for (const c of conveyors) {
    if (!rng.chance(0.06)) continue;
    for (const [ox, oy] of c.dx ? [[0, -2], [0, 1]] : [[-2, 0], [1, 0]]) {
      const x = c.tx + ox;
      const y = c.ty + oy;
      const i = y * w + x;
      if (grid[i] !== T.FLOOR || onBelt.has(i)) continue;
      // Keep the far side open: the tile beyond must be wall (we're at the corridor edge).
      const bx = x + Math.sign(ox);
      const by = y + Math.sign(oy);
      if (grid[by * w + bx] !== T.WALL) continue;
      grid[i] = T.WALL;
      if (roles.crate?.length) deco[i] = rng.pick(roles.crate);
      crates.push({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
      break;
    }
  }

  // 6. Steam vents in corridors and the pit.
  const cands = openPoints(grid, w, h, TILE).filter((p) => !onBelt.has(Math.floor(p.y / TILE) * w + Math.floor(p.x / TILE)));
  const vents = spreadPoints(cands, 120, 0, rng).slice(0, 18).map((p) => ({ x: p.x, y: p.y }));
  for (const v of vents) {
    const i = Math.floor(v.y / TILE) * w + Math.floor(v.x / TILE);
    if (roles.vent?.length) deco[i] = roles.vent[0];
  }
  const ventSet = new Set(vents.map((v) => Math.floor(v.y / TILE) * w + Math.floor(v.x / TILE)));

  // 7. Spawns around the maze; loot in the pit (risky) and by the crates.
  const safe = cands.filter((p) => !ventSet.has(Math.floor(p.y / TILE) * w + Math.floor(p.x / TILE)));
  const spawns = spreadPoints(safe.filter((p) => Math.hypot(p.x / TILE - cx, p.y / TILE - cy) > PIT_R + 2), 100, 48, rng);
  const pitPts = safe.filter((p) => Math.hypot(p.x / TILE - cx, p.y / TILE - cy) < PIT_R - 3);
  const lootPoints = [
    ...spreadPoints(pitPts, 44, 0, rng),
    ...crates.map((c) => safe.reduce((best, p) => (!best || Math.hypot(p.x - c.x, p.y - c.y) < Math.hypot(best.x - c.x, best.y - c.y) ? p : best), null)).filter(Boolean),
    ...spreadPoints(safe.filter((p) => Math.hypot(p.x / TILE - cx, p.y / TILE - cy) >= PIT_R), 120, 0, rng),
  ];
  const vaultPoints = spreadPoints(pitPts.filter((p) => Math.hypot(p.x / TILE - cx, p.y / TILE - cy) < 6), 20, 3, rng).slice(0, 3);

  return { w, h, tiles: grid, deco, meta: { spawns, lootPoints, vaultPoints, conveyors, vents, center: { x: (cx + 0.5) * TILE, y: (cy + 0.5) * TILE } } };
}
