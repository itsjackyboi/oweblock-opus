// Gobbler's Police Sweep: a rectangle closing from the map edges toward a seeded
// final point. Every zone is the map rect scaled about the final point by s,
// so each next zone always lies inside the current one.
// Outside the zone you take the phase's dps plus 1 dps per second of continuous exposure.

import { TILE } from '../config.js';
import { dealDamage } from './combat.js';

/** Default schedule; durations are multiplied by the mode's zone.scale. */
export const ZONE_SCHEDULE = {
  safe: 60,
  sizes: [0.7, 0.45, 0.25, 0.1, 0], // fraction of the map after each shrink
  shrink: [40, 40, 35, 30, 45], // seconds each shrink takes (the last is the final collapse)
  pause: [50, 40, 30, 25], // pause after each shrink
  dps: [2, 4, 7, 11, 16], // by phase (index = shrinks started so far - 1, clamped)
  exposureDps: 1, // extra dps per second of continuous exposure
  tick: 0.5,
};

const POLICE_SPACING = 26;

export class Zone {
  constructor(match, finalX, finalY, scale = 1) {
    this.match = match;
    this.W = match.map.pw;
    this.H = match.map.ph;
    this.fx = finalX;
    this.fy = finalY;
    this.sched = ZONE_SCHEDULE;
    this.scale = scale;
    this.s = 1;
    this.sFrom = 1;
    this.sTo = 1;
    this.phase = -1; // shrinks started so far - 1; -1 = safe time
    this.state = 'wait';
    this.t = this.sched.safe * scale; // time left in the current state
    this.dur = this.t;
    this.cur = { x0: 0, y0: 0, x1: this.W, y1: this.H };
    this.next = { x0: 0, y0: 0, x1: this.W, y1: this.H };
    this.version = 0; // bumps when the next-zone target changes
    this._setNext(this.sched.sizes[0]);
    this._rect(1, this.cur);
    this.done = false;
    const S = this.sched;
    /** Seconds from match start until the sweep has fully closed. */
    this.total = (S.safe + S.shrink.reduce((a, b) => a + b, 0) + S.pause.reduce((a, b) => a + b, 0)) * scale;
  }

  _rect(s, out) {
    out.x0 = this.fx + (0 - this.fx) * s;
    out.y0 = this.fy + (0 - this.fy) * s;
    out.x1 = this.fx + (this.W - this.fx) * s;
    out.y1 = this.fy + (this.H - this.fy) * s;
    return out;
  }

  _setNext(s) {
    this.sNext = s;
    this._rect(s, this.next);
    this.version++;
  }

  get dps() { return this.sched.dps[Math.max(0, Math.min(this.sched.dps.length - 1, this.phase))]; }

  /** Seconds until the next shrink starts (0 while shrinking). */
  get timeToShrink() { return this.state === 'wait' ? this.t : 0; }

  inside(x, y, margin = 0) {
    const c = this.cur;
    return x >= c.x0 + margin && x <= c.x1 - margin && y >= c.y0 + margin && y <= c.y1 - margin;
  }

  insideNext(x, y, margin = 0) {
    const c = this.next;
    return x >= c.x0 + margin && x <= c.x1 - margin && y >= c.y0 + margin && y <= c.y1 - margin;
  }

