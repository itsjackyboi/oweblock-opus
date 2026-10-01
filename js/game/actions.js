// Generic item action primitives. Items compose these through their entries in
// js/data/; nothing here knows about a specific item.
//
// Every action has fire(ctx). ctx = { match, user, item, params, angle, ax, ay,
// stance, rangeMul, spreadMul, charge }. `mode: 'charge'` actions are held to
// draw and fire on release with ctx.charge in 0..1.
//
// Stage 2: meleeArc, projectile, chargeRelease, throwArea, parry, orbit.
// Stage 4 adds thrust, dashStrike, hookPull, hookSelf, channelBeam, sweepBeam,
// placeTrap, areaAura, spin, shockwave, consume, spawnCover, burst, decoy, selfBuff.

import { dealDamage } from './combat.js';
import { angleDiff, len } from '../core/math.js';

const hitBuf = [];
const DEG = Math.PI / 180;

function swingFx(ctx, p, angle) {
  const u = ctx.user;
  const m = ctx.match;
  const reach = p.reach * ctx.rangeMul;
  if (p.style === 'jab' || p.style === 'shove') {
    const x2 = u.x + Math.cos(angle) * reach;
    const y2 = u.y + Math.sin(angle) * reach;
    m.particles.line(u.x + Math.cos(angle) * 4, u.y + Math.sin(angle) * 4, x2, y2, p.style === 'shove' ? '#c0cbdc' : '#ffffff', 0.08, p.style === 'shove' ? 3 : 2);
  } else {
    m.particles.arc(u.x, u.y - 2, angle, p.arc * DEG, reach - 2, p.color || '#ffffff', 0.14, 2);
    m.particles.arc(u.x, u.y - 2, angle, p.arc * DEG * 0.8, reach - 6, '#8b93af', 0.1, 1);
  }
  u.swingT = u.swingDur = p.style === 'jab' ? 0.08 : 0.14;
  u.swingArc = p.arc * DEG;
  u.swingDir = -u.swingDir || 1;
  u.swingStyle = p.style || 'slash';
}

/** One arc hit test from the user's position. */
function arcStrike(ctx, angle) {
  const p = ctx.params;
  const u = ctx.user;
  const m = ctx.match;
  if (!u.alive) return 0;
  const reach = p.reach * ctx.rangeMul;
  const half = (p.arc * DEG) / 2;
  m.grid.query(u.x, u.y, reach + 8, hitBuf);
  let hits = 0;
  for (let i = 0; i < hitBuf.length; i++) {
    const t = hitBuf[i];
    if (t === u || !t.alive) continue;
    const dx = t.x - u.x;
    const dy = t.y - u.y;
    const d = len(dx, dy);
    if (d - t.r > reach) continue;
    if (d > t.r + 2) {
      const slack = Math.asin(Math.min(1, t.r / d));
      if (Math.abs(angleDiff(angle, Math.atan2(dy, dx))) > half + slack) continue;
    }
    if (!m.map.lineOfSight(u.x, u.y, t.x, t.y)) continue;
    dealDamage(m, t, p.damage, {
      source: u, item: ctx.item, kind: 'melee', dx, dy,
      knockback: p.knockback, stun: p.stun, wallStun: p.wallStun, status: p.status,
    });
    hits++;
  }
  return hits;
}

