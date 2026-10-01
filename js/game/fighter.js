// Fighter entity, shared by the player and every AI. Controllers write `intents`;
// the fighter turns intents into movement, dashing and (later) item use.

import { FIGHTER, SLOT_COUNT, HIT_FLASH } from '../config.js';
import { clamp, len } from '../core/math.js';

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

export class Fighter {
  constructor(id, opts) {
    this.id = id;
    this.name = opts.name || 'FIGHTER';
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

    this.stats = { speedMul: opts.speedMul || 1, dashCdMul: 1, dashDistMul: 1 };
    this.slots = new Array(SLOT_COUNT).fill(null);
    this.held = 0;
    this.statuses = {};
    this.xp = 0;
    this.level = 1;

    this.dashT = 0; // > 0 while dashing
    this.dashCd = 0;
    this.invuln = 0;
    this.dashDX = 0; this.dashDY = 0;

    this.facing = 1;
    this.aimAngle = 0;
    this.intents = makeIntents();

    // Procedural animation state.
    this.walkPhase = 0;
    this.flash = 0;
    this.squash = 0;
    this.lean = 0;
    this.moving = false;
  }

  get dashing() { return this.dashT > 0; }

  hit(amount) {
    if (!this.alive || this.invuln > 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.flash = HIT_FLASH;
    this.squash = 1;
    if (this.hp <= 0) this.alive = false;
    return true;
  }

  update(dt, match) {
    const it = this.intents;
    const map = match.map;

    // Aim and facing.
    const ax = it.aimX - this.x;
    const ay = it.aimY - this.y;
    if (ax * ax + ay * ay > 1) this.aimAngle = Math.atan2(ay, ax);
    if (Math.abs(ax) > 2) this.facing = ax < 0 ? -1 : 1;

    // Input direction (clamped to unit length).
    let mx = it.moveX;
    let my = it.moveY;
    const ml = len(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }

    // Dash start.
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    if (it.dash && this.dashCd <= 0 && !this.dashing) {
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
    }

    const speed = FIGHTER.speed * this.stats.speedMul;
    if (this.dashing) {
      this.dashT -= dt;
      this.vx = this.dashDX * FIGHTER.dashSpeed;
      this.vy = this.dashDY * FIGHTER.dashSpeed;
      if (this.dashT <= 0) {
        // Leave the dash at run speed so it flows back into movement.
        this.vx = this.dashDX * speed;
        this.vy = this.dashDY * speed;
      }
    } else {
      const tx = mx * speed;
      const ty = my * speed;
      const rate = (ml > 0.05 ? FIGHTER.accel : FIGHTER.friction) * dt;
      const dvx = tx - this.vx;
      const dvy = ty - this.vy;
      const dl = len(dvx, dvy);
      if (dl <= rate) { this.vx = tx; this.vy = ty; } else { this.vx += (dvx / dl) * rate; this.vy += (dvy / dl) * rate; }
    }

    // Knockback decays on its own.
    const kl = len(this.kbx, this.kby);
    if (kl > 0) {
      const nk = Math.max(0, kl - FIGHTER.knockbackFriction * dt);
      this.kbx *= nk / kl;
      this.kby *= nk / kl;
    }

    const totalX = this.vx + this.kbx;
    const totalY = this.vy + this.kby;
    map.moveCircle(this.x, this.y, this.r, totalX * dt, totalY * dt, this.dashing, moveOut);
    this.x = moveOut.x;
    this.y = moveOut.y;
    if (moveOut.hitX) {
      if (Math.abs(this.kbx) > 60) match.events.emit('wallSlam', { fighter: this, speed: Math.abs(this.kbx) });
      this.vx = 0; this.kbx = 0;
    }
    if (moveOut.hitY) {
      if (Math.abs(this.kby) > 60) match.events.emit('wallSlam', { fighter: this, speed: Math.abs(this.kby) });
      this.vy = 0; this.kby = 0;
    }

    // Animation.
    const sp = len(this.vx, this.vy);
    this.moving = sp > 12;
    if (this.moving) this.walkPhase += dt * (8 + sp * 0.06);
    else this.walkPhase = 0;
    this.lean += (clamp(this.vx / FIGHTER.speed, -1, 1) * 0.12 - this.lean) * Math.min(1, dt * 14);
    this.flash = Math.max(0, this.flash - dt);
    this.squash *= Math.max(0, 1 - dt * 12);
  }
}

/** Draw a fighter with procedural animation: bob, lean, flip toward aim, squash on hit. */
export function drawFighter(ctx, f, cam, sprites) {
  const spr = sprites.get(f.appearance);
  const x = Math.round(f.x - cam.ox);
  const y = Math.round(f.y - cam.oy);
  if (x < -24 || y < -24 || x > cam.w + 24 || y > cam.h + 24) return false;

  // Shadow.
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000000';
  ctx.fillRect(x - 4, y + 4, 8, 2);
  ctx.fillRect(x - 3, y + 3, 6, 4);
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

  const c = Math.cos(f.lean);
  const s = Math.sin(f.lean);
  // translate(feet) * rotate(lean) * scale(sx, sy)
  ctx.setTransform(c * sx, s * sx, -s * sy, c * sy, x, Math.round(y + 6 + bob));
  ctx.drawImage(f.flash > 0 ? spr.flash : spr.normal, -8, -16);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return true;
}
