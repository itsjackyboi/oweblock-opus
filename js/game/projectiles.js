// Pooled projectiles. Movement is substepped (<= 8 px) against tiles; fighter hits
// use a swept segment-vs-circle test through the spatial hash.
// Flags: pierce, bounce, returns (boomerang), lob (arcs over cover, lands at a point),
// orbit (circles its owner and blocks enemy projectiles).

import { Pool } from '../core/pool.js';
import { POOL_CAPS } from '../config.js';
import { dealDamage, parryBlocks } from './combat.js';
import { len, TAU } from '../core/math.js';
import { drawItemIcon } from '../ui/icons.js';

const MAX_SUB = 8;
const near = [];

function blank() {
  return {
    alive: false, kind: '', color: '#fff',
    x: 0, y: 0, vx: 0, vy: 0, speed: 0, radius: 2,
    owner: null, item: null, def: null,
    damage: 0, knockback: 0, stun: 0, status: null,
    travel: 0, range: 0, pierce: 0, bounce: 0,
    returns: false, returning: false, catchCdMul: 1,
    lob: false, lobT: 0, lobDur: 0, sx: 0, sy: 0, tx: 0, ty: 0, arcH: 0, h: 0, area: null,
    orbit: false, orbitA: 0, orbitR: 0, spin: 0, life: 0, hitEvery: 0,
    hitIds: [], hitTimes: [], spinA: 0,
  };
}

const DEFAULTS = blank();

export class Projectiles {
  constructor(match) {
    this.match = match;
    this.pool = new Pool(blank, POOL_CAPS.projectiles);
  }

  get count() { return this.pool.count; }

  /** Spawn from an options object; returns the projectile (or null when the pool is full). */
  spawn(o) {
    const p = this.pool.acquire();
    if (!p) return null;
    for (const k in DEFAULTS) if (k !== 'hitIds' && k !== 'hitTimes') p[k] = DEFAULTS[k];
    p.hitIds.length = 0;
    p.hitTimes.length = 0;
    Object.assign(p, o);
    p.alive = true;
    p.sx = p.x; p.sy = p.y;
    p.speed = len(p.vx, p.vy);
    return p;
  }

  kill(p) {
    if (!p.alive) return;
    p.alive = false;
    if (p.returns && p.item) p.item.out = Math.max(0, p.item.out - 1);
    this.pool.release(p);
  }

  update(dt) {
    const act = this.pool.active;
    for (let i = act.length - 1; i >= 0; i--) {
      // An orbit can destroy other projectiles mid-loop, shrinking the active list.
      if (i >= act.length) continue;
      const p = act[i];
      if (!p.alive) continue;
      p.spinA += dt * 18;
      if (p.orbit) this._orbit(p, dt);
      else if (p.lob) this._lob(p, dt);
      else this._fly(p, dt);
    }
  }

  _lob(p, dt) {
    p.lobT += dt;
    const t = Math.min(1, p.lobT / p.lobDur);
    p.x = p.sx + (p.tx - p.sx) * t;
    p.y = p.sy + (p.ty - p.sy) * t;
    p.h = Math.sin(Math.PI * t) * p.arcH;
    if (t >= 1) {
      const m = this.match;
      m.particles.burst(p.x, p.y, 12, p.color, 30, 110, 0.4, 1);
      if (p.area) m.areas.spawn(p.area, p.x, p.y, p.owner, p.item);
      this.kill(p);
    }
  }

  _orbit(p, dt) {
    const o = p.owner;
    p.life -= dt;
    if (!o || !o.alive || p.life <= 0) { this.kill(p); return; }
    p.orbitA += p.spin * dt;
    p.x = o.x + Math.cos(p.orbitA) * p.orbitR;
    p.y = o.y + Math.sin(p.orbitA) * p.orbitR;
    // Block enemy projectiles.
    const act = this.pool.active;
    for (let i = act.length - 1; i >= 0; i--) {
      const q = act[i];
      if (q === p || !q.alive || q.orbit || q.lob || q.owner === o) continue;
      const rr = p.radius + q.radius + 3;
      if ((q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y) < rr * rr) {
        this.match.particles.burst(q.x, q.y, 6, '#ffffff', 40, 120, 0.2);
        this.kill(q);
      }
    }
    // Hit fighters (per-target cooldown).
    for (let k = 0; k < p.hitTimes.length; k++) p.hitTimes[k] -= dt;
    this.match.grid.query(p.x, p.y, p.radius + 8, near);
    for (let k = 0; k < near.length; k++) {
      const f = near[k];
      if (f === o || !f.alive) continue;
      const rr = f.r + p.radius;
      if ((f.x - p.x) * (f.x - p.x) + (f.y - p.y) * (f.y - p.y) > rr * rr) continue;
      let idx = p.hitIds.indexOf(f.id);
      if (idx >= 0 && p.hitTimes[idx] > 0) continue;
      if (idx < 0) { idx = p.hitIds.length; p.hitIds.push(f.id); p.hitTimes.push(0); }
      p.hitTimes[idx] = p.hitEvery;
      dealDamage(this.match, f, p.damage, { source: o, item: p.item, kind: 'projectile', dx: f.x - o.x, dy: f.y - o.y, knockback: p.knockback });
    }
  }

