// Navigation: a shared BFS flow field toward the safe zone (rebuilt when the zone
// target changes) and budgeted grid A* for chasing (at most N requests per frame,
// paths cached by the requester). Walls and pits are not walkable.

import { TILE } from '../config.js';
import { TILE_INFO } from '../game/map.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const MAX_EXPANSIONS = 4000;

export class Nav {
  constructor(map, budget = 4) {
    this.map = map;
    this.w = map.w;
    this.h = map.h;
    const n = this.w * this.h;
    this.walk = new Uint8Array(n);
    this.refreshWalkable();
    this.flow = new Int32Array(n).fill(-1);
    this.flowRect = null;
    this.queue = new Int32Array(n);
    // A* scratch, reused with a generation stamp.
    this.g = new Float32Array(n);
    this.from = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.gen = 1;
    this.heapI = new Int32Array(n * 2);
    this.heapF = new Float32Array(n * 2);
    this.heapN = 0;
    this.requests = [];
    this.budget = budget;
    this.served = 0;
  }

  refreshWalkable() {
    const t = this.map.tiles;
    for (let i = 0; i < t.length; i++) {
      const info = TILE_INFO[t[i]];
      this.walk[i] = info.solid || info.pit ? 0 : 1;
    }
  }

  walkableAt(px, py) {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h && this.walk[ty * this.w + tx] === 1;
  }

  // ------------------------------------------------------------------ flow field

  /** Multi-source BFS from every walkable tile inside the rect {x0,y0,x1,y1} (px). */
  buildFlow(rect) {
    const { w, h, walk, flow, queue } = this;
    flow.fill(-1);
    let head = 0;
    let tail = 0;
    const tx0 = Math.max(0, Math.ceil(rect.x0 / TILE));
    const ty0 = Math.max(0, Math.ceil(rect.y0 / TILE));
    const tx1 = Math.min(w - 1, Math.floor(rect.x1 / TILE) - 1);
    const ty1 = Math.min(h - 1, Math.floor(rect.y1 / TILE) - 1);
    for (let y = ty0; y <= ty1; y++) {
      for (let x = tx0; x <= tx1; x++) {
        const i = y * w + x;
        if (walk[i]) { flow[i] = 0; queue[tail++] = i; }
      }
    }
    if (tail === 0) {
      // Rect too small to contain a walkable tile: seed the nearest walkable tile to its center.
      const s = this.nearestWalkable((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2);
      if (s >= 0) { flow[s] = 0; queue[tail++] = s; }
    }
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      const y = (i / w) | 0;
      const d = flow[i] + 1;
      for (let k = 0; k < 4; k++) {
        const nx = x + DIRS[k][0];
        const ny = y + DIRS[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!walk[j] || flow[j] !== -1) continue;
        flow[j] = d;
        queue[tail++] = j;
      }
    }
    this.flowRect = rect;
  }

  /** Direction (unit vector into out) to step down the flow field from (px, py). Returns distance in tiles (0 = inside). */
  flowDir(px, py, out) {
    const { w, h, walk, flow } = this;
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    out.x = 0; out.y = 0;
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return -1;
    const cur = flow[ty * w + tx];
    if (cur === 0) return 0;
    let best = cur < 0 ? 1e9 : cur;
    let bx = -1;
    let by = -1;
    for (let k = 0; k < 8; k++) {
      const nx = tx + DIRS[k][0];
      const ny = ty + DIRS[k][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!walk[j] || flow[j] < 0) continue;
      if (k >= 4 && (!walk[ty * w + nx] || !walk[ny * w + tx])) continue; // no corner cutting
      if (flow[j] < best) { best = flow[j]; bx = nx; by = ny; }
    }
    if (bx < 0) return cur;
    const dx = (bx + 0.5) * TILE - px;
    const dy = (by + 0.5) * TILE - py;
    const l = Math.hypot(dx, dy) || 1;
    out.x = dx / l;
    out.y = dy / l;
    return cur;
  }

