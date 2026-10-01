// Shared, mode-agnostic generator tools that work on a Uint8Array tile grid
// (values are tile type ids from map.js). Map generators in js/data/maps/ compose these.

import { T } from './map.js';

export function makeGrid(w, h, fill = T.WALL) {
  const g = new Uint8Array(w * h);
  g.fill(fill);
  return g;
}

/** Fill a disc of tiles. */
export function carveDisc(grid, w, h, cx, cy, r, value = T.FLOOR) {
  const r2 = r * r;
  for (let y = Math.max(1, Math.floor(cy - r)); y <= Math.min(h - 2, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(1, Math.floor(cx - r)); x <= Math.min(w - 2, Math.ceil(cx + r)); x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2) grid[y * w + x] = value;
    }
  }
}

/** Irregular blob: a disc whose radius wobbles with angle. */
export function carveBlob(grid, w, h, cx, cy, r, rng, value = T.FLOOR) {
  const k1 = rng.range(0, 6.28);
  const k2 = rng.range(0, 6.28);
  const a1 = rng.range(0.12, 0.25);
  const a2 = rng.range(0.05, 0.15);
  const R = Math.ceil(r * 1.4);
  for (let y = Math.max(1, Math.floor(cy - R)); y <= Math.min(h - 2, Math.ceil(cy + R)); y++) {
    for (let x = Math.max(1, Math.floor(cx - R)); x <= Math.min(w - 2, Math.ceil(cx + R)); x++) {
      const dx = x - cx;
      const dy = y - cy;
      const ang = Math.atan2(dy, dx);
      const rr = r * (1 + a1 * Math.sin(ang * 3 + k1) + a2 * Math.sin(ang * 5 + k2));
      if (dx * dx + dy * dy <= rr * rr) grid[y * w + x] = value;
    }
  }
}

/**
 * Wandering tunnel from (x0,y0) to (x1,y1) with given width. `wobble` (0..1) is the
 * chance per step of a sideways step, which makes the tunnel twist.
 */
export function carveTunnel(grid, w, h, x0, y0, x1, y1, width, rng, wobble = 0.35, value = T.FLOOR) {
  let x = x0;
  let y = y0;
  const lo = Math.floor((width - 1) / 2);
  const hi = width - 1 - lo;
  let guard = (Math.abs(x1 - x0) + Math.abs(y1 - y0)) * 4 + 50;
  while (guard-- > 0) {
    // Square brush, so the tunnel is exactly `width` tiles across.
    for (let by = y - lo; by <= y + hi; by++) {
      for (let bx = x - lo; bx <= x + hi; bx++) {
        if (bx > 0 && by > 0 && bx < w - 1 && by < h - 1) grid[by * w + bx] = value;
      }
    }
    const dx = x1 - x;
    const dy = y1 - y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break;
    if (rng.chance(wobble)) {
      // sideways step, perpendicular to the main direction
      if (Math.abs(dx) > Math.abs(dy)) y += rng.sign();
      else x += rng.sign();
    } else if (rng.next() < Math.abs(dx) / (Math.abs(dx) + Math.abs(dy))) {
      x += Math.sign(dx);
    } else {
      y += Math.sign(dy);
    }
    x = Math.max(2, Math.min(w - 3, x));
    y = Math.max(2, Math.min(h - 3, y));
  }
}

/** Cellular-automaton smoothing: a cell becomes wall with >= birth wall neighbors (8-neighborhood). */
export function smooth(grid, w, h, iterations = 1, birth = 5, survive = 4) {
  const tmp = new Uint8Array(grid.length);
  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { tmp[i] = T.WALL; continue; }
        let n = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if ((ox || oy) && grid[(y + oy) * w + x + ox] === T.WALL) n++;
          }
        }
        const wall = grid[i] === T.WALL;
        tmp[i] = (wall ? n >= survive : n >= birth) ? T.WALL : grid[i] === T.WALL ? T.FLOOR : grid[i];
      }
    }
    grid.set(tmp);
  }
}

/** Randomly flip some floor cells to wall (noise before smoothing). */
export function sprinkle(grid, w, h, chance, rng) {
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === T.FLOOR && rng.chance(chance)) grid[i] = T.WALL;
  }
}

/** Is tile walkable for connectivity purposes. */
const passable = (t) => t !== T.WALL;

/**
 * Label connected passable regions (4-neighborhood). Returns { labels:Int32Array, sizes:number[] }.
 */
export function regions(grid, w, h) {
  const labels = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const stack = [];
  for (let i = 0; i < grid.length; i++) {
    if (labels[i] !== -1 || !passable(grid[i])) continue;
    const id = sizes.length;
    let size = 0;
    stack.push(i);
    labels[i] = id;
    while (stack.length) {
      const j = stack.pop();
      size++;
      const x = j % w;
      const y = (j / w) | 0;
      if (x > 0) visit(j - 1);
      if (x < w - 1) visit(j + 1);
      if (y > 0) visit(j - w);
      if (y < h - 1) visit(j + w);
    }
    sizes.push(size);
  }
  return { labels, sizes };

  function visit(j) {
    if (labels[j] === -1 && passable(grid[j])) {
      labels[j] = sizes.length; // id of the region being filled
      stack.push(j);
    }
  }
}

