// Rooftops (the final gang war): roof platforms separated by alley gaps, joined by
// planks; chimneys as cover; a couple of isolated roofs reachable only by dash or
// Beast Hook (they hold the vault loot). Falling into an alley hurts.

import { T, DECO_FLIP_X } from '../../game/map.js';
import { makeGrid, regions, spreadPoints, openPoints, mst } from '../../game/mapgen.js';
import { TILE } from '../../config.js';

/** Split [a, b) into spans of length [minS, maxS] separated by gaps of [minG, maxG]. */
function partition(rng, a, b, minS, maxS, minG, maxG) {
  const out = [];
  let x = a;
  while (x + minS <= b) {
    const len = Math.min(rng.int(minS, maxS), b - x);
    out.push({ a: x, b: x + len - 1 });
    x += len + (rng.chance(0.7) ? minG : maxG); // mostly dashable gaps
  }
  return out;
}

export function generateRooftops(rng, size, assets) {
  const [w, h] = size;
  const grid = makeGrid(w, h, T.PIT);
  const deco = new Int16Array(w * h).fill(-1);
  const roles = assets?.tileset('rooftops')?.roles || {};
  const pick = (list, fb = -1) => (list && list.length ? rng.pick(list) : fb);

  // 1. Roof blocks on a jittered grid of spans.
  const cols = partition(rng, 3, w - 3, 8, 15, 2, 3);
  const rows = partition(rng, 3, h - 3, 7, 13, 2, 3);
  const roofs = [];
  const at = new Map();
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < cols.length; c++) {
      if (rng.chance(0.08)) continue; // an empty lot
      const roof = { x0: cols[c].a, x1: cols[c].b, y0: rows[r].a, y1: rows[r].b, r, c, red: rng.chance(0.55) };
      roofs.push(roof);
      at.set(`${r},${c}`, roof);
    }
  }
  const fillRoof = (rf) => {
    for (let y = rf.y0; y <= rf.y1; y++) for (let x = rf.x0; x <= rf.x1; x++) grid[y * w + x] = T.FLOOR;
  };
  roofs.forEach(fillRoof);

  // 2. Neighbor graph (shared gap) -> planks along a spanning tree plus some loops.
  const edges = [];
  for (const rf of roofs) {
    const right = at.get(`${rf.r},${rf.c + 1}`);
    const down = at.get(`${rf.r + 1},${rf.c}`);
    if (right) edges.push([rf, right, 'h']);
    if (down) edges.push([rf, down, 'v']);
  }
  const idx = new Map(roofs.map((rf, i) => [rf, i]));
  const centers = roofs.map((rf) => ({ x: (rf.x0 + rf.x1) / 2, y: (rf.y0 + rf.y1) / 2 }));
  const tree = new Set(mst(centers).map(([i, j]) => `${Math.min(i, j)},${Math.max(i, j)}`));
  const isTree = (a, b) => tree.has(`${Math.min(idx.get(a), idx.get(b))},${Math.max(idx.get(a), idx.get(b))}`);

  // Isolated roofs: up to two small roofs with no planks at all (dash/hook only).
  const degree = new Map();
  for (const [a, b] of edges) { degree.set(a, (degree.get(a) || 0) + 1); degree.set(b, (degree.get(b) || 0) + 1); }
  const isolated = new Set(rng.shuffle(roofs.filter((rf) => (degree.get(rf) || 0) >= 2)).slice(0, 2));

  const plank = (x, y) => {
    grid[y * w + x] = T.FLOOR;
    deco[y * w + x] = pick(roles.plank);
  };
  for (const [a, b, dir] of edges) {
    if (isolated.has(a) || isolated.has(b)) continue;
    if (!isTree(a, b) && !rng.chance(0.3)) continue;
    const wide = rng.chance(0.4) ? 2 : 1;
    if (dir === 'h') {
      const lo = Math.max(a.y0, b.y0) + 1;
      const hi = Math.min(a.y1, b.y1) - wide;
      if (hi < lo) continue;
      const y = rng.int(lo, hi);
      for (let k = 0; k < wide; k++) for (let x = a.x1 + 1; x < b.x0; x++) plank(x, y + k);
    } else {
      const lo = Math.max(a.x0, b.x0) + 1;
      const hi = Math.min(a.x1, b.x1) - wide;
      if (hi < lo) continue;
      const x = rng.int(lo, hi);
      for (let k = 0; k < wide; k++) for (let y = a.y1 + 1; y < b.y0; y++) plank(x + k, y);
    }
  }

  // 3. Roof tiles (left/middle/right, eaves on the bottom row), chimneys and skylights.
  const skylights = [];
  for (const rf of roofs) {
    const top = rf.red ? roles.roofRed : roles.roofGrey; // [L, M, R, BL, BM, BR]
    for (let y = rf.y0; y <= rf.y1; y++) {
      for (let x = rf.x0; x <= rf.x1; x++) {
        const col = x === rf.x0 ? 0 : x === rf.x1 ? 2 : 1;
        const row = y === rf.y1 ? 3 : 0;
        if (top && top.length >= 6) deco[y * w + x] = top[row + col];
      }
    }
    const nch = rng.int(1, 3);
    for (let k = 0; k < nch; k++) {
      const x = rng.int(rf.x0 + 2, Math.max(rf.x0 + 2, rf.x1 - 2));
      const y = rng.int(rf.y0 + 1, Math.max(rf.y0 + 1, rf.y1 - 3));
      grid[y * w + x] = T.WALL;
      deco[y * w + x] = -1;
      if (rng.chance(0.4)) { grid[(y + 1) * w + x] = T.WALL; deco[(y + 1) * w + x] = -1; }
    }
    const nsk = rng.int(0, 2);
    for (let k = 0; k < nsk; k++) {
      const x = rng.int(rf.x0 + 1, rf.x1 - 1);
      const y = rng.int(rf.y0 + 1, rf.y1 - 1);
      if (grid[y * w + x] !== T.FLOOR) continue;
      const sk = rf.red ? roles.skylightRed : roles.skylightGrey;
      if (sk && sk.length) deco[y * w + x] = sk[0];
      skylights.push({ tx: x, ty: y });
    }
  }
  // Alley floor far below: occasional street detail (flipped for variety).
  const street = roles.street || [];
  if (street.length) for (let i = 0; i < grid.length; i++) if (grid[i] === T.PIT && rng.chance(0.04)) deco[i] = rng.pick(street) | (rng.chance(0.5) ? DECO_FLIP_X : 0);

  // 4. The main walkable network; isolated roofs keep their own labels.
  const { labels, sizes } = regions(grid, w, h, (t) => t === T.FLOOR);
  let main = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[main]) main = i;
  const skyset = new Set(skylights.map((s) => s.ty * w + s.tx));
  const cands = openPoints(grid, w, h, TILE).filter((p) => {
    const i = Math.floor(p.y / TILE) * w + Math.floor(p.x / TILE);
    return !skyset.has(i);
  });
  const mainCands = cands.filter((p) => labels[Math.floor(p.y / TILE) * w + Math.floor(p.x / TILE)] === main);
  const spawns = spreadPoints(mainCands, 100, 48, rng);

  // 5. Loot on roof centers; vault on isolated roofs.
  const center = (rf) => ({ x: ((rf.x0 + rf.x1) / 2 + 0.5) * TILE, y: ((rf.y0 + rf.y1) / 2 + 0.5) * TILE });
  const lootPoints = [];
  for (const rf of roofs) {
    if (isolated.has(rf)) continue;
    const c = center(rf);
    if (grid[Math.floor(c.y / TILE) * w + Math.floor(c.x / TILE)] === T.FLOOR) lootPoints.push(c);
    lootPoints.push({ x: (rf.x0 + 1.5) * TILE, y: (rf.y0 + 1.5) * TILE });
  }
  const vaultPoints = [...isolated].map(center).filter((c) => grid[Math.floor(c.y / TILE) * w + Math.floor(c.x / TILE)] === T.FLOOR);

  return { w, h, tiles: grid, deco, meta: { spawns, lootPoints: lootPoints.filter((p) => grid[Math.floor(p.y / TILE) * w + Math.floor(p.x / TILE)] === T.FLOOR), vaultPoints, skylights } };
}