  nearestWalkable(px, py) {
    const { w, h, walk } = this;
    const cx = Math.max(0, Math.min(w - 1, Math.floor(px / TILE)));
    const cy = Math.max(0, Math.min(h - 1, Math.floor(py / TILE)));
    for (let r = 0; r < Math.max(w, h); r++) {
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
          if (walk[y * w + x]) return y * w + x;
        }
      }
    }
    return -1;
  }

  // ------------------------------------------------------------------ A*

  /** Queue a path request for `agent` (which receives agent.path = [{x,y}] in px). */
  request(agent, tx, ty) {
    if (agent.pathQueued) {
      agent.pathTX = tx; agent.pathTY = ty;
      return;
    }
    agent.pathQueued = true;
    agent.pathTX = tx;
    agent.pathTY = ty;
    this.requests.push(agent);
  }

  /** Serve up to `budget` queued requests. Called once per update step. */
  process(time) {
    this.served = 0;
    while (this.requests.length && this.served < this.budget) {
      const a = this.requests.shift();
      a.pathQueued = false;
      if (!a.fighter.alive) continue;
      a.path = this.astar(a.fighter.x, a.fighter.y, a.pathTX, a.pathTY, a.path || []);
      a.pathI = 0;
      a.pathTime = time;
      this.served++;
    }
  }

  _push(i, f) {
    let k = this.heapN++;
    const hi = this.heapI;
    const hf = this.heapF;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hf[p] <= f) break;
      hi[k] = hi[p]; hf[k] = hf[p];
      k = p;
    }
    hi[k] = i; hf[k] = f;
  }

  _pop() {
    const hi = this.heapI;
    const hf = this.heapF;
    const top = hi[0];
    const n = --this.heapN;
    const li = hi[n];
    const lf = hf[n];
    let k = 0;
    while (true) {
      let c = 2 * k + 1;
      if (c >= n) break;
      if (c + 1 < n && hf[c + 1] < hf[c]) c++;
      if (hf[c] >= lf) break;
      hi[k] = hi[c]; hf[k] = hf[c];
      k = c;
    }
    hi[k] = li; hf[k] = lf;
    return top;
  }

  /** Grid A* (8-way, no corner cutting). Returns waypoints in px; partial path toward the closest node if unreachable. */
  astar(sx, sy, tx, ty, out) {
    out.length = 0;
    const { w, h, walk, g, from, seen, closed } = this;
    let s = Math.floor(sy / TILE) * w + Math.floor(sx / TILE);
    let t = Math.floor(ty / TILE) * w + Math.floor(tx / TILE);
    if (s < 0 || s >= walk.length) return out;
    if (t < 0 || t >= walk.length || !walk[t]) t = this.nearestWalkable(tx, ty);
    if (!walk[s]) s = this.nearestWalkable(sx, sy);
    if (s < 0 || t < 0) return out;
    const gen = ++this.gen;
    this.heapN = 0;
    const txT = t % w;
    const tyT = (t / w) | 0;
    const H = (i) => {
      const dx = Math.abs((i % w) - txT);
      const dy = Math.abs(((i / w) | 0) - tyT);
      return dx + dy - 0.59 * Math.min(dx, dy);
    };
    g[s] = 0; seen[s] = gen; from[s] = -1;
    this._push(s, H(s));
    let best = s;
    let bestH = H(s);
    let exp = 0;
    while (this.heapN > 0 && exp < MAX_EXPANSIONS) {
      const i = this._pop();
      if (closed[i] === gen) continue;
      closed[i] = gen;
      exp++;
      if (i === t) { best = t; break; }
      const hi = H(i);
      if (hi < bestH) { bestH = hi; best = i; }
      const x = i % w;
      const y = (i / w) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + DIRS[k][0];
        const ny = y + DIRS[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!walk[j] || closed[j] === gen) continue;
        if (k >= 4 && (!walk[y * w + nx] || !walk[ny * w + x])) continue;
        const ng = g[i] + (k >= 4 ? 1.414 : 1);
        if (seen[j] === gen && ng >= g[j]) continue;
        seen[j] = gen; g[j] = ng; from[j] = i;
        this._push(j, ng + H(j));
      }
    }
    // Walk back from best to start.
    let i = best;
    let guard = 0;
    while (i !== -1 && i !== s && guard++ < 4000) {
      out.push({ x: ((i % w) + 0.5) * TILE, y: (((i / w) | 0) + 0.5) * TILE });
      i = from[i];
    }
    out.reverse();
    return out;
  }
}
