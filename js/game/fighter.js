// Fighter entity, shared by the player and every AI. Controllers write `intents`;
// the fighter turns intents into movement and dashing, and items.js turns them
// into item use.

import { FIGHTER, SLOT_COUNT, COMBAT, STANCE } from '../config.js';
import { clamp, len } from '../core/math.js';
import { createItem } from '../data/registry.js';
import { makeStatuses, updateStatuses, moveMul, addStatus, has } from './statuses.js';
import { dealDamage } from './combat.js';
import { heldItem, itemMoveMul, chargeFrac } from './items.js';
import { drawItemIcon } from '../ui/icons.js';
import { drawText, measure } from '../ui/font.js';

/** Blank intents object; controllers fill it every update. */
export function makeIntents() {
  return {
    moveX: 0, moveY: 0, // desired direction, length <= 1
    aimX: 0, aimY: 0, // world-space aim point
    use: false, usePressed: false, useReleased: false,
    special: false, specialPressed: false,
    stance: false, // aim stance (right mouse)
    dash: false,
    swapTo: -1, // slot index, or -1
    swapStep: 0, // +1 / -1 to cycle slots
    pickup: false,
  };
}

const moveOut = { x: 0, y: 0, hitX: false, hitY: false };

const dot = (f, amount, src) => dealDamage(f.match, f, amount, { source: src, kind: 'dot' });

export class Fighter {
  constructor(id, opts) {
    this.id = id;
    this.match = opts.match;
    this.name = opts.name || 'FIGHTER';
    this.fullName = opts.fullName || this.name;
    this.isPlayer = !!opts.isPlayer;
    this.named = !!opts.named;
    this.appearance = opts.appearance;
    this.controller = opts.controller || null;
    this.tier = opts.tier || null;

    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.vx = 0; this.vy = 0; // self-propelled velocity
    this.kbx = 0; this.kby = 0; // knockback velocity
    this.r = FIGHTER.radius;

    this.maxHp = FIGHTER.baseHp * (opts.hpMul || 1);
    this.hp = this.maxHp;
    this.alive = true;

    this.stats = {
      speedMul: opts.speedMul || 1, damageMul: 1, cdMul: 1, dashCdMul: 1, dashDistMul: 1,
      pickupMul: 1, armor: 0, regen: 0,
    };
    this.slots = new Array(SLOT_COUNT).fill(null);
    this.held = 0;
    this.fists = createItem('fists');
    this.swapT = 0;
    this.statuses = makeStatuses();
    this.parry = { t: 0, angle: 0, arc: 0, counterDamage: 0, stun: 0, item: null };
    this.shield = 0; // one-shot damage reduction (Amethyst Shard)

    this.xp = 0; // progress within the current level
    this.xpTotal = 0; // banked XP
    this.level = 1;
    this.pendingLevelUps = 0;
    this.kills = 0;
    this.damageDealt = 0;
    this.lastHitBy = null;
    this.lastHitTime = -99;
    this.lastHitItem = null;
    this.diedAt = 0;
    this.placement = 0;
    this.exposure = 0; // seconds continuously outside the zone
    this.zoneTick = 0;
    this.zoneImmune = !!opts.zoneImmune;
    this.extra = !!opts.extra; // not a battle-royale contestant (police hunters)
    this.gang = opts.gang || 'grey';
    this.onDeath = opts.onDeath || null;

    this.dashT = 0; // > 0 while dashing
    this.dashCd = 0;
    this.invuln = 0;
    this.dashDX = 0; this.dashDY = 0;
    this.wallStunArm = 0;
    this.wallStunT = 0;

    this.facing = 1;
    this.aimAngle = 0;
    this.intents = makeIntents();

    // Procedural animation state.
    this.walkPhase = 0;
    this.flash = 0;
    this.squash = 0;
    this.lean = 0;
    this.moving = false;
    this.swingT = 0;
    this.swingDur = 0.1;
    this.swingArc = 0;
    this.swingDir = 1;
    this.swingStyle = 'slash';
  }

  get dashing() { return this.dashT > 0; }

