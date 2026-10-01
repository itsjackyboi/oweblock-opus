// Generic item action primitives. Items compose these through their entries in
// js/data/; nothing here knows about a specific item.
//
// Every action has fire(ctx). ctx = { match, user, item, params, angle, ax, ay,
// stance, rangeMul, spreadMul, charge }. `mode: 'charge'` actions are held to
// draw and fire on release with ctx.charge in 0..1.
//
// Primitives: meleeArc (combo, backstab, outer sweet spot), thrust, dashStrike,
// projectile (pierce, bounce, returns, toCursor + burst, trail, stagger), chargeRelease,
// throwArea, parry, orbit, shockwave, spin, salvo, hookPull, hookSelf, channelBeam,
// sweepBeam, placeTrap, castArea, areaAura, decoy, cone, selfBuff, consume,
// spawnCover, burst, detonate.
// Activities (channel, whirl, brace) live on fighter.activity and are ticked by items.js.

import { dealDamage } from './combat.js';
import { angleDiff, len } from '../core/math.js';
import { addStatus } from './statuses.js';
import { TILE } from '../config.js';
import { T } from './map.js';

const hitBuf = [];
/** Firing sound per projectile kind. */
const SHOT_SFX = { arrow: 'shoot', bolt: 'bolt', knife: 'knife', boomerang: 'whoosh', hook: 'hook', net: 'net', hoop: 'fire', sliver: 'shatter' };
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
  m.sfx(p.style === 'jab' || p.style === 'shove' ? 'jab' : 'swing', u.x, u.y);
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
    let dmg = p.damage;
    // Backstab: hitting someone who faces away.
    if (p.backstabMul && Math.abs(angleDiff(t.aimAngle, Math.atan2(dy, dx))) < Math.PI * 0.45) {
      dmg *= p.backstabMul;
      if (u.isPlayer || t.isPlayer) m.particles.popup(t.x, t.y - 22, 'BACKSTAB', '#e43b44');
    }
    // Sweet spot at the outer edge of the reach (flail).
    if (p.outerBand && d - t.r >= reach - p.outerBand) dmg *= p.outerMul || 1.5;
    dealDamage(m, t, dmg, {
      source: u, item: ctx.item, kind: 'melee', dx, dy,
      knockback: p.knockback, stun: p.stun, wallStun: p.wallStun, status: p.status,
    });
    if (p.killResetsDash && !t.alive) u.dashCd = 0;
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
      let p = ctx.params;
      // Combo: successive swings within comboWindow use combo[0], combo[1], ...
      if (p.combo) {
        const st = ctx.item.state;
        const t = ctx.match.time;
        st.comboI = t - (st.comboT ?? -99) <= (p.comboWindow || 1) ? ((st.comboI ?? -1) + 1) % p.combo.length : 0;
        st.comboT = t;
        p = { ...p, ...p.combo[st.comboI] };
        ctx = { ...ctx, params: p };
        if (st.comboI === p.combo.length - 1 && (ctx.user.isPlayer)) ctx.match.particles.popup(ctx.user.x, ctx.user.y - 20, 'CLEAVE', '#e43b44');
      }
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
      // Stagger: fire the shots one after another (juggled knives) instead of in a fan.
      if (p.stagger && n > 1 && !ctx.staggered) {
        for (let i = 0; i < n; i++) {
          m.later(p.stagger * i, () => {
            if (!u.alive) return;
            ACTIONS.projectile.fire({ ...ctx, angle: u.aimAngle, ax: u.intents.aimX, ay: u.intents.aimY, staggered: true, params: { ...p, count: 1 } });
          });
        }
        return;
      }
      let range = (p.range || 200) * ctx.rangeMul;
      if (p.toCursor) range = Math.max(24, Math.min(range, len(ctx.ax - u.x, ctx.ay - u.y)));
      for (let i = 0; i < n; i++) {
        const a = ctx.angle + (n > 1 ? -spread / 2 + (spread * i) / (n - 1) : 0);
        const proj = m.projectiles.spawn({
          kind: p.kind || 'bolt', color: p.color || '#ffffff', def: ctx.item.def,
          x: u.x + Math.cos(a) * 6, y: u.y + Math.sin(a) * 6 - 2,
          vx: Math.cos(a) * p.speed, vy: Math.sin(a) * p.speed,
          radius: p.radius || 2, owner: u, item: ctx.item,
          damage: p.damage, knockback: p.knockback || 0, stun: p.stun || 0, status: p.status || null,
          range, pierce: p.pierce || 0, bounce: p.bounce || 0,
          returns: !!p.returns, catchCdMul: p.catchCdMul ?? 1,
          hook: p.hook || null, pullDist: p.pullDist || 0, burst: p.burst || null, trail: p.trail || null,
        });
        if (proj && p.returns) ctx.item.out++;
      }
      m.particles.spray(u.x + Math.cos(ctx.angle) * 7, u.y + Math.sin(ctx.angle) * 7, ctx.angle, 0.6, 3, '#ffffff', 30, 80, 0.12);
      m.sfx(SHOT_SFX[p.kind] || 'shoot', u.x, u.y);
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
      m.sfx('throw', u.x, u.y);
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
      ctx.match.sfx('parry', u.x, u.y);
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