export const ACTIONS = {
  /**
   * Melee arc in front of the user.
   * params: damage, arc (deg), reach (px), knockback, lunge, hits, hitGap, stun, wallStun, status, style, color
   */
  meleeArc: {
    fire(ctx) {
      const p = ctx.params;
      const u = ctx.user;
      const angle = ctx.angle;
      if (p.lunge) { u.kbx += Math.cos(angle) * p.lunge; u.kby += Math.sin(angle) * p.lunge; }
      swingFx(ctx, p, angle);
      arcStrike(ctx, angle);
      const n = p.hits || 1;
      for (let k = 1; k < n; k++) {
        ctx.match.later(p.hitGap * k, () => {
          if (!u.alive) return;
          swingFx(ctx, p, u.aimAngle);
          arcStrike(ctx, u.aimAngle);
        });
      }
    },
  },

  /**
   * Straight projectile(s).
   * params: damage, speed, range, radius, knockback, count, spread (deg), pierce, bounce,
   *         returns, catchCdMul, stun, status, kind, color
   */
  projectile: {
    fire(ctx) {
      const p = ctx.params;
      const u = ctx.user;
      const m = ctx.match;
      const n = p.count || 1;
      const spread = (p.spread || 0) * DEG * ctx.spreadMul;
      for (let i = 0; i < n; i++) {
        const a = ctx.angle + (n > 1 ? -spread / 2 + (spread * i) / (n - 1) : 0);
        const proj = m.projectiles.spawn({
          kind: p.kind || 'bolt', color: p.color || '#ffffff', def: ctx.item.def,
          x: u.x + Math.cos(a) * 6, y: u.y + Math.sin(a) * 6 - 2,
          vx: Math.cos(a) * p.speed, vy: Math.sin(a) * p.speed,
          radius: p.radius || 2, owner: u, item: ctx.item,
          damage: p.damage, knockback: p.knockback || 0, stun: p.stun || 0, status: p.status || null,
          range: (p.range || 200) * ctx.rangeMul, pierce: p.pierce || 0, bounce: p.bounce || 0,
          returns: !!p.returns, catchCdMul: p.catchCdMul ?? 1,
        });
        if (proj && p.returns) ctx.item.out++;
      }
      m.particles.spray(u.x + Math.cos(ctx.angle) * 7, u.y + Math.sin(ctx.angle) * 7, ctx.angle, 0.6, 3, '#ffffff', 30, 80, 0.12);
    },
  },

  /**
   * Hold to draw, release to fire `release` with params lerped from min to max by draw.
   * params: minDraw, maxDraw (s), moveMul, release (action), min{}, max{}, common{}
   * Integer params (pierce, count, bounce) use the max value only on a full draw.
   */
  chargeRelease: {
    mode: 'charge',
    fire(ctx) {
      const p = ctx.params;
      const t = ctx.charge;
      const out = { ...p.common };
      for (const k in p.max) {
        const a = p.min[k] ?? p.max[k];
        const b = p.max[k];
        out[k] = Number.isInteger(a) && Number.isInteger(b) && (k === 'pierce' || k === 'count' || k === 'bounce')
          ? (t >= 0.999 ? b : a)
          : a + (b - a) * t;
      }
      if (t >= 0.999) ctx.match.particles.ring(ctx.user.x, ctx.user.y, 2, 10, '#ffffff', 0.15);
      ACTIONS[p.release].fire({ ...ctx, params: out });
    },
  },

  /**
   * Lob a pot to the aim point (clamped to range); it ignores cover and leaves an area.
   * params: range, speed, kind, color, area{ radius, duration, dps, style, tags, status, ignite }
   */
  throwArea: {
    fire(ctx) {
      const p = ctx.params;
      const u = ctx.user;
      const m = ctx.match;
      let dx = ctx.ax - u.x;
      let dy = ctx.ay - u.y;
      let d = len(dx, dy);
      const maxR = p.range * ctx.rangeMul;
      if (d < 1) { dx = Math.cos(ctx.angle); dy = Math.sin(ctx.angle); d = 1; }
      const dist = Math.max(16, Math.min(maxR, d));
      let tx = u.x + (dx / d) * dist;
      let ty = u.y + (dy / d) * dist;
      // Never land inside a wall: walk back toward the thrower.
      for (let k = 0; k < 12 && m.map.isSolidAt(tx, ty); k++) {
        tx -= (dx / d) * 8;
        ty -= (dy / d) * 8;
      }
      m.projectiles.spawn({
        kind: p.kind || 'pot', color: p.color || '#c86f3b', def: ctx.item.def,
        x: u.x, y: u.y, vx: 0, vy: 0, owner: u, item: ctx.item,
        lob: true, tx, ty, lobDur: Math.max(0.25, dist / p.speed), arcH: 10 + dist * 0.18,
        area: p.area,
      });
    },
  },

  /**
   * Short parry window facing the aim. Melee hits into it are countered (riposte),
   * projectiles into it are reflected.
   * params: window (s), arc (deg), counterDamage, stun
   */
  parry: {
    fire(ctx) {
      const p = ctx.params;
      const u = ctx.user;
      const pr = u.parry;
      pr.t = p.window;
      pr.angle = ctx.angle;
      pr.arc = p.arc * DEG;
      pr.counterDamage = p.counterDamage;
      pr.stun = p.stun || 0;
      pr.item = ctx.item;
      ctx.match.particles.arc(u.x, u.y - 2, ctx.angle, pr.arc, 12, '#73eff7', p.window, 1);
    },
  },

  /**
   * A projectile that circles the user, hitting fighters and blocking enemy projectiles.
   * params: duration, radius (orbit px), spin (rad/s), damage, hitEvery, knockback, kind, color
   */
  orbit: {
    fire(ctx) {
      const p = ctx.params;
      const u = ctx.user;
      ctx.match.projectiles.spawn({
        kind: p.kind || 'boomerang', color: p.color || '#ffffff', def: ctx.item.def,
        x: u.x, y: u.y, vx: 0, vy: 0, radius: 4, owner: u, item: ctx.item,
        orbit: true, orbitA: ctx.angle, orbitR: p.radius, spin: p.spin, life: p.duration,
        damage: p.damage, hitEvery: p.hitEvery, knockback: p.knockback || 0,
      });
    },
  },
};
