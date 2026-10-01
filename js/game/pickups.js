// Ground pickups: items (with their level) and XP caps. XP caps are pulled in
// by a magnet radius; items are grabbed by walking over them when the fighter has
// a free slot or already owns the item (upgrade). Full slots -> swap with E.

import { Pool } from '../core/pool.js';
import { POOL_CAPS, ITEMS, XP } from '../config.js';
import { len, hash2 } from '../core/math.js';
import { tryAutoPickup } from './items.js';
import { addXp } from './levelup.js';
import { drawItemIcon } from '../ui/icons.js';

const near = [];
const MAGNET_QUERY = 90;

export class Pickups {
  constructor(match) {
    this.match = match;
    this.pool = new Pool(() => ({
      kind: '', x: 0, y: 0, vx: 0, vy: 0, item: null, value: 0, noId: -1, noT: 0, t: 0, target: null,
    }), POOL_CAPS.pickups);
  }

  get count() { return this.pool.count; }

  _spawn(kind, x, y, vx, vy) {
    let p = this.pool.acquire();
    if (!p) {
      // Full: recycle the oldest XP cap.
      const act = this.pool.active;
      for (let i = 0; i < act.length && !p; i++) if (act[i].kind === 'xp') { this.pool.release(act[i]); p = this.pool.acquire(); }
      if (!p) return null;
    }
    p.kind = kind; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.item = null; p.value = 0; p.noId = -1; p.noT = 0; p.t = (hash2(x | 0, y | 0, 7) % 600) / 100; p.target = null;
    return p;
  }

  spawnItem(item, x, y, vx = 0, vy = 0, noFighter = null) {
    const p = this._spawn('item', x, y, vx, vy);
    if (!p) return null;
    p.item = item;
    item.charge = -1;
    if (noFighter) { p.noId = noFighter.id; p.noT = ITEMS.dropNoPickup; }
    return p;
  }

  spawnXp(value, x, y, vx = 0, vy = 0) {
    const p = this._spawn('xp', x, y, vx, vy);
    if (p) p.value = value;
    return p;
  }

  /** Burst of XP caps totalling `total`. */
  scatterXp(total, x, y, rng) {
    let left = Math.round(total);
    while (left > 0) {
      const v = Math.min(left, left > 40 ? 20 : 10);
      left -= v;
      const a = rng.range(0, Math.PI * 2);
      const s = rng.range(40, 120);
      this.spawnXp(v, x, y, Math.cos(a) * s, Math.sin(a) * s);
    }
  }

