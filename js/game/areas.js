// Ground areas: burning pools, oil slicks, traps, nets, dirges, kegs, lures.
// Spec fields (all optional except radius/duration; already level-resolved):
//   radius, duration, style       look and size
//   dps, status {name,t,v}        applied on a fixed tick to fighters inside
//   enemyOnly                     the owner is never affected (otherwise only spared from damage)
//   tags: ['fire'] / ignite:spec  fire ignites overlapping areas that have an ignite spec
//   instant {radius,damage,status,stun,knockback}   one hit on spawn
//   trigger {radius,damage,status,stun}             proximity trap: snaps on the first enemy, then disappears
//   fuse + explode {radius,damage,knockback,status} delayed blast when the area expires (or is detonated)
//   follow                        stays centered on its owner (auras)
//   hidden                        only visible to its owner and up close
//   group + maxPerOwner           at most N per owner and group (oldest removed)
//   lure                          AI nearby is drawn to it
//   then: spec                    spawned in place when this one expires

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
      owner: null, item: null, tick: 0, seed: 0, spec: null, born: 0, enemyOnly: false,
    }), POOL_CAPS.areas);
  }

  get count() { return this.pool.count; }

  spawn(spec, x, y, owner, item) {
    const m = this.match;
    if (spec.group && spec.maxPerOwner) {
      let mine = 0;
      let oldest = null;
      for (const a of this.pool.active) {
        if (a.owner === owner && a.spec?.group === spec.group) {
          mine++;
          if (!oldest || a.born < oldest.born) oldest = a;
        }
      }
      if (mine >= spec.maxPerOwner && oldest) this.pool.release(oldest);
    }
    const a = this.pool.acquire();
    if (!a) return null;
    this._apply(a, spec);
    a.x = x; a.y = y; a.owner = owner; a.item = item;
    a.seed = (x * 7 + y * 13) % 100;
    a.born = m.time;
    if (a.fire) m.particles.ring(x, y, 4, a.r, '#fe8b3a', 0.25, 2);
    if (spec.instant) this._hit(a, spec.instant, a.r);
    return a;
  }

  _apply(a, spec) {
    a.spec = spec;
    a.r = spec.radius;
    a.dur = spec.fuse ?? spec.duration;
    a.t = 0;
    a.dps = spec.dps || 0;
    a.style = spec.style || 'fire';
    a.fire = !!(spec.tags && spec.tags.includes('fire'));
    a.status = spec.status || null;
    a.ignite = spec.ignite || null;
    a.enemyOnly = !!spec.enemyOnly;
    a.tick = 0;
  }

  /** One-shot hit on everyone in radius (owner excluded). */
  _hit(a, h, defaultR) {
    const m = this.match;
    const r = h.radius ?? defaultR;
    m.grid.query(a.x, a.y, r + 6, near);
    for (let k = 0; k < near.length; k++) {
      const f = near[k];
      if (!f.alive || (f === a.owner && !h.hitOwner)) continue;
      const d = Math.hypot(f.x - a.x, f.y - a.y);
      if (d > r + f.r) continue;
      if (h.damage) {
        dealDamage(m, f, h.damage, { source: a.owner, item: a.item, kind: 'area', dx: f.x - a.x, dy: f.y - a.y, knockback: h.knockback || 0, stun: h.stun || 0, status: h.status || null });
      } else {
        if (h.status) addStatus(f, h.status.name, h.status.t, h.status.v, a.owner);
        if (h.stun) addStatus(f, 'stun', h.stun, 1, a.owner);
        if (h.knockback) {
          const l = d || 1;
          f.kbx += ((f.x - a.x) / l) * h.knockback;
          f.kby += ((f.y - a.y) / l) * h.knockback;
        }
      }
    }
    if (h.knockback && a.owner && h.pushOwner) {
      const f = a.owner;
      const d = Math.hypot(f.x - a.x, f.y - a.y);
      if (d < r) { f.kbx += ((f.x - a.x) / (d || 1)) * h.knockback * 0.6; f.kby += ((f.y - a.y) / (d || 1)) * h.knockback * 0.6; }
    }
  }

  /** Detonate every area of `owner` in `group` right now (e.g. kegs). Returns how many. */
  detonate(owner, group) {
    let n = 0;
    for (const a of this.pool.active) if (a.owner === owner && a.spec?.group === group && a.spec.explode) { a.t = a.dur; n++; }
    return n;
  }

  _expire(a) {
    const m = this.match;
    const spec = a.spec;
    if (spec.explode) {
      const e = spec.explode;
      this._hit(a, e, e.radius);
      m.particles.burst(a.x, a.y, 40, '#fe8b3a', 60, 220, 0.6, 2);
      m.particles.burst(a.x, a.y, 20, '#ffcd75', 40, 160, 0.4, 1);
      m.particles.ring(a.x, a.y, 6, e.radius, '#ffffff', 0.3, 2);
      if (e.leave) this.spawn(e.leave, a.x, a.y, a.owner, a.item);
      if (m.isNearPlayer(a.x, a.y)) m.shake(0.5);
      m.events.emit('explosion', { x: a.x, y: a.y, owner: a.owner });
    }
    if (spec.then) this.spawn(spec.then, a.x, a.y, a.owner, a.item);
    this.pool.release(a);
  }

  update(dt) {
    const m = this.match;
    const act = this.pool.active;
    for (let i = act.length - 1; i >= 0; i--) {
      if (i >= act.length) continue;
      const a = act[i];
      a.t += dt;
      if (a.spec.follow && a.owner) {
        if (!a.owner.alive) { this.pool.release(a); continue; }
        a.x = a.owner.x; a.y = a.owner.y;
      }
      if (a.t >= a.dur) { this._expire(a); continue; }

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

      // Proximity trap.
      const trig = a.spec.trigger;
      if (trig && a.t > 0.3) {
        m.grid.query(a.x, a.y, trig.radius + 6, near);
        for (let k = 0; k < near.length; k++) {
          const f = near[k];
          if (!f.alive || f === a.owner || f.dashing) continue;
          if (Math.hypot(f.x - a.x, f.y - a.y) > trig.radius + f.r) continue;
          dealDamage(m, f, trig.damage || 0, { source: a.owner, item: a.item, kind: 'area', stun: trig.stun || 0, status: trig.status || null });
          m.particles.burst(a.x, a.y, 10, '#c0cbdc', 40, 120, 0.3);
          m.particles.popup(f.x, f.y - 20, 'SNAP', '#c0cbdc');
          if (m.isNearPlayer(a.x, a.y)) m.shake(0.2);
          a.t = a.dur; // spent
          break;
        }
        if (a.t >= a.dur) { this.pool.release(a); continue; }
      }

      if (!a.dps && !a.status) continue;
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
        if (own && a.enemyOnly) continue;
        if (a.status && !(own && a.dps > 0)) addStatus(f, a.status.name, a.status.t, a.status.v, a.owner);
        if (a.dps > 0 && !own) dealDamage(m, f, a.dps * TICK, { source: a.owner, item: a.item, kind: 'dot' });
      }
    }
  }

  draw(ctx, cam) {
    const act = this.pool.active;
    const p = this.match.player;
    const t = this.match.time;
    for (let i = 0; i < act.length; i++) {
      const a = act[i];
      const x = a.x - cam.ox;
      const y = a.y - cam.oy;
      if (x < -a.r - 8 || y < -a.r - 8 || x > cam.w + a.r + 8 || y > cam.h + a.r + 8) continue;
      const fade = Math.min(1, (a.dur - a.t) / 0.4, a.t / 0.12 + 0.2);
      let vis = 1;
      if (a.spec.hidden && a.owner !== p) vis = Math.max(0, 1 - Math.hypot(a.x - p.x, a.y - p.y) / 48);
      ctx.globalAlpha = 1;
      DRAW[a.style]?.(ctx, a, Math.round(x), Math.round(y), fade * vis, t);
      ctx.globalAlpha = 1;
    }
  }
}

