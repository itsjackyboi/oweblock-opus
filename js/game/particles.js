// Pooled visual effects: pixel particles, shaped fx (slash arcs, rings, lines)
// and floating damage numbers. Purely cosmetic: nothing here affects the sim.

import { Pool } from '../core/pool.js';
import { POOL_CAPS } from '../config.js';
import { drawText } from '../ui/font.js';
import { TAU } from '../core/math.js';

export class Particles {
  constructor() {
    this.parts = new Pool(() => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, c: '#fff', size: 1, drag: 0, grav: 0 }), POOL_CAPS.particles);
    this.fx = new Pool(() => ({ type: '', x: 0, y: 0, a: 0, arc: 0, r: 0, r2: 0, x2: 0, y2: 0, t: 0, max: 1, c: '#fff', w: 1 }), POOL_CAPS.fx);
    this.pops = new Pool(() => ({ x: 0, y: 0, vy: 0, t: 0, max: 1, text: '', c: '#fff' }), POOL_CAPS.popups);
  }

  /** One particle. */
  spawn(x, y, vx, vy, life, c, size = 1, drag = 3, grav = 0) {
    const p = this.parts.acquire();
    if (!p) return;
    p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = life; p.c = c; p.size = size; p.drag = drag; p.grav = grav;
  }

  /** Radial burst of n particles. */
  burst(x, y, n, c, speedMin, speedMax, life = 0.35, size = 1, rng = Math.random) {
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU;
      const s = speedMin + rng() * (speedMax - speedMin);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + rng() * 0.6), c, size);
    }
  }

  /** Directed spray around angle a with spread (radians). */
  spray(x, y, a, spread, n, c, speedMin, speedMax, life = 0.3, size = 1) {
    for (let i = 0; i < n; i++) {
      const aa = a + (Math.random() - 0.5) * spread;
      const s = speedMin + Math.random() * (speedMax - speedMin);
      this.spawn(x, y, Math.cos(aa) * s, Math.sin(aa) * s, life * (0.6 + Math.random() * 0.6), c, size);
    }
  }

  arc(x, y, a, arc, r, c, max = 0.12, w = 2) { return this._fx('arc', x, y, a, arc, r, c, max, w); }
  ring(x, y, r, r2, c, max = 0.3, w = 1) { const f = this._fx('ring', x, y, 0, 0, r, c, max, w); if (f) f.r2 = r2; return f; }
  line(x, y, x2, y2, c, max = 0.15, w = 1) { const f = this._fx('line', x, y, 0, 0, 0, c, max, w); if (f) { f.x2 = x2; f.y2 = y2; } return f; }

  _fx(type, x, y, a, arc, r, c, max, w) {
    const f = this.fx.acquire();
    if (!f) return null;
    f.type = type; f.x = x; f.y = y; f.a = a; f.arc = arc; f.r = r; f.r2 = r; f.c = c; f.t = 0; f.max = max; f.w = w;
    return f;
  }

  popup(x, y, text, c = '#ffffff') {
    const p = this.pops.acquire();
    if (!p) return;
    p.x = x + (Math.random() - 0.5) * 6; p.y = y; p.vy = -38; p.t = 0; p.max = 0.7; p.text = text; p.c = c;
  }

  update(dt) {
    const ps = this.parts.active;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.release(p); continue; }
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k; p.vy = p.vy * k + p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    const fs = this.fx.active;
    for (let i = fs.length - 1; i >= 0; i--) {
      const f = fs[i];
      f.t += dt;
      if (f.t >= f.max) this.fx.release(f);
    }
    const pp = this.pops.active;
    for (let i = pp.length - 1; i >= 0; i--) {
      const p = pp[i];
      p.t += dt;
      p.y += p.vy * dt;
      p.vy *= Math.max(0, 1 - 4 * dt);
      if (p.t >= p.max) this.pops.release(p);
    }
  }

  draw(ctx, cam) {
    const ox = cam.ox;
    const oy = cam.oy;
    const ps = this.parts.active;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const x = (p.x - ox) | 0;
      const y = (p.y - oy) | 0;
      if (x < -4 || y < -4 || x > cam.w + 4 || y > cam.h + 4) continue;
      ctx.globalAlpha = Math.min(1, (p.life / p.max) * 2);
      ctx.fillStyle = p.c;
      ctx.fillRect(x, y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    const fs = this.fx.active;
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      const k = f.t / f.max;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = f.c;
      ctx.lineWidth = f.w;
      ctx.beginPath();
      if (f.type === 'arc') {
        const sweep = f.arc * Math.min(1, k * 2.5);
        ctx.arc(f.x - ox, f.y - oy, f.r, f.a - f.arc / 2, f.a - f.arc / 2 + sweep);
      } else if (f.type === 'ring') {
        ctx.arc(f.x - ox, f.y - oy, Math.max(0.5, f.r + (f.r2 - f.r) * k), 0, TAU);
      } else if (f.type === 'line') {
        ctx.moveTo(f.x - ox, f.y - oy);
        ctx.lineTo(f.x2 - ox, f.y2 - oy);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const pp = this.pops.active;
    for (let i = 0; i < pp.length; i++) {
      const p = pp[i];
      ctx.globalAlpha = Math.min(1, (1 - p.t / p.max) * 2.5);
      drawText(ctx, p.text, p.x - ox, p.y - oy, { color: p.c, shadow: '#000000', align: 'center' });
    }
    ctx.globalAlpha = 1;
  }
}