/** Keep only the largest connected region; every other passable tile becomes wall. Returns kept size. */
export function keepLargestRegion(grid, w, h) {
  const { labels, sizes } = regions(grid, w, h);
  if (!sizes.length) return 0;
  let best = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
  for (let i = 0; i < grid.length; i++) {
    if (passable(grid[i]) && labels[i] !== best) grid[i] = T.WALL;
  }
  return sizes[best];
}

/** BFS distance (in tiles) from a start tile over passable tiles; -1 where unreachable. */
export function distanceField(grid, w, h, sx, sy) {
  const dist = new Int32Array(w * h).fill(-1);
  const q = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const s = sy * w + sx;
  dist[s] = 0;
  q[tail++] = s;
  while (head < tail) {
    const j = q[head++];
    const x = j % w;
    const d = dist[j] + 1;
    const n = [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w];
    for (let k = 0; k < 4; k++) {
      const m = n[k];
      if (m < 0 || m >= grid.length || dist[m] !== -1 || !passable(grid[m])) continue;
      dist[m] = d;
      q[tail++] = m;
    }
  }
  return dist;
}

/**
 * Poisson-disc sampling (Bridson) inside a rectangle, filtered by accept(x, y).
 * Coordinates are in whatever units the caller uses. Returns [{x, y}].
 */
export function poissonDisc(x0, y0, x1, y1, minDist, rng, accept, k = 20, maxPoints = Infinity) {
  const cell = minDist / Math.SQRT2;
  const gw = Math.ceil((x1 - x0) / cell);
  const gh = Math.ceil((y1 - y0) / cell);
  const gridPts = new Array(gw * gh).fill(null);
  const pts = [];
  const active = [];
  const gi = (x, y) => Math.floor((y - y0) / cell) * gw + Math.floor((x - x0) / cell);
  const ok = (x, y) => {
    if (x < x0 || y < y0 || x >= x1 || y >= y1 || !accept(x, y)) return false;
    const cx = Math.floor((x - x0) / cell);
    const cy = Math.floor((y - y0) / cell);
    for (let yy = Math.max(0, cy - 2); yy <= Math.min(gh - 1, cy + 2); yy++) {
      for (let xx = Math.max(0, cx - 2); xx <= Math.min(gw - 1, cx + 2); xx++) {
        const p = gridPts[yy * gw + xx];
        if (p && (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) < minDist * minDist) return false;
      }
    }
    return true;
  };
  const add = (x, y) => {
    const p = { x, y };
    pts.push(p);
    active.push(p);
    gridPts[gi(x, y)] = p;
  };
  // Seed with a few random accepted points so disconnected areas still get samples.
  for (let tries = 0; tries < 200 && pts.length < 3; tries++) {
    const x = rng.range(x0, x1);
    const y = rng.range(y0, y1);
    if (ok(x, y)) add(x, y);
  }
  while (active.length && pts.length < maxPoints) {
    const ai = Math.floor(rng.next() * active.length);
    const a = active[ai];
    let found = false;
    for (let i = 0; i < k; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const r = rng.range(minDist, minDist * 2);
      const x = a.x + Math.cos(ang) * r;
      const y = a.y + Math.sin(ang) * r;
      if (ok(x, y)) { add(x, y); found = true; break; }
    }
    if (!found) active.splice(ai, 1);
  }
  return pts;
}

/**
 * Pick well-spread points from candidates ([{x, y}]): greedy dart throwing in a
 * shuffled order, accepting a point only if it is >= minDist from all accepted ones.
 * If fewer than `want` are found, the spacing relaxes by 15% and it tries again.
 */
export function spreadPoints(candidates, minDist, want, rng) {
  const order = rng.shuffle(candidates.slice());
  let d = minDist;
  let picked = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    picked = [];
    const d2 = d * d;
    for (const c of order) {
      let ok = true;
      for (let i = 0; i < picked.length; i++) {
        const p = picked[i];
        if ((p.x - c.x) * (p.x - c.x) + (p.y - c.y) * (p.y - c.y) < d2) { ok = false; break; }
      }
      if (ok) picked.push(c);
    }
    if (picked.length >= want) break;
    d *= 0.85;
  }
  return picked;
}

/** Minimum spanning tree edges (Prim) over points; returns [[i, j]]. */
export function mst(points) {
  const n = points.length;
  if (n < 2) return [];
  const inTree = new Array(n).fill(false);
  const best = new Array(n).fill(Infinity);
  const from = new Array(n).fill(-1);
  const edges = [];
  best[0] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (u === -1 || best[i] < best[u])) u = i;
    inTree[u] = true;
    if (from[u] >= 0) edges.push([from[u], u]);
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const d = (points[u].x - points[v].x) ** 2 + (points[u].y - points[v].y) ** 2;
      if (d < best[v]) { best[v] = d; from[v] = u; }
    }
  }
  return edges;
}