  update(dt) {
    const m = this.match;
    const map = m.map;
    const act = this.pool.active;
    for (let i = act.length - 1; i >= 0; i--) {
      const p = act[i];
      p.t += dt;
      if (p.noT > 0) p.noT -= dt;

      // Slide to a stop, staying out of walls.
      if (p.vx || p.vy) {
        const nx = p.x + p.vx * dt;
        const ny = p.y + p.vy * dt;
        if (!map.isSolidAt(nx, p.y)) p.x = nx; else p.vx = -p.vx * 0.3;
        if (!map.isSolidAt(p.x, ny)) p.y = ny; else p.vy = -p.vy * 0.3;
        const k = Math.max(0, 1 - 6 * dt);
        p.vx *= k; p.vy *= k;
        if (Math.abs(p.vx) + Math.abs(p.vy) < 2) { p.vx = 0; p.vy = 0; }
      }

      if (p.kind === 'xp') {
        // Magnet: home on the closest fighter whose magnet reaches.
        let tgt = p.target && p.target.alive ? p.target : null;
        if (!tgt) {
          m.grid.query(p.x, p.y, MAGNET_QUERY, near);
          let best = Infinity;
          for (let k = 0; k < near.length; k++) {
            const f = near[k];
            if (!f.alive) continue;
            const rr = XP.magnet * f.stats.pickupMul;
            const d2 = (f.x - p.x) * (f.x - p.x) + (f.y - p.y) * (f.y - p.y);
            if (d2 < rr * rr && d2 < best) { best = d2; tgt = f; }
          }
          p.target = tgt;
        }
        if (tgt) {
          const dx = tgt.x - p.x;
          const dy = tgt.y - p.y;
          const d = len(dx, dy);
          if (d < tgt.r + 3) {
            addXp(m, tgt, p.value);
            if (tgt.isPlayer) { m.particles.burst(p.x, p.y, 3, '#a7f070', 20, 50, 0.2); m.sfx('xp', p.x, p.y); }
            this.pool.release(p);
            continue;
          }
          const sp = 60 + p.t * 40 + Math.max(0, 200 - d * 2);
          p.x += (dx / d) * sp * dt;
          p.y += (dy / d) * sp * dt;
        }
      } else if (p.kind === 'item') {
        m.grid.query(p.x, p.y, ITEMS.pickupRange + 6, near);
        for (let k = 0; k < near.length; k++) {
          const f = near[k];
          if (!f.alive || (p.noT > 0 && p.noId === f.id)) continue;
          const d2 = (f.x - p.x) * (f.x - p.x) + (f.y - p.y) * (f.y - p.y);
          if (d2 > ITEMS.pickupRange * ITEMS.pickupRange) continue;
          if (tryAutoPickup(m, f, p.item)) {
            this.pool.release(p);
            break;
          }
        }
      }
    }
  }

  /** Nearest item pickup within range of a point (for swap prompts). */
  nearestItem(x, y, range, excludeFighter) {
    let best = null;
    let bd = range * range;
    const act = this.pool.active;
    for (let i = 0; i < act.length; i++) {
      const p = act[i];
      if (p.kind !== 'item' || (p.noT > 0 && excludeFighter && p.noId === excludeFighter.id)) continue;
      const d2 = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if (d2 < bd) { bd = d2; best = p; }
    }
    return best;
  }

  remove(p) { this.pool.release(p); }

  draw(ctx, cam, assets) {
    const act = this.pool.active;
    for (let i = 0; i < act.length; i++) {
      const p = act[i];
      const x = Math.round(p.x - cam.ox);
      const y = Math.round(p.y - cam.oy);
      if (x < -12 || y < -12 || x > cam.w + 12 || y > cam.h + 12) continue;
      if (p.kind === 'xp') {
        const big = p.value >= 10;
        const blink = Math.sin(p.t * 6) > 0.6;
        ctx.fillStyle = '#1a1c2c';
        ctx.fillRect(x - 2, y - 2, big ? 5 : 4, big ? 5 : 4);
        ctx.fillStyle = blink ? '#ffffff' : big ? '#38b764' : '#a7f070';
        ctx.fillRect(x - 1, y - 1, big ? 3 : 2, big ? 3 : 2);
      } else {
        const bob = Math.round(Math.sin(p.t * 3) * 1.5);
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#000';
        ctx.fillRect(x - 4, y + 4, 8, 2);
        ctx.globalAlpha = 1;
        // Rarity glow ring.
        const rc = RARITY_COLOR[p.item.def.rarity] || '#ffffff';
        ctx.fillStyle = rc;
        ctx.globalAlpha = 0.35 + Math.sin(p.t * 4) * 0.15;
        ctx.fillRect(x - 7, y - 7 + bob, 14, 14);
        ctx.globalAlpha = 1;
        drawItemIcon(ctx, assets, p.item.def, x - 6, y - 6 + bob, 12);
        if (p.item.level > 1) {
          ctx.fillStyle = '#ffcd75';
          for (let l = 0; l < p.item.level; l++) ctx.fillRect(x - 6 + l * 3, y + 7 + bob, 2, 2);
        }
      }
    }
  }
}

export const RARITY_COLOR = { common: '#c0cbdc', uncommon: '#38b764', rare: '#41a6f6', relic: '#b55088' };
