// Mode hazards. Each mode lists hazard specs in js/data/modes.js ({ type, ...params });
// this module turns them into objects with update/draw hooks. Nothing here names a mode.
//   darkness  { light, otherLight, fireLight }  dark overlay with light around fighters; AI perception capped
//   caveIn    { every:[a,b], shadow, radius, damage, stun }  telegraphed falling rocks near fighters
//   skylight  { crack }  standing on a skylight tile for `crack` s drops you through (a fall)
//   conveyor  { speed }  conveyor tiles (map meta) push fighters along
//   vent      { every:[a,b], hiss, burst, radius, damage, knockback }  steam vents (map meta)
// Falls into pits are handled by match.onFall with the mode's `fall` spec.

import { TILE } from '../config.js';
import { dealDamage } from './combat.js';

const near = [];
const moveOut = { x: 0, y: 0, hitX: false, hitY: false };

export function makeHazards(match, specs) {
  return (specs || []).map((s) => {
    const H = TYPES[s.type];
    if (!H) { console.warn(`[hazards] unknown hazard type "${s.type}"`); return null; }
    return new H(match, s);
  }).filter(Boolean);
}

class Darkness {
  constructor(m, s) {
    this.s = s;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 480;
    this.canvas.height = 270;
    this.g = this.canvas.getContext('2d');
    m.perceptionMul = Math.min(1, (s.light || 130) / 200);
  }

  update() {}

  drawOverlay(ctx, cam, m) {
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(6, 5, 14, 0.9)';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r) => {
      if (x < -r || y < -r || x > W + r || y > H + r) return;
      const gr = g.createRadialGradient(x, y, r * 0.35, x, y, r);
      gr.addColorStop(0, 'rgba(0,0,0,1)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    };
    const p = m.player;
    const focus = p.alive ? p : m.camTarget;
    for (const f of m.fighters) {
      if (!f.alive) continue;
      hole(f.x - cam.ox, f.y - cam.oy, f === focus ? this.s.light || 130 : this.s.otherLight || 56);
    }
    for (const a of m.areas.pool.active) if (a.fire) hole(a.x - cam.ox, a.y - cam.oy, (this.s.fireLight || 40) + a.r);
    for (const q of m.projectiles.pool.active) if (q.kind === 'hoop' || q.kind === 'bolt') hole(q.x - cam.ox, q.y - cam.oy, 24);
    ctx.drawImage(this.canvas, 0, 0);
  }
}

class CaveIn {
  constructor(m, s) {
    this.s = s;
    this.rng = m.rng.fork(301);
    this.t = this.rng.range(s.every[0], s.every[1]);
    this.pending = [];
  }

  update(dt, m) {
    this.t -= dt;
    if (this.t <= 0) {
      this.t = this.rng.range(this.s.every[0], this.s.every[1]);
      // Near a random living fighter, inside the zone.
      const alive = m.fighters.filter((f) => f.alive && !f.extra);
      if (alive.length) {
        const f = this.rng.pick(alive);
        const x = f.x + this.rng.range(-60, 60);
        const y = f.y + this.rng.range(-60, 60);
        if (m.nav.walkableAt(x, y)) {
          m.telegraph({ kind: 'circle', x, y, r: this.s.radius, dur: this.s.shadow, color: '#000000' });
          this.pending.push({ x, y, t: this.s.shadow });
        }
      }
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const c = this.pending[i];
      c.t -= dt;
      if (c.t > 0) continue;
      this.pending.splice(i, 1);
      m.grid.query(c.x, c.y, this.s.radius + 6, near);
      for (const f of near) {
        if (!f.alive || Math.hypot(f.x - c.x, f.y - c.y) > this.s.radius + f.r) continue;
        dealDamage(m, f, this.s.damage, { kind: 'hazard', raw: true, stun: this.s.stun, dx: f.x - c.x, dy: f.y - c.y, knockback: 80 });
      }
      m.particles.burst(c.x, c.y, 26, '#8b93af', 30, 140, 0.6, 2);
      m.particles.burst(c.x, c.y, 14, '#5a3a22', 20, 90, 0.5, 2);
      if (m.isNearPlayer(c.x, c.y)) m.shake(0.4);
    }
  }

  drawTop(ctx, cam) {
    // Falling rocks: a shadow that darkens as they come down.
    for (const c of this.pending) {
      const k = 1 - c.t / this.s.shadow;
      ctx.globalAlpha = 0.2 + 0.5 * k;
      ctx.fillStyle = '#000000';
      const r = this.s.radius * (0.4 + 0.6 * k);
      ctx.beginPath();
      ctx.ellipse(c.x - cam.ox, c.y - cam.oy, r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#8b93af';
      const fall = (1 - k) * 60;
      ctx.fillRect(Math.round(c.x - cam.ox - 2), Math.round(c.y - cam.oy - fall - 4), 5, 4);
    }
  }
}

class Skylight {
  constructor(m, s) {
    this.s = s;
    this.tiles = new Set((m.map.meta.skylights || []).map((t) => t.ty * m.map.w + t.tx));
    this.stand = new Map(); // fighter id -> seconds on a skylight
    this.cracking = []; // tiles being stood on, for drawing
  }