/** Aim point clamped to `range` from the user, walked back out of walls. */
function aimPoint(ctx, range) {
  const u = ctx.user;
  const m = ctx.match;
  let dx = ctx.ax - u.x;
  let dy = ctx.ay - u.y;
  let d = len(dx, dy);
  if (d < 1) { dx = Math.cos(ctx.angle); dy = Math.sin(ctx.angle); d = 1; }
  const dist = Math.min(range * ctx.rangeMul, d);
  let x = u.x + (dx / d) * dist;
  let y = u.y + (dy / d) * dist;
  for (let k = 0; k < 16 && m.map.isSolidAt(x, y); k++) { x -= (dx / d) * 6; y -= (dy / d) * 6; }
  return { x, y };
}

/** Damage every fighter whose body crosses the segment (once each). */
function beamHit(ctx, x0, y0, x1, y1, width, damage, hitSet, extra = {}) {
  const m = ctx.match;
  const u = ctx.user;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  m.grid.query(mx, my, len(x1 - x0, y1 - y0) / 2 + width + 8, hitBuf);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l2 = dx * dx + dy * dy || 1;
  for (let i = 0; i < hitBuf.length; i++) {
    const t = hitBuf[i];
    if (t === u || !t.alive || hitSet.has(t.id)) continue;
    let k = ((t.x - x0) * dx + (t.y - y0) * dy) / l2;
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    const cx = x0 + dx * k;
    const cy = y0 + dy * k;
    if (len(t.x - cx, t.y - cy) > t.r + width / 2) continue;
    hitSet.add(t.id);
    dealDamage(m, t, damage, { source: u, item: ctx.item, kind: 'projectile', dx, dy, knockback: extra.knockback || 60, status: extra.status || null });
  }
}

function beamFx(m, x0, y0, x1, y1, color, width) {
  m.particles.line(x0, y0, x1, y1, color, 0.25, width + 2);
  m.particles.line(x0, y0, x1, y1, '#ffffff', 0.15, Math.max(1, width - 1));
}