  update(dt) {
    const S = this.sched;
    this.t -= dt;
    if (this.state === 'wait' && this.t <= 0) {
      this.phase++;
      if (this.phase >= S.shrink.length) { this.done = true; this.t = 1e9; return; }
      this.state = 'shrink';
      this.sFrom = this.s;
      this.sTo = S.sizes[this.phase];
      this.t = this.dur = S.shrink[this.phase] * this.scale;
      this.match.events.emit('zoneShrink', { phase: this.phase });
    } else if (this.state === 'shrink') {
      const k = 1 - Math.max(0, this.t) / this.dur;
      this.s = this.sFrom + (this.sTo - this.sFrom) * k;
      this._rect(this.s, this.cur);
      if (this.t <= 0) {
        this.s = this.sTo;
        this._rect(this.s, this.cur);
        if (this.phase + 1 < S.shrink.length) {
          this.state = 'wait';
          this.t = this.dur = S.pause[this.phase] * this.scale;
          this._setNext(S.sizes[this.phase + 1]);
        } else {
          this.state = 'closed';
          this.t = 1e9;
        }
      }
    }

    // Damage outside.
    const fs = this.match.fighters;
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      if (!f.alive || f.zoneImmune) continue;
      if (this.inside(f.x, f.y)) { f.exposure = 0; f.zoneTick = 0; continue; }
      f.exposure += dt;
      f.zoneTick -= dt;
      if (f.zoneTick <= 0) {
        f.zoneTick += S.tick;
        const dps = Math.max(1, this.dps) + f.exposure * S.exposureDps;
        dealDamage(this.match, f, dps * S.tick, { kind: 'zone', raw: true });
      }
    }
  }

  /** Darkened, hatched area outside the zone; next-zone outline; police marching along the edge. */
  draw(ctx, cam, sprites, policeLook, pattern) {
    const c = this.cur;
    const ox = cam.ox;
    const oy = cam.oy;
    const x0 = Math.round(c.x0 - ox);
    const y0 = Math.round(c.y0 - oy);
    const x1 = Math.round(c.x1 - ox);
    const y1 = Math.round(c.y1 - oy);
    const W = cam.w;
    const H = cam.h;
    ctx.save();
    ctx.globalAlpha = 0.5;
    const outside = (fill) => {
      ctx.fillStyle = fill;
      if (y0 > 0) ctx.fillRect(0, 0, W, Math.min(H, y0));
      if (y1 < H) ctx.fillRect(0, Math.max(0, y1), W, H - Math.max(0, y1));
      const top = Math.max(0, y0);
      const bot = Math.min(H, y1);
      if (bot > top) {
        if (x0 > 0) ctx.fillRect(0, top, Math.min(W, x0), bot - top);
        if (x1 < W) ctx.fillRect(Math.max(0, x1), top, W - Math.max(0, x1), bot - top);
      }
    };
    outside('#0b0a1a');
    if (pattern) {
      ctx.globalAlpha = 0.35;
      // Anchor the hatch to the world: shift the pattern by the camera offset mod 8.
      const ox8 = ((ox % 8) + 8) % 8;
      const oy8 = ((oy % 8) + 8) % 8;
      ctx.setTransform(1, 0, 0, 1, -ox8, -oy8);
      ctx.fillStyle = pattern;
      // Same rects, shifted by the pattern offset.
      const sx = (x) => x + ox8;
      const sy = (y) => y + oy8;
      if (y0 > 0) ctx.fillRect(0, 0, W + 8, sy(Math.min(H, y0)));
      if (y1 < H) ctx.fillRect(0, sy(Math.max(0, y1)), W + 8, H + 8);
      const top = Math.max(0, y0);
      const bot = Math.min(H, y1);
      if (bot > top) {
        if (x0 > 0) ctx.fillRect(0, sy(top), sx(Math.min(W, x0)), bot - top);
        if (x1 < W) ctx.fillRect(sx(Math.max(0, x1)), sy(top), W + 8, bot - top);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.restore();

    // Edge line.
    ctx.strokeStyle = '#e43b44';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
    // Next zone (dashed) while waiting.
    if (this.state === 'wait' && !this.done) {
      const n = this.next;
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.7;
      ctx.strokeRect(Math.round(n.x0 - ox) + 0.5, Math.round(n.y0 - oy) + 0.5, Math.round(n.x1 - n.x0) - 1, Math.round(n.y1 - n.y0) - 1);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Police line marching along the edge (only the visible stretch).
    if (!policeLook || this.s >= 0.999) return;
    const spr = sprites.get(policeLook).normal;
    const t = this.match.time;
    const march = (t * 14) % POLICE_SPACING;
    const bob = (k) => Math.round(Math.abs(Math.sin(t * 8 + k)) * -1.5);
    const edge = (ax, ay, bx, by, dir) => {
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1) return;
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      for (let d = march; d < len; d += POLICE_SPACING) {
        const px = ax + ux * d;
        const py = ay + uy * d;
        if (px < -16 || py < -16 || px > W + 16 || py > H + 16) continue;
        ctx.setTransform(dir, 0, 0, 1, Math.round(px), Math.round(py) + bob(d));
        ctx.drawImage(spr, -8, -14);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
    edge(x0, y0, x1, y0, 1);
    edge(x1, y0, x1, y1, -1);
    edge(x1, y1, x0, y1, -1);
    edge(x0, y1, x0, y0, 1);
  }
}

/** 8x8 diagonal hatch used outside the zone. */
export function makeHatch() {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 8;
  const g = c.getContext('2d');
  g.fillStyle = '#e43b44';
  for (let i = 0; i < 8; i++) g.fillRect(i, 7 - i, 1, 1);
  return g.createPattern ? g.createPattern(c, 'repeat') : null;
}

/** Pick the final zone point: a walkable tile, biased away from the map edges. */
export function pickFinalPoint(map, rng, nav) {
  // Prefer a spawn point near the middle: guaranteed to be on the main walkable network.
  const sp = (map.meta.spawns || []).filter((p) => Math.abs(p.x - map.pw / 2) < map.pw * 0.3 && Math.abs(p.y - map.ph / 2) < map.ph * 0.3);
  if (sp.length) return rng.pick(sp);
  for (let tries = 0; tries < 200; tries++) {
    const x = rng.range(map.pw * 0.25, map.pw * 0.75);
    const y = rng.range(map.ph * 0.25, map.ph * 0.75);
    if (nav.walkableAt(x, y) && nav.walkableAt(x + TILE, y) && nav.walkableAt(x - TILE, y)) return { x, y };
  }
  const i = nav.nearestWalkable(map.pw / 2, map.ph / 2);
  return { x: ((i % map.w) + 0.5) * TILE, y: (((i / map.w) | 0) + 0.5) * TILE };
}