/** Pixel-stepped filled disc (rows of rects) so it matches the 8-bit look. */
export function disc(ctx, cx, cy, r) {
  cx = Math.round(cx);
  cy = Math.round(cy);
  const ri = Math.round(r);
  for (let dy = -ri; dy <= ri; dy += 2) {
    const w = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
    ctx.fillRect(cx - w, cy + dy, w * 2, 2);
  }
}

function ring(ctx, x, y, r, color, w = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.5, r), 0, TAU);
  ctx.stroke();
}

const DRAW = {
  fire(ctx, a, x, y, fade, t) {
    const flick = 0.85 + Math.sin((t + a.seed) * 23) * 0.15;
    ctx.globalAlpha = 0.45 * fade;
    ctx.fillStyle = '#b13e53';
    disc(ctx, x, y, a.r);
    ctx.globalAlpha = 0.5 * fade * flick;
    ctx.fillStyle = '#fe8b3a';
    disc(ctx, x, y, a.r * 0.75);
    ctx.globalAlpha = 0.6 * fade * flick;
    ctx.fillStyle = '#ffcd75';
    disc(ctx, x, y, a.r * 0.35);
  },
  oil(ctx, a, x, y, fade) {
    ctx.globalAlpha = 0.75 * fade;
    ctx.fillStyle = '#2a1d1a';
    disc(ctx, x, y, a.r);
    ctx.globalAlpha = 0.35 * fade;
    ctx.fillStyle = '#8b93af';
    disc(ctx, x - a.r * 0.3, y - a.r * 0.3, a.r * 0.25);
  },
  trap(ctx, a, x, y, fade, t) {
    // Iron jaw: two toothed arcs; glints now and then.
    ctx.globalAlpha = fade;
    ctx.fillStyle = '#262b44';
    ctx.fillRect(x - 6, y - 3, 12, 6);
    ctx.fillStyle = '#8b93af';
    for (let k = -5; k <= 5; k += 2) { ctx.fillRect(x + k, y - 3, 1, 2); ctx.fillRect(x + k, y + 1, 1, 2); }
    ctx.fillStyle = '#c0cbdc';
    ctx.fillRect(x - 6, y, 12, 1);
    if (Math.sin(t * 3 + a.seed) > 0.92) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 3, y - 4, 1, 1); ctx.fillRect(x + 2, y - 3, 3, 1); }
  },
  net(ctx, a, x, y, fade) {
    ctx.globalAlpha = 0.8 * fade;
    ctx.strokeStyle = '#c0cbdc';
    ctx.lineWidth = 1;
    const r = a.r;
    ctx.beginPath();
    for (let k = -r; k <= r; k += 6) {
      const w = Math.sqrt(Math.max(0, r * r - k * k));
      ctx.moveTo(x - w, y + k); ctx.lineTo(x + w, y + k);
      ctx.moveTo(x + k, y - w); ctx.lineTo(x + k, y + w);
    }
    ctx.stroke();
    ring(ctx, x, y, r, '#73eff7');
  },
  dirge(ctx, a, x, y, fade, t) {
    ctx.globalAlpha = 0.22 * fade;
    ctx.fillStyle = '#41a6f6';
    disc(ctx, x, y, a.r);
    ctx.globalAlpha = 0.7 * fade;
    for (let k = 0; k < 3; k++) {
      const rr = ((t * 18 + k * (a.r / 3)) % a.r);
      ring(ctx, x, y, rr, '#8b93af');
    }
    ring(ctx, x, y, a.r, '#c0cbdc');
    // Notes drifting up.
    ctx.fillStyle = '#c0cbdc';
    for (let k = 0; k < 3; k++) {
      const ang = a.seed + k * 2.1 + t * 0.6;
      const nx = Math.round(x + Math.cos(ang) * a.r * 0.6);
      const ny = Math.round(y + Math.sin(ang) * a.r * 0.4 - ((t * 10 + k * 7) % 14));
      ctx.fillRect(nx, ny, 2, 2); ctx.fillRect(nx + 1, ny - 4, 1, 4); ctx.fillRect(nx + 2, ny - 4, 2, 1);
    }
  },
  keg(ctx, a, x, y, fade, t) {
    const left = a.dur - a.t;
    const blink = left < 0.6 ? Math.floor(t * 16) % 2 : Math.floor(t * 6) % 2;
    ctx.globalAlpha = 0.25;
    ring(ctx, x, y, a.spec.explode?.radius || 40, '#e43b44');
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#5a3a22';
    ctx.fillRect(x - 4, y - 6, 8, 10);
    ctx.fillStyle = '#8f563b';
    ctx.fillRect(x - 3, y - 5, 6, 8);
    ctx.fillStyle = '#c0cbdc';
    ctx.fillRect(x - 4, y - 4, 8, 1); ctx.fillRect(x - 4, y + 1, 8, 1);
    ctx.fillStyle = blink ? '#ffcd75' : '#e43b44';
    ctx.fillRect(x, y - 9, 1, 3);
    ctx.fillRect(x - 1 + (blink ? 1 : 0), y - 10, 1, 1);
  },
  bobber(ctx, a, x, y, fade, t) {
    const b = Math.round(Math.sin(t * 5) * 1.5);
    ring(ctx, x, y, 8 + Math.sin(t * 4) * 2, '#73eff7');
    ctx.fillStyle = '#e43b44';
    ctx.fillRect(x - 2, y - 3 + b, 4, 3);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 2, y + b, 4, 2);
  },
  splash(ctx, a, x, y, fade) {
    ctx.globalAlpha = 0.35 * fade;
    ctx.fillStyle = '#73eff7';
    disc(ctx, x, y, a.r);
  },
  aura(ctx, a, x, y, fade, t) { DRAW.dirge(ctx, a, x, y, fade, t); },
};
