// Tile map: a grid of tile type ids, tile flags, circle-vs-tile collision and a
// chunk-cached renderer. Tile art comes from the active tileset's roles in the
// manifest; anything unmapped draws as the role's placeholder color.

import { TILE, CHUNK_PX } from '../config.js';
import { hash2 } from '../core/math.js';

/** Tile type ids. */
export const T = { FLOOR: 0, WALL: 1, PIT: 2 };

/** Flags per tile type id. `pit` tiles are crossable by a dash. */
export const TILE_INFO = [
  { name: 'floor', solid: false, blocksSight: false, pit: false },
  { name: 'wall', solid: true, blocksSight: true, pit: false },
  { name: 'pit', solid: false, blocksSight: false, pit: true },
];

const CHUNK_TILES = CHUNK_PX / TILE;

export class GameMap {
  /**
   * @param {object} o
   * @param {number} o.w width in tiles
   * @param {number} o.h height in tiles
   * @param {Uint8Array} o.tiles tile type ids
   * @param {Int16Array} [o.deco] per-tile deco frame from the tileset sheet, -1 for none
   * @param {string} o.tileset tileset id in the manifest
   * @param {number} o.seed
   * @param {object} [o.meta] generator output (chambers, spawn points, ...)
   */
  constructor({ w, h, tiles, deco, tileset, seed, meta }) {
    this.w = w;
    this.h = h;
    this.tiles = tiles;
    this.deco = deco || new Int16Array(w * h).fill(-1);
    this.tileset = tileset;
    this.seed = seed;
    this.meta = meta || {};
    this.pw = w * TILE;
    this.ph = h * TILE;
    this.chunkCols = Math.ceil(this.pw / CHUNK_PX);
    this.chunkRows = Math.ceil(this.ph / CHUNK_PX);
    this.chunks = new Array(this.chunkCols * this.chunkRows).fill(null);
    this.chunksDrawn = 0;
  }

  get(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return T.WALL;
    return this.tiles[ty * this.w + tx];
  }