  update(dt, m) {
    this.cracking.length = 0;
    for (const f of m.fighters) {
      if (!f.alive) continue;
      const i = Math.floor(f.y / TILE) * m.map.w + Math.floor(f.x / TILE);
      if (!this.tiles.has(i) || f.dashing) { this.stand.delete(f.id); continue; }
      const t = (this.stand.get(f.id) || 0) + dt;
      this.stand.set(f.id, t);
      this.cracking.push({ i, k: Math.min(1, t / this.s.crack) });
      if (t >= this.s.crack) {
        this.stand.delete(f.id);
        m.onFall(f, this.s.fall);
      }
    }
  }

  drawTop(ctx, cam, m) {
    ctx.strokeStyle = '#1a1c2c';
    ctx.lineWidth = 1;
    for (const c of this.cracking) {
      const x = (c.i % m.map.w) * TILE - cam.ox;
      const y = Math.floor(c.i / m.map.w) * TILE - cam.oy;
      ctx.beginPath();
      ctx.moveTo(x + 8, y + 8);
      ctx.lineTo(x + 8 - 7 * c.k, y + 3);
      ctx.moveTo(x + 8, y + 8);
      ctx.lineTo(x + 14 * c.k + 2, y + 12);
      ctx.moveTo(x + 8, y + 8);
      ctx.lineTo(x + 5, y + 8 + 7 * c.k);
      ctx.stroke();
    }
  }
}

class Conveyor {
  constructor(m, s) {
    this.s = s;
    const w = m.map.w;
    this.dir = new Int8Array(m.map.w * m.map.h * 2);
    for (const c of m.map.meta.conveyors || []) {
      const i = (c.ty * w + c.tx) * 2;
      this.dir[i] = c.dx;
      this.dir[i + 1] = c.dy;
    }
    this.t = 0;
  }

  update(dt, m) {
    this.t += dt;
    const w = m.map.w;
    for (const f of m.fighters) {
      if (!f.alive || f.dashing) continue;
      const i = (Math.floor(f.y / TILE) * w + Math.floor(f.x / TILE)) * 2;
      const dx = this.dir[i];
      const dy = this.dir[i + 1];
      if (!dx && !dy) continue;
      m.map.moveCircle(f.x, f.y, f.r, dx * this.s.speed * dt, dy * this.s.speed * dt, false, moveOut);
      f.x = moveOut.x;
      f.y = moveOut.y;
    }
  }

  drawGround(ctx, cam, m) {
    // Moving chevrons over the belt tiles.
    const w = m.map.w;
    const off = Math.floor(this.t * this.s.speed) % 8;
    ctx.fillStyle = '#ffcd75';
    ctx.globalAlpha = 0.55;
    const tx0 = Math.max(0, Math.floor(cam.ox / TILE));
    const ty0 = Math.max(0, Math.floor(cam.oy / TILE));
    const tx1 = Math.min(w - 1, Math.floor((cam.ox + cam.w) / TILE));
    const ty1 = Math.min(m.map.h - 1, Math.floor((cam.oy + cam.h) / TILE));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = (ty * w + tx) * 2;
        const dx = this.dir[i];
        const dy = this.dir[i + 1];
        if (!dx && !dy) continue;
        const x = tx * TILE - cam.ox;
        const y = ty * TILE - cam.oy;
        for (let k = 0; k < 2; k++) {
          const s = ((off + k * 8) % 16) - 4;
          if (dx) ctx.fillRect(x + (dx > 0 ? s + 4 : 12 - s - 4), y + 7, 2, 2);
          else ctx.fillRect(x + 7, y + (dy > 0 ? s + 4 : 12 - s - 4), 2, 2);
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}

class Vent {
  constructor(m, s) {
    this.s = s;
    const rng = m.rng.fork(302);
    this.vents = (m.map.meta.vents || []).map((v) => ({ x: v.x, y: v.y, t: rng.range(s.every[0], s.every[1]), state: 'idle', rng }));
  }

  update(dt, m) {
    const s = this.s;
    for (const v of this.vents) {
      v.t -= dt;
      if (v.state === 'idle' && v.t <= 0) {
        v.state = 'hiss';
        v.t = s.hiss;
        m.telegraph({ kind: 'circle', x: v.x, y: v.y, r: s.radius, dur: s.hiss, color: '#c0cbdc' });
      } else if (v.state === 'hiss') {
        if (Math.random() < dt * 20) m.particles.spawn(v.x + (Math.random() - 0.5) * 6, v.y, 0, -30, 0.3, '#c0cbdc', 1, 1);
        if (v.t <= 0) {
          v.state = 'burst';
          v.t = s.burst;
          m.grid.query(v.x, v.y, s.radius + 6, near);
          for (const f of near) {
            if (!f.alive || Math.hypot(f.x - v.x, f.y - v.y) > s.radius + f.r) continue;
            dealDamage(m, f, s.damage, { kind: 'hazard', raw: true, dx: f.x - v.x, dy: f.y - v.y, knockback: s.knockback });
          }
          if (m.isNearPlayer(v.x, v.y)) m.shake(0.15);
        }
      } else if (v.state === 'burst') {
        if (Math.random() < dt * 60) {
          const a = Math.random() * Math.PI * 2;
          m.particles.spawn(v.x, v.y, Math.cos(a) * 60, Math.sin(a) * 60 - 40, 0.5, Math.random() < 0.5 ? '#ffffff' : '#c0cbdc', 2, 2);
        }
        if (v.t <= 0) { v.state = 'idle'; v.t = v.rng.range(s.every[0], s.every[1]); }
      }
    }
  }
}

const TYPES = { darkness: Darkness, caveIn: CaveIn, skylight: Skylight, conveyor: Conveyor, vent: Vent };

