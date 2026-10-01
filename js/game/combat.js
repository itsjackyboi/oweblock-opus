// Damage, knockback, flash, hit-stop, kill credit and death. Every source of
// damage (melee, projectiles, areas, damage over time, hazards) goes through dealDamage.

import { COMBAT, HIT_FLASH } from '../config.js';
import { addStatus } from './statuses.js';
import { angleDiff, len } from '../core/math.js';

const COLORS = { melee: '#ffffff', projectile: '#ffe9a8', area: '#fe8b3a', dot: '#fe8b3a', counter: '#73eff7' };

/**
 * @param {object} o
 *   source   fighter credited with the hit (may be null)
 *   item     item instance used (for kill feed)
 *   kind     'melee' | 'projectile' | 'area' | 'dot' | 'counter' | 'hazard'
 *   dx, dy   push direction (normalized here); defaults to source -> target
 *   knockback  px/s impulse
 *   stun     seconds
 *   wallStun seconds of stun if the knockback slams the target into a wall
 *   status   { name, t, v }
 *   raw      true = ignore the source's damage multiplier
 * @returns damage dealt (0 if blocked)
 */
export function dealDamage(match, target, amount, o) {
  if (!target.alive) return 0;
  const src = o.source && o.source !== target ? o.source : null;
  const kind = o.kind || 'melee';
  const soft = kind === 'dot' || kind === 'zone'; // damage over time: no flash, ignores dash invulnerability
  if (!soft && (target.invuln > 0 || target.statuses.invuln.t > 0)) {
    if (target.isPlayer || src?.isPlayer) match.particles.popup(target.x, target.y - 12, 'DODGE', '#8b93af');
    return 0;
  }

  // Riposte: a melee hit into a parrying fighter's front is countered.
  if (kind === 'melee' && src && target.parry.t > 0) {
    const a = Math.atan2(src.y - target.y, src.x - target.x);
    if (Math.abs(angleDiff(target.parry.angle, a)) <= target.parry.arc / 2) {
      riposte(match, target, src);
      return 0;
    }
  }

  let dmg = amount * (src && !o.raw ? src.stats.damageMul : 1);
  dmg *= 1 - Math.min(COMBAT.armorCap, target.stats.armor);
  if (target.shield > 0 && !soft) { dmg *= 1 - target.shield; target.shield = 0; }
  target.hp -= dmg;
  if (src) {
    src.damageDealt += dmg;
    target.lastHitBy = src;
    target.lastHitTime = match.time;
    target.lastHitItem = o.item || null;
  }

  // Feel.
  if (!soft) {
    target.flash = HIT_FLASH;
    target.squash = 1;
  }
  let dx = o.dx;
  let dy = o.dy;
  if (dx === undefined && src) { dx = target.x - src.x; dy = target.y - src.y; }
  const dl = len(dx || 0, dy || 0);
  if (dl > 0) { dx /= dl; dy /= dl; } else { dx = 0; dy = 0; }
  if (o.knockback) {
    target.kbx += dx * o.knockback;
    target.kby += dy * o.knockback;
  }
  if (o.wallStun) { target.wallStunArm = o.wallStun; target.wallStunT = 0.35; }
  if (o.stun) addStatus(target, 'stun', o.stun, 1, src);
  if (o.status && o.status.name) addStatus(target, o.status.name, o.status.t, o.status.v, src);

  const playerInvolved = target.isPlayer || (src && src.isPlayer);
  if (!soft) {
    match.particles.spray(target.x, target.y - 3, Math.atan2(dy, dx), 1.4, 5, COLORS[kind] || '#ffffff', 40, 110, 0.25);
  }
  if (playerInvolved) {
    if (kind !== 'zone' || target.isPlayer) {
      match.particles.popup(target.x, target.y - 14, String(Math.max(1, Math.round(dmg))), target.isPlayer ? '#e43b44' : (soft ? '#fe8b3a' : '#ffffff'));
    }
    if (!soft) {
      match.hitStop(COMBAT.hitStop);
      match.shake(target.isPlayer ? COMBAT.shakePlayerHit : COMBAT.shakePlayerDeals);
    }
  }

  if (target.hp <= 0) kill(match, target);
  return dmg;
}

function riposte(match, defender, attacker) {
  const p = defender.parry;
  p.t = 0;
  const a = Math.atan2(attacker.y - defender.y, attacker.x - defender.x);
  match.particles.arc(defender.x, defender.y, a, 2.2, 16, '#73eff7', 0.15, 2);
  match.particles.burst(defender.x + Math.cos(a) * 8, defender.y + Math.sin(a) * 8, 10, '#ffffff', 60, 160, 0.3);
  if (p.item) p.item.cdP = 0; // a clean riposte readies the next slash
  dealDamage(match, attacker, p.counterDamage, {
    source: defender, item: p.item, kind: 'counter', knockback: 160, stun: p.stun,
  });
  if (defender.isPlayer || attacker.isPlayer) match.particles.popup(defender.x, defender.y - 20, 'RIPOSTE', '#73eff7');
}

/** True if a projectile arriving from (px, py) hits the target's parry. */
export function parryBlocks(target, px, py) {
  if (target.parry.t <= 0) return false;
  const a = Math.atan2(py - target.y, px - target.x);
  return Math.abs(angleDiff(target.parry.angle, a)) <= target.parry.arc / 2;
}

function kill(match, victim) {
  victim.hp = 0;
  victim.alive = false;
  victim.activity = null;
  const k = victim.lastHitBy;
  // The last fighter to hurt the victim gets the kill if it was recent (even if they died since).
  const killer = k && match.time - victim.lastHitTime <= COMBAT.killCreditWindow ? k : null;
  if (killer) killer.kills++;
  const playerInvolved = victim.isPlayer || killer?.isPlayer;
  if (playerInvolved) {
    match.hitStop(COMBAT.killHitStop);
    match.shake(COMBAT.shakeKill);
  }
  match.onDeath(victim, killer, victim.lastHitItem);
}