Object.assign(ACTIONS, {
  /** Narrow, short stab. Same params as meleeArc (arc defaults to 30). */
  thrust: {
    fire(ctx) {
      ACTIONS.meleeArc.fire({ ...ctx, params: { arc: 30, style: 'jab', ...ctx.params } });
    },
  },

  /**
   * Dash forward, then strike. params: distance, time, hit{ meleeArc params }, invuln
   */
  dashStrike: {
    fire(ctx) {
      const p = ctx.params;
      const u = ctx.user;
      const a = ctx.angle;
      const v = p.distance / p.time;
      u.lungeT = p.time;
      u.lungeVX = Math.cos(a) * v;
      u.lungeVY = Math.sin(a) * v;
      if (p.invuln) u.invuln = Math.max(u.invuln, p.time);
      u.squash = -0.6;
      ctx.match.particles.burst(u.x, u.y + 4, 6, '#c0cbdc', 20, 60, 0.25);
      ctx.match.later(p.time, () => {
        if (!u.alive) return;
        ACTIONS.meleeArc.fire({ ...ctx, angle: a, params: { arc: 90, reach: 18, style: 'slash', ...p.hit } });
      });
    },
  },

  /** Radial blast around the user. params: radius, damage, knockback, status, stun, color */
  shockwave: {
    fire(ctx) {
      const p = ctx.params;
      const u = ctx.user;
      const m = ctx.match;
      m.grid.query(u.x, u.y, p.radius + 8, hitBuf);
      for (let i = 0; i < hitBuf.length; i++) {
        const t = hitBuf[i];
        if (t === u || !t.alive) continue;
        if (len(t.x - u.x, t.y - u.y) > p.radius + t.r) continue;
        dealDamage(m, t, p.damage, { source: u, item: ctx.item, kind: 'melee', knockback: p.knockback || 0, status: p.status || null, stun: p.stun || 0, wallStun: p.wallStun || 0 });
      }
      m.particles.ring(u.x, u.y, 4, p.radius, p.color || '#c0cbdc', 0.3, 3);
      m.sfx('boom', u.x, u.y);
      m.particles.ring(u.x, u.y, 2, p.radius * 0.7, '#ffffff', 0.2, 1);
      m.particles.burst(u.x, u.y + 3, 18, '#c0cbdc', 40, 160, 0.4);
      if (m.isNearPlayer(u.x, u.y)) m.shake(0.35);
    },
  },

  /** Whirl: 360-degree strikes every `every` s for `duration`, moving at moveMul. */
  spin: {
    fire(ctx) {
      const p = ctx.params;
      const u = ctx.user;
      u.activity = {
        item: ctx.item, t: 0, dur: p.duration, every: p.every, next: 0, lock: true, moveMul: p.moveMul ?? 0.7,
        onTick: () => {
          const c = { ...ctx, params: { ...p, arc: 360, style: 'spin' } };
          u.swingT = u.swingDur = p.every;
          u.swingArc = Math.PI * 2;
          u.swingStyle = 'slash';
          ctx.match.particles.arc(u.x, u.y - 2, u.aimAngle + ctx.match.time * 12, Math.PI * 1.6, p.reach - 2, p.color || '#ffffff', 0.12, 2);
          arcStrike(c, 0);
        },
      };
    },
  },

  /**
   * Brace: kneel (rooted) for windup, then fire `shots` projectiles `gap` apart (no reload).
   * params: windup, shots, gap, shot{ projectile params }
   */
  salvo: {
    fire(ctx) {
      const p = ctx.params;
      const u = ctx.user;
      addStatus(u, 'root', p.windup, 1, u);
      u.activity = {
        item: ctx.item, t: 0, dur: p.windup + p.shots * p.gap, every: 0, lock: true, moveMul: 0,
        fired: 0,
        onUpdate: (a) => {
          while (a.fired < p.shots && a.t >= p.windup + a.fired * p.gap) {
            a.fired++;
            ACTIONS.projectile.fire({ ...ctx, angle: u.aimAngle, params: p.shot });
          }
        },
      };
      ctx.match.particles.ring(u.x, u.y + 3, 2, 10, '#c0cbdc', p.windup);
    },
  },

  /** Hook that yanks the fighter it hits toward you. params: range, speed, damage, pullDist */
  hookPull: {
    fire(ctx) {
      ACTIONS.projectile.fire({ ...ctx, params: { kind: 'hook', radius: 3, color: '#c0cbdc', ...ctx.params, hook: 'pull' } });
    },
  },

  /** Hook that reels you to the wall or fighter it hits (crosses gaps). params: range, speed, damage */
  hookSelf: {
    fire(ctx) {
      ACTIONS.projectile.fire({ ...ctx, params: { kind: 'hook', radius: 3, color: '#c0cbdc', ...ctx.params, hook: 'self' } });
    },
  },

  /**
   * Channel, then fire a straight beam through walls and fighters.
   * params: channel (s), length, width, damage, color, moveMul
   * A telegraph line shows the beam's path while channelling.
   */
  channelBeam: {
    fire(ctx) {
      const p = ctx.params;
      const u = ctx.user;
      const m = ctx.match;
      const a = ctx.angle;
      const L = p.length * ctx.rangeMul;
      const tg = m.telegraph({ kind: 'line', x: u.x, y: u.y, x2: u.x + Math.cos(a) * L, y2: u.y + Math.sin(a) * L, w: p.width, dur: p.channel, owner: u, color: p.color });
      u.activity = {
        item: ctx.item, t: 0, dur: p.channel, lock: true, moveMul: p.moveMul ?? 0.2,
        onUpdate: () => { tg.x = u.x; tg.y = u.y; tg.x2 = u.x + Math.cos(a) * L; tg.y2 = u.y + Math.sin(a) * L; },
        onEnd: () => {
          tg.t = tg.dur;
          if (!u.alive) return;
          const x1 = u.x + Math.cos(a) * L;
          const y1 = u.y + Math.sin(a) * L;
          beamHit(ctx, u.x, u.y, x1, y1, p.width, p.damage, new Set(), p);
          beamFx(m, u.x, u.y - 2, x1, y1 - 2, p.color || '#b55088', p.width);
          m.sfx('beam', u.x, u.y);
          if (m.isNearPlayer(u.x, u.y)) m.shake(0.3);
        },
      };
    },
  },

  /**
   * Beam that sweeps an arc. params: windup, arc (deg), duration, length, width, damage, color
   */
  sweepBeam: {
    fire(ctx) {
      const p = ctx.params;
      const u = ctx.user;
      const m = ctx.match;
      const a0 = ctx.angle - (p.arc * DEG) / 2;
      const L = p.length * ctx.rangeMul;
      const hit = new Set();
      m.telegraph({ kind: 'arc', x: u.x, y: u.y, r: L, a: ctx.angle, arc: p.arc * DEG, dur: p.windup, owner: u, color: p.color });
      m.later(p.windup, () => m.sfx('beam', u.x, u.y));
      u.activity = {
        item: ctx.item, t: 0, dur: p.windup + p.duration, lock: true, moveMul: 0.2,
        onUpdate: (act) => {
          if (act.t < p.windup) return;
          const k = Math.min(1, (act.t - p.windup) / p.duration);
          const a = a0 + p.arc * DEG * k;
          const x1 = u.x + Math.cos(a) * L;
          const y1 = u.y + Math.sin(a) * L;
          beamHit(ctx, u.x, u.y, x1, y1, p.width, p.damage, hit, p);
          m.particles.line(u.x, u.y - 2, x1, y1 - 2, p.color || '#b55088', 0.08, p.width);
        },
      };
    },
  },

  /** Set a trap at the cursor (within placeRange). params: placeRange, area{ trigger, hidden, group, maxPerOwner } */
  placeTrap: {
    fire(ctx) {
      const p = ctx.params;
      const pt = aimPoint(ctx, p.placeRange);
      ctx.match.areas.spawn(p.area, pt.x, pt.y, ctx.user, ctx.item);
    },
  },

  /** Telegraphed area at the cursor: a ring warns for `windup` s, then the area appears. params: range, windup, area */
  castArea: {
    fire(ctx) {
      const p = ctx.params;
      const m = ctx.match;
      const pt = aimPoint(ctx, p.range);
      m.telegraph({ kind: 'circle', x: pt.x, y: pt.y, r: p.area.radius, dur: p.windup, owner: ctx.user, color: p.color });
      m.sfx('chime', pt.x, pt.y);
      m.later(p.windup, () => m.areas.spawn(p.area, pt.x, pt.y, ctx.user, ctx.item));
    },
  },

  /** An area that follows the user. params: area */
  areaAura: {
    fire(ctx) {
      ctx.match.areas.spawn({ ...ctx.params.area, follow: true }, ctx.user.x, ctx.user.y, ctx.user, ctx.item);
    },
  },

  /** Drop a lure at the cursor that draws AI in (then usually springs something). params: range, area{ lure, then } */
  decoy: {
    fire(ctx) {
      const p = ctx.params;
      const pt = aimPoint(ctx, p.range);
      ctx.match.areas.spawn({ ...p.area, lure: true }, pt.x, pt.y, ctx.user, ctx.item);
    },
  },

  /** Cone push that also turns enemy projectiles around. params: arc (deg), range, knockback, deflect */
  cone: {
    fire(ctx) {
      const p = ctx.params;
      const u = ctx.user;
      const m = ctx.match;
      const half = (p.arc * DEG) / 2;
      const R = p.range * ctx.rangeMul;
      m.grid.query(u.x, u.y, R + 8, hitBuf);
      for (let i = 0; i < hitBuf.length; i++) {
        const t = hitBuf[i];
        if (t === u || !t.alive) continue;
        const dx = t.x - u.x;
        const dy = t.y - u.y;
        const d = len(dx, dy);
        if (d > R + t.r || Math.abs(angleDiff(ctx.angle, Math.atan2(dy, dx))) > half + 0.2) continue;
        const k = p.knockback * (1 - (d / (R + t.r)) * 0.5);
        t.kbx += (dx / (d || 1)) * k;
        t.kby += (dy / (d || 1)) * k;
        if (p.wallStun) { t.wallStunArm = p.wallStun; t.wallStunT = 0.35; }
        if (p.damage) dealDamage(m, t, p.damage, { source: u, item: ctx.item, kind: 'melee' });
        else { t.lastHitBy = u; t.lastHitTime = m.time; }
      }
      if (p.deflect) {
        const act = m.projectiles.pool.active;
        for (let i = 0; i < act.length; i++) {
          const q = act[i];
          if (!q.alive || q.owner === u || q.orbit || q.lob) continue;
          const dx = q.x - u.x;
          const dy = q.y - u.y;
          const d = len(dx, dy);
          if (d > R || Math.abs(angleDiff(ctx.angle, Math.atan2(dy, dx))) > half) continue;
          const sp = q.speed;
          q.vx = Math.cos(ctx.angle) * sp;
          q.vy = Math.sin(ctx.angle) * sp;
          q.owner = u;
          q.item = ctx.item;
          q.travel = 0;
          q.returns = false;
          q.hitIds.length = 0;
        }
      }
      m.sfx('gust', u.x, u.y);
      for (let k = 0; k < 10; k++) {
        const a = ctx.angle + (Math.random() - 0.5) * p.arc * DEG;
        const sp = 120 + Math.random() * 120;
        m.particles.spawn(u.x + Math.cos(a) * 6, u.y + Math.sin(a) * 6, Math.cos(a) * sp, Math.sin(a) * sp, 0.3, '#ffffff', 1, 4);
      }
    },
  },

  /** Apply a status to yourself. params: status{ name, t, v } */
  selfBuff: {
    fire(ctx) {
      const s = ctx.params.status;
      addStatus(ctx.user, s.name, s.t, s.v, ctx.user);
      ctx.match.particles.ring(ctx.user.x, ctx.user.y, 3, 14, ctx.params.color || '#ffffff', 0.3);
      ctx.match.sfx('gust', ctx.user.x, ctx.user.y);
    },
  },

  /** Drink: heal over time, then an after-effect. params: heal, healTime, after{ name, t, v } */
  consume: {
    fire(ctx) {
      const p = ctx.params;
      const u = ctx.user;
      addStatus(u, 'mend', p.healTime, p.heal / p.healTime, u);
      if (p.after) ctx.match.later(p.healTime, () => { if (u.alive) addStatus(u, p.after.name, p.after.t, p.after.v, u); });
      ctx.match.particles.burst(u.x, u.y - 6, 10, ctx.params.color || '#e43b44', 20, 60, 0.5);
      ctx.match.sfx('drink', u.x, u.y);
      if (u.isPlayer) ctx.match.particles.popup(u.x, u.y - 18, `+${p.heal}`, '#38b764');
    },
  },

  /** Grow a solid cover block (crystal) at the cursor tile. params: placeRange, hp, max */
  spawnCover: {
    fire(ctx) {
      const p = ctx.params;
      const m = ctx.match;
      const pt = aimPoint(ctx, p.placeRange);
      const tx = Math.floor(pt.x / TILE);
      const ty = Math.floor(pt.y / TILE);
      if (m.map.get(tx, ty) !== T.FLOOR) return;
      // Not on top of anyone.
      m.grid.query((tx + 0.5) * TILE, (ty + 0.5) * TILE, TILE, hitBuf);
      for (let i = 0; i < hitBuf.length; i++) {
        const f = hitBuf[i];
        if (f.alive && Math.abs(f.x - (tx + 0.5) * TILE) < TILE / 2 + f.r && Math.abs(f.y - (ty + 0.5) * TILE) < TILE / 2 + f.r) return;
      }
      m.addCover(tx, ty, p.hp, ctx.user, p.max || 4);
      m.particles.burst((tx + 0.5) * TILE, (ty + 0.5) * TILE, 10, '#b55088', 20, 70, 0.4);
      m.sfx('crystal', (tx + 0.5) * TILE, (ty + 0.5) * TILE);
    },
  },

  /** Shatter: each of the user's covers bursts into `count` slivers. params: count, damage, speed, range */
  burst: {
    fire(ctx) {
      const p = ctx.params;
      const m = ctx.match;
      for (const c of m.coversOf(ctx.user)) {
        const cx = (c.tx + 0.5) * TILE;
        const cy = (c.ty + 0.5) * TILE;
        m.removeCover(c.tx, c.ty);
        m.sfx('shatter', cx, cy);
        for (let k = 0; k < p.count; k++) {
          const a = (k / p.count) * Math.PI * 2;
          m.projectiles.spawn({
            kind: 'sliver', color: '#b55088', def: ctx.item.def, x: cx + Math.cos(a) * 9, y: cy + Math.sin(a) * 9,
            vx: Math.cos(a) * p.speed, vy: Math.sin(a) * p.speed, radius: 2, owner: ctx.user, item: ctx.item,
            damage: p.damage, knockback: 50, range: p.range,
          });
        }
      }
    },
  },

  /** Set off all of the user's areas in a group now (kegs). params: group */
  detonate: {
    fire(ctx) {
      ctx.match.areas.detonate(ctx.user, ctx.params.group);
    },
  },
});