  _fly(p, dt) {
    const m = this.match;
    const map = m.map;
    if (p.returning) {
      const o = p.owner;
      if (!o || !o.alive) { this.kill(p); return; }
      const dx = o.x - p.x;
      const dy = o.y - p.y;
      const d = len(dx, dy);
      if (d < o.r + 6) {
        if (p.item) {
          p.item.cdP *= p.catchCdMul;
          if (o.isPlayer) m.particles.popup(o.x, o.y - 16, 'CATCH', '#73eff7');
        }
        m.particles.ring(o.x, o.y, 3, 12, p.color, 0.2);
        this.kill(p);
        return;
      }
      const sp = p.speed * 1.15;
      p.vx = (dx / d) * sp;
      p.vy = (dy / d) * sp;
    }

    const step = p.speed * dt;
    const n = Math.max(1, Math.ceil(step / MAX_SUB));
    const sx = (p.vx * dt) / n;
    const sy = (p.vy * dt) / n;
    for (let s = 0; s < n && p.alive; s++) {
      const x0 = p.x;
      const y0 = p.y;
      let nx = x0 + sx;
      let ny = y0 + sy;
      if (!p.returning && map.isSolidAt(nx, ny)) {
        if (p.returns) { this._turn(p); return; }
        if (p.bounce > 0) {
          p.bounce--;
          if (map.isSolidAt(nx, y0)) p.vx = -p.vx;
          if (map.isSolidAt(x0, ny)) p.vy = -p.vy;
          m.particles.burst(x0, y0, 4, '#ffffff', 30, 80, 0.15);
          return;
        }
        m.particles.spray(x0, y0, Math.atan2(-sy, -sx), 1.6, 4, p.color, 30, 90, 0.2);
        this.kill(p);
        return;
      }
      p.x = nx;
      p.y = ny;
      p.travel += len(sx, sy);
      this._hitFighters(p, x0, y0, nx, ny);
      if (!p.alive) return;
      if (!p.returning && p.travel >= p.range) {
        if (p.returns) { this._turn(p); return; }
        this.kill(p);
        return;
      }
    }
    if (p.x < 0 || p.y < 0 || p.x > map.pw || p.y > map.ph) this.kill(p);
  }

  _turn(p) {
    p.returning = true;
    p.hitIds.length = 0; // hits again on the way back
  }

  _hitFighters(p, x0, y0, x1, y1) {
    const m = this.match;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const segLen = len(x1 - x0, y1 - y0);
    m.grid.query(mx, my, segLen / 2 + p.radius + 8, near);
    for (let k = 0; k < near.length; k++) {
      const f = near[k];
      if (!f.alive || f === p.owner || p.hitIds.indexOf(f.id) >= 0) continue;
      // Closest point on segment to circle center.
      const dx = x1 - x0;
      const dy = y1 - y0;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((f.x - x0) * dx + (f.y - y0) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = x0 + dx * t;
      const cy = y0 + dy * t;
      const rr = f.r + p.radius;
      if ((f.x - cx) * (f.x - cx) + (f.y - cy) * (f.y - cy) > rr * rr) continue;

      if (parryBlocks(f, x0, y0) && !p.returning) {
        // Reflect: the projectile now belongs to the parrying fighter.
        p.vx = -p.vx;
        p.vy = -p.vy;
        p.owner = f;
        p.item = f.parry.item;
        p.returns = false;
        p.travel = 0;
        p.hitIds.length = 0;
        m.particles.burst(cx, cy, 8, '#73eff7', 60, 150, 0.25);
        if (f.isPlayer) m.particles.popup(f.x, f.y - 16, 'REFLECT', '#73eff7');
        return;
      }

      p.hitIds.push(f.id);
      dealDamage(m, f, p.damage, {
        source: p.owner, item: p.item, kind: 'projectile', dx: p.vx, dy: p.vy,
        knockback: p.knockback, stun: p.stun, status: p.status,
      });
      if (p.returns) continue; // boomerangs pass through
      if (p.pierce > 0) { p.pierce--; continue; }
      this.kill(p);
      return;
    }
  }

  draw(ctx, cam, assets) {
    const act = this.pool.active;
    for (let i = 0; i < act.length; i++) {
      const p = act[i];
      const x = Math.round(p.x - cam.ox);
      const y = Math.round(p.y - cam.oy);
      if (x < -20 || y < -40 || x > cam.w + 20 || y > cam.h + 20) continue;
      if (p.kind === 'arrow') {
        const a = Math.atan2(p.vy, p.vx);
        const c = Math.cos(a);
        const s = Math.sin(a);
        ctx.fillStyle = '#5a3a22';
        for (let k = 1; k <= 6; k++) ctx.fillRect(Math.round(x - c * k), Math.round(y - s * k), 1, 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(x - c * 7), Math.round(y - s * 7), 1, 1);
        ctx.fillRect(Math.round(x - c * 6 - s), Math.round(y - s * 6 + c), 1, 1);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, 1, 1);
      } else if (p.kind === 'boomerang') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 4, p.spinA, p.spinA + TAU * 0.6);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.round(x + Math.cos(p.spinA) * 4), Math.round(y + Math.sin(p.spinA) * 4), 1, 1);
      } else if (p.kind === 'pot') {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#000';
        ctx.fillRect(x - 3, y - 1, 6, 3);
        ctx.globalAlpha = 1;
        const hy = Math.round(y - p.h);
        ctx.save();
        ctx.translate(x, hy);
        ctx.rotate(p.spinA * 0.4);
        drawItemIcon(ctx, assets, p.def, -5, -5, 10);
        ctx.restore();
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(x - 1, y - 1, 3, 3);
      }
    }
  }
}