  set(tx, ty, t) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return;
    this.tiles[ty * this.w + tx] = t;
    // A tile change can alter the look of its neighbors (wall faces, rims).
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) this.invalidate(tx + ox, ty + oy);
    }
  }

  isSolid(tx, ty) { return TILE_INFO[this.get(tx, ty)].solid; }
  isPit(tx, ty) { return TILE_INFO[this.get(tx, ty)].pit; }
  isSolidAt(px, py) { return this.isSolid(Math.floor(px / TILE), Math.floor(py / TILE)); }
  blocksSightAt(px, py) { return TILE_INFO[this.get(Math.floor(px / TILE), Math.floor(py / TILE))].blocksSight; }

  /**
   * Resolve a circle against solid tiles (and pits unless ignorePits). Mutates and
   * returns `out` = { x, y, hitX, hitY } where hitX/hitY flag a blocked axis.
   */
  moveCircle(x, y, r, dx, dy, ignorePits, out) {
    out.hitX = false;
    out.hitY = false;
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    const steps = Math.max(1, Math.ceil(dist / (r * 0.8)));
    const sx = dx / steps;
    const sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      x += sx;
      const px = this._pushOut(x, y, r, ignorePits, 0);
      if (px !== x) { out.hitX = true; x = px; }
      y += sy;
      const py = this._pushOut(x, y, r, ignorePits, 1);
      if (py !== y) { out.hitY = true; y = py; }
    }
    out.x = x;
    out.y = y;
    return out;
  }

  /** Push the circle out of blocking tiles along one axis (0 = x, 1 = y); returns that coordinate. */
  _pushOut(x, y, r, ignorePits, axis) {
    const tx0 = Math.floor((x - r) / TILE);
    const tx1 = Math.floor((x + r) / TILE);
    const ty0 = Math.floor((y - r) / TILE);
    const ty1 = Math.floor((y + r) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const info = TILE_INFO[this.get(tx, ty)];
        if (!info.solid && (ignorePits || !info.pit)) continue;
        const left = tx * TILE;
        const top = ty * TILE;
        const cx = x < left ? left : x > left + TILE ? left + TILE : x;
        const cy = y < top ? top : y > top + TILE ? top + TILE : y;
        const ddx = x - cx;
        const ddy = y - cy;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 >= r * r) continue;
        if (axis === 0) {
          if (Math.abs(ddy) >= r) continue;
          const pen = Math.sqrt(r * r - ddy * ddy);
          if (ddx > 0 || (ddx === 0 && x > left + TILE / 2)) x = left + TILE + pen;
          else x = left - pen;
        } else {
          if (Math.abs(ddx) >= r) continue;
          const pen = Math.sqrt(r * r - ddx * ddx);
          if (ddy > 0 || (ddy === 0 && y > top + TILE / 2)) y = top + TILE + pen;
          else y = top - pen;
        }
      }
    }
    return axis === 0 ? x : y;
  }

  /** Line of sight between two world points (DDA over tiles). */
  lineOfSight(x0, y0, x1, y1) {
    let tx = Math.floor(x0 / TILE);
    let ty = Math.floor(y0 / TILE);
    const ex = Math.floor(x1 / TILE);
    const ey = Math.floor(y1 / TILE);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);
    const tdx = stepX ? Math.abs(TILE / dx) : Infinity;
    const tdy = stepY ? Math.abs(TILE / dy) : Infinity;
    let tmx = stepX > 0 ? ((tx + 1) * TILE - x0) / dx : stepX < 0 ? (tx * TILE - x0) / dx : Infinity;
    let tmy = stepY > 0 ? ((ty + 1) * TILE - y0) / dy : stepY < 0 ? (ty * TILE - y0) / dy : Infinity;
    let guard = 512;
    while ((tx !== ex || ty !== ey) && guard-- > 0) {
      if (tmx < tmy) { tmx += tdx; tx += stepX; } else { tmy += tdy; ty += stepY; }
      if (TILE_INFO[this.get(tx, ty)].blocksSight) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- rendering

  invalidate(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return;
    const ci = Math.floor(ty / CHUNK_TILES) * this.chunkCols + Math.floor(tx / CHUNK_TILES);
    this.chunks[ci] = null;
  }

  /** A wall tile drawn as the top surface (its south neighbor is also wall). */
  _isTop(tx, ty) {
    return this.get(tx, ty) === T.WALL && this.get(tx, ty + 1) === T.WALL;
  }

  draw(ctx, cam, assets) {
    const c0 = Math.max(0, Math.floor(cam.ox / CHUNK_PX));
    const r0 = Math.max(0, Math.floor(cam.oy / CHUNK_PX));
    const c1 = Math.min(this.chunkCols - 1, Math.floor((cam.ox + cam.w) / CHUNK_PX));
    const r1 = Math.min(this.chunkRows - 1, Math.floor((cam.oy + cam.h) / CHUNK_PX));
    let n = 0;
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const i = cy * this.chunkCols + cx;
        if (!this.chunks[i]) this.chunks[i] = this._buildChunk(cx, cy, assets);
        ctx.drawImage(this.chunks[i], cx * CHUNK_PX - cam.ox, cy * CHUNK_PX - cam.oy);
        n++;
      }
    }
    this.chunksDrawn = n;
  }

  _buildChunk(cx, cy, assets) {
    const c = document.createElement('canvas');
    c.width = CHUNK_PX;
    c.height = CHUNK_PX;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const ts = this.tileset;
    const sheet = assets.tilesetSheet(ts);
    const edge = assets.tileset(ts)?.edge || { light: '#c0cbdc', dark: '#262b44' };
    const tx0 = cx * CHUNK_TILES;
    const ty0 = cy * CHUNK_TILES;
    for (let ly = 0; ly < CHUNK_TILES; ly++) {
      for (let lx = 0; lx < CHUNK_TILES; lx++) {
        const tx = tx0 + lx;
        const ty = ty0 + ly;
        const dx = lx * TILE;
        const dy = ly * TILE;
        const h = hash2(tx, ty, this.seed);
        const t = this.get(tx, ty);
        let role;
        if (t === T.WALL) role = this._isTop(tx, ty) ? 'wallTop' : 'wall';
        else if (t === T.PIT) role = 'pit';
        else role = 'floor';
        if (role === 'wallTop' && h % 61 === 0) role = 'wallTopAlt';
        let frame = assets.pickRole(ts, role, h >>> 3);
        if (frame < 0 && role === 'wallTopAlt') { role = 'wallTop'; frame = assets.pickRole(ts, role, h >>> 3); }
        assets.draw(g, sheet, frame, dx, dy, assets.roleColor(ts, role));
        if (t === T.FLOOR && tx < this.w && ty < this.h) {
          const d = this.deco[ty * this.w + tx];
          if (d >= 0) assets.draw(g, sheet, d, dx, dy, null);
        }
        if (role === 'wallTop' || role === 'wallTopAlt') this._drawRim(g, tx, ty, dx, dy, edge);
      }
    }
    return c;
  }

  /** Light stone rim with a dark outline where a wall top meets anything that is not wall top. */
  _drawRim(g, tx, ty, dx, dy, edge) {
    const open = (x, y) => !this._isTop(x, y) && x >= 0 && y >= 0 && x < this.w && y < this.h;
    const n = open(tx, ty - 1);
    const s = open(tx, ty + 1);
    const w = open(tx - 1, ty);
    const e = open(tx + 1, ty);
    g.fillStyle = edge.light;
    if (n) g.fillRect(dx, dy, TILE, 3);
    if (s) g.fillRect(dx, dy + TILE - 3, TILE, 3);
    if (w) g.fillRect(dx, dy, 3, TILE);
    if (e) g.fillRect(dx + TILE - 3, dy, 3, TILE);
    g.fillStyle = edge.dark;
    if (n) g.fillRect(dx, dy, TILE, 1);
    if (s) g.fillRect(dx, dy + TILE - 1, TILE, 1);
    if (w) g.fillRect(dx, dy, 1, TILE);
    if (e) g.fillRect(dx + TILE - 1, dy, 1, TILE);
    // inner dark line under the light band
    if (n) g.fillRect(dx + (w ? 3 : 0), dy + 3, TILE - (w ? 3 : 0) - (e ? 3 : 0), 1);
    if (s) g.fillRect(dx + (w ? 3 : 0), dy + TILE - 4, TILE - (w ? 3 : 0) - (e ? 3 : 0), 1);
    if (w) g.fillRect(dx + 3, dy + (n ? 3 : 0), 1, TILE - (n ? 3 : 0) - (s ? 3 : 0));
    if (e) g.fillRect(dx + TILE - 4, dy + (n ? 3 : 0), 1, TILE - (n ? 3 : 0) - (s ? 3 : 0));
  }
}