  update(dt, match) {
    const it = this.intents;
    const map = match.map;

    updateStatuses(this, dt, dot);
    if (!this.alive) return;
    if (this.stats.regen > 0 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.stats.regen * dt);

    // Aim and facing.
    const ax = it.aimX - this.x;
    const ay = it.aimY - this.y;
    if (ax * ax + ay * ay > 1) this.aimAngle = Math.atan2(ay, ax);
    if (Math.abs(ax) > 2) this.facing = ax < 0 ? -1 : 1;

    // Input direction (clamped to unit length), scaled by everything that slows you.
    let mx = it.moveX;
    let my = it.moveY;
    const ml = len(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    const statusMul = moveMul(this);

    // Dash start (not while stunned or rooted).
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    if (it.dash && this.dashCd <= 0 && !this.dashing && statusMul > 0) {
      let dx = mx;
      let dy = my;
      if (ml < 0.1) { dx = Math.cos(this.aimAngle); dy = Math.sin(this.aimAngle); }
      const dl = len(dx, dy) || 1;
      this.dashDX = dx / dl;
      this.dashDY = dy / dl;
      this.dashT = FIGHTER.dashTime * this.stats.dashDistMul;
      this.invuln = Math.max(this.invuln, FIGHTER.dashInvuln);
      this.dashCd = FIGHTER.dashCooldown * this.stats.dashCdMul;
      this.squash = -0.6; // stretch
      match.events.emit('dash', { fighter: this });
      match.particles.burst(this.x, this.y + 4, 5, '#c0cbdc', 20, 60, 0.25);
    }

    const speed = FIGHTER.speed * this.stats.speedMul * statusMul * itemMoveMul(this) * (it.stance ? STANCE.speedMul : 1);
    const slippery = has(this, 'slippery');
    if (this.dashing) {
      this.dashT -= dt;
      this.vx = this.dashDX * FIGHTER.dashSpeed;
      this.vy = this.dashDY * FIGHTER.dashSpeed;
      if (this.dashT <= 0) {
        // Leave the dash at run speed so it flows back into movement.
        const s = FIGHTER.speed * this.stats.speedMul;
        this.vx = this.dashDX * s;
        this.vy = this.dashDY * s;
      }
    } else {
      const tx = mx * speed;
      const ty = my * speed;
      let rate = (ml > 0.05 && speed > 0 ? FIGHTER.accel : FIGHTER.friction) * dt;
      if (slippery) rate *= 0.12;
      const dvx = tx - this.vx;
      const dvy = ty - this.vy;
      const dl = len(dvx, dvy);
      if (dl <= rate) { this.vx = tx; this.vy = ty; } else { this.vx += (dvx / dl) * rate; this.vy += (dvy / dl) * rate; }
    }

    // Knockback decays on its own.
    const kl = len(this.kbx, this.kby);
    if (kl > 0) {
      const nk = Math.max(0, kl - FIGHTER.knockbackFriction * (slippery ? 0.3 : 1) * dt);
      this.kbx *= nk / kl;
      this.kby *= nk / kl;
    }
    if (this.wallStunT > 0) this.wallStunT -= dt;

    const totalX = this.vx + this.kbx;
    const totalY = this.vy + this.kby;
    map.moveCircle(this.x, this.y, this.r, totalX * dt, totalY * dt, this.dashing, moveOut);
    this.x = moveOut.x;
    this.y = moveOut.y;
    if (moveOut.hitX || moveOut.hitY) {
      const slam = (moveOut.hitX ? Math.abs(this.kbx) : 0) + (moveOut.hitY ? Math.abs(this.kby) : 0);
      if (slam > COMBAT.wallSlamSpeed) {
        match.events.emit('wallSlam', { fighter: this, speed: slam });
        match.particles.burst(this.x, this.y, 8, '#c0cbdc', 30, 90, 0.3);
        if (this.wallStunT > 0 && this.wallStunArm > 0) {
          addStatus(this, 'stun', this.wallStunArm, 1, this.lastHitBy);
          this.wallStunT = 0;
          if (match.isNearPlayer(this.x, this.y)) match.shake(0.2);
        }
      }
      if (moveOut.hitX) { this.vx = 0; this.kbx = 0; }
      if (moveOut.hitY) { this.vy = 0; this.kby = 0; }
    }

    // Animation.
    const sp = len(this.vx, this.vy);
    this.moving = sp > 12;
    if (this.moving) this.walkPhase += dt * (8 + sp * 0.06);
    else this.walkPhase = 0;
    this.lean += (clamp(this.vx / FIGHTER.speed, -1, 1) * 0.12 - this.lean) * Math.min(1, dt * 14);
    this.flash = Math.max(0, this.flash - dt);
    this.squash *= Math.max(0, 1 - dt * 12);
    if (this.swingT > 0) this.swingT -= dt;
  }
}

/** Draw a fighter with procedural animation: bob, lean, flip toward aim, squash on hit. */
export function drawFighter(ctx, f, cam, sprites, assets) {
  const spr = sprites.get(f.appearance);
  const x = Math.round(f.x - cam.ox);
  const y = Math.round(f.y - cam.oy);
  if (x < -24 || y < -24 || x > cam.w + 24 || y > cam.h + 24) return false;

  // Shadow.
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000000';
  ctx.fillRect(x - 4, y + 4, 8, 2);
  ctx.fillRect(x - 3, y + 3, 6, 1);
  ctx.fillRect(x - 3, y + 6, 6, 1);
  ctx.globalAlpha = 1;

  const bob = f.moving ? -Math.abs(Math.sin(f.walkPhase)) * 1.5 : 0;
  const sq = f.squash;
  const sx = (1 + sq * 0.25) * f.facing;
  const sy = 1 - sq * 0.25;

  // Dash afterimage.
  if (f.dashing) {
    ctx.globalAlpha = 0.35;
    ctx.setTransform(sx, 0, 0, sy, x - f.dashDX * 7, y + 6 - f.dashDY * 7);
    ctx.drawImage(spr.flash, -8, -16);
    ctx.globalAlpha = 1;
  }

  const item = heldItem(f);
  const aimUp = Math.sin(f.aimAngle) < -0.3;
  if (aimUp) drawHeld(ctx, f, item, x, y + bob, assets); // behind the body when aiming up

  const c = Math.cos(f.lean);
  const s = Math.sin(f.lean);
  // translate(feet) * rotate(lean) * scale(sx, sy)
  ctx.setTransform(c * sx, s * sx, -s * sy, c * sy, x, Math.round(y + 6 + bob));
  ctx.drawImage(f.flash > 0 ? spr.flash : spr.normal, -8, -16);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (!aimUp) drawHeld(ctx, f, item, x, y + bob, assets);

  // Status marks.
  if (f.statuses.stun.t > 0) {
    const t = performance.now() / 120;
    ctx.fillStyle = '#ffcd75';
    for (let k = 0; k < 3; k++) ctx.fillRect(Math.round(x + Math.cos(t + k * 2.1) * 5), Math.round(y - 14 + Math.sin(t + k * 2.1) * 2), 1, 1);
  }
  if (f.statuses.burn.t > 0 && Math.random() < 0.5) {
    ctx.fillStyle = Math.random() < 0.5 ? '#fe8b3a' : '#ffcd75';
    ctx.fillRect(x - 4 + ((Math.random() * 8) | 0), y - 8 - ((Math.random() * 6) | 0), 1, 1);
  }
  if (f.parry.t > 0) {
    ctx.strokeStyle = '#73eff7';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y - 2, 11, f.parry.angle - f.parry.arc / 2, f.parry.angle + f.parry.arc / 2);
    ctx.stroke();
  }
  return true;
}

