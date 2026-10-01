// Ground areas: burning pools, oil slicks, later nets/sermons/traps. An area
// damages and/or applies a status to fighters inside it on a fixed tick.
// Tags: an area tagged 'fire' ignites any overlapping area that has an `ignite`
// spec, turning it into that spec (e.g. oil -> big blaze).

import { Pool } from '../core/pool.js';
import { POOL_CAPS } from '../config.js';
import { dealDamage } from './combat.js';
import { addStatus } from './statuses.js';
import { TAU } from '../core/math.js';

const TICK = 0.25;
const near = [];

export class Areas {
  constructor(match) {
    this.match = match;
    this.pool = new Pool(() => ({
      x: 0, y: 0, r: 0, t: 0, dur: 0, dps: 0, style: '', fire: false, status: null, ignite: null,
      owner: null, item: null, tick: 0, seed: 0,
    }), POOL_CAPS.areas);
  }

  get count() { return this.pool.count; }

  /** spec: { radius, duration, dps, style, tags:[], status:{name,t,v}, ignite:spec } (already level-resolved). */
  spawn(spec, x, y, owner, item) {
    const a = this.pool.acquire();
    if (!a) return null;
    this._apply(a, spec);
    a.x = x; a.y = y; a.owner = owner; a.item = item;
    a.seed = Math.random() * 100;
    if (a.fire) this.match.particles.ring(x, y, 4, a.r, '#fe8b3a', 0.25, 2);
    return a;
  }

  _apply(a, spec) {
    a.r = spec.radius;
    a.dur = spec.duration;
    a.t = 0;
    a.dps = spec.dps || 0;
    a.style = spec.style || 'fire';
    a.fire = !!(spec.tags && spec.tags.includes('fire'));
    a.status = spec.status || null;
    a.ignite = spec.ignite || null;
    a.tick = 0;
  }

  update(dt) {
    const m = this.match;
    const act = this.pool.active;
    for (let i = act.length - 1; i >= 0; i--) {
      const a = act[i];
      a.t += dt;
      if (a.t >= a.dur) { this.pool.release(a); continue; }

      // Fire ignites flammable neighbors.
      if (a.fire) {
        for (let j = 0; j < act.length; j++) {
          const b = act[j];
          if (!b.ignite) continue;
          const rr = a.r + b.r;
          if ((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) < rr * rr * 0.6) {
            this._apply(b, b.ignite);
            m.particles.burst(b.x, b.y, 24, '#fe8b3a', 40, 160, 0.6, 2);
            m.particles.ring(b.x, b.y, 6, b.r, '#ffcd75', 0.35, 2);
            if (m.isNearPlayer(b.x, b.y)) m.shake(0.25);
          }
        }
        if (Math.random() < dt * a.r * 0.6) {
          const ang = Math.random() * TAU;
          const rad = Math.sqrt(Math.random()) * a.r;
          m.particles.spawn(a.x + Math.cos(ang) * rad, a.y + Math.sin(ang) * rad, 0, -20 - Math.random() * 20, 0.5, Math.random() < 0.5 ? '#fe8b3a' : '#ffcd75', 1, 1);
        }
      }

      a.tick -= dt;
      if (a.tick > 0) continue;
      a.tick += TICK;
      m.grid.query(a.x, a.y, a.r, near);
      for (let k = 0; k < near.length; k++) {
        const f = near[k];
        if (!f.alive) continue;
        const rr = a.r + f.r * 0.5;
        if ((f.x - a.x) * (f.x - a.x) + (f.y - a.y) * (f.y - a.y) > rr * rr) continue;
        const own = f === a.owner;
        if (a.status && !(own && a.dps > 0)) addStatus(f, a.status.name, a.status.t, a.status.v, a.owner);
        if (a.dps > 0 && !own) dealDamage(m, f, a.dps * TICK, { source: a.owner, item: a.item, kind: 'dot' });
      }
    }
  }

  draw(ctx, cam) {
    const act = this.pool.active;
    for (let i = 0; i < act.length; i++) {
      const a = act[i];
      const x = a.x - cam.ox;
      const y = a.y - cam.oy;
      if (x < -a.r || y < -a.r || x > cam.w + a.r || y > cam.h + a.r) continue;
      const fade = Math.min(1, (a.dur - a.t) / 0.4, a.t / 0.12);
      if (a.style === 'oil') {
        ctx.globalAlpha = 0.75 * fade;
        ctx.fillStyle = '#2a1d1a';
        disc(ctx, x, y, a.r);
        ctx.globalAlpha = 0.35 * fade;
        ctx.fillStyle = '#8b93af';
        disc(ctx, x - a.r * 0.3, y - a.r * 0.3, a.r * 0.25);
      } else {
        const flick = 0.85 + Math.sin((a.t + a.seed) * 23) * 0.15;
        ctx.globalAlpha = 0.45 * fade;
        ctx.fillStyle = '#b13e53';
        disc(ctx, x, y, a.r);
        ctx.globalAlpha = 0.5 * fade * flick;
        ctx.fillStyle = '#fe8b3a';
        disc(ctx, x, y, a.r * 0.75);
        ctx.globalAlpha = 0.6 * fade * flick;
        ctx.fillStyle = '#ffcd75';
        disc(ctx, x, y, a.r * 0.35);
      }
      ctx.globalAlpha = 1;
    }
  }
}

/** Pixel-stepped filled disc (rows of rects) so it matches the 8-bit look. */
function disc(ctx, cx, cy, r) {
  cx = Math.round(cx);
  cy = Math.round(cy);
  const ri = Math.round(r);
  for (let dy = -ri; dy <= ri; dy += 2) {
    const w = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
    ctx.fillRect(cx - w, cy + dy, w * 2, 2);
  }
}