/** The held item in the hand, rotated toward the aim, with a procedural swing. */
function drawHeld(ctx, f, item, x, y, assets) {
  const hold = item.def.hold || {};
  if (hold.hidden) {
    // Fists: a small knuckle that punches out during a jab.
    const k = f.swingT > 0 ? Math.sin((1 - f.swingT / f.swingDur) * Math.PI) : 0;
    const d = 6 + k * 6;
    ctx.fillStyle = '#1a1c2c';
    ctx.fillRect(Math.round(x + Math.cos(f.aimAngle) * d) - 2, Math.round(y - 1 + Math.sin(f.aimAngle) * d) - 2, 4, 4);
    ctx.fillStyle = item.def.color;
    ctx.fillRect(Math.round(x + Math.cos(f.aimAngle) * d) - 1, Math.round(y - 1 + Math.sin(f.aimAngle) * d) - 1, 2, 2);
    return;
  }
  let a = f.aimAngle;
  let dist = hold.dist ?? 6;
  if (f.swingT > 0) {
    const k = 1 - f.swingT / f.swingDur; // 0 -> 1
    if (f.swingStyle === 'slash') a += f.swingDir * f.swingArc * (k - 0.5);
    else dist += Math.sin(k * Math.PI) * 5;
  }
  const charge = chargeFrac(f);
  if (charge >= 0) dist -= charge * 2;
  const size = hold.size ?? 12;
  ctx.save();
  ctx.translate(Math.round(x + Math.cos(a) * dist), Math.round(y - 1 + Math.sin(a) * dist));
  ctx.rotate(a + ((hold.rot ?? 90) * Math.PI) / 180);
  drawItemIcon(ctx, assets, item.def, -size / 2, -size / 2, size);
  ctx.restore();
  if (charge >= 0) {
    // Draw line: grows with the draw, flashes white when full.
    const L = 6 + charge * 14;
    ctx.strokeStyle = charge >= 1 ? '#ffffff' : '#ffcd75';
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(f.aimAngle) * 8, y - 1 + Math.sin(f.aimAngle) * 8);
    ctx.lineTo(x + Math.cos(f.aimAngle) * (8 + L), y - 1 + Math.sin(f.aimAngle) * (8 + L));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

const TAG_COLOR = { red: '#e43b44', blue: '#41a6f6', police: '#8b93af', grey: '#c0cbdc' };

/** Name tag over named fighters (and police hunters). */
export function drawNameTag(ctx, f, cam) {
  const x = Math.round(f.x - cam.ox);
  const y = Math.round(f.y - cam.oy) - 22;
  if (x < -60 || y < -10 || x > cam.w + 60 || y > cam.h + 10) return;
  const w = measure(f.name);
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = '#000000';
  ctx.fillRect(x - Math.ceil(w / 2) - 2, y - 1, w + 4, 9);
  ctx.globalAlpha = 1;
  drawText(ctx, f.name, x, y, { color: TAG_COLOR[f.gang] || '#ffffff', align: 'center' });
  // Tiny HP bar under the tag.
  const hw = Math.max(10, Math.min(30, w));
  ctx.fillStyle = '#3a1d2a';
  ctx.fillRect(x - Math.round(hw / 2), y + 9, hw, 1);
  ctx.fillStyle = '#38b764';
  ctx.fillRect(x - Math.round(hw / 2), y + 9, Math.round(hw * Math.max(0, f.hp / f.maxHp)), 1);
}
