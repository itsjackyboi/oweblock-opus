// Held-item model: slots, swapping, cooldowns, using the held item's primary
// (left click) and special (Q), pickups and drops. Item-agnostic: behavior comes
// from each entry's action + params.

import { ITEMS, STANCE } from '../config.js';
import { ACTIONS } from './actions.js';
import { resolveParams, P } from '../data/registry.js';
import { canAct, has } from './statuses.js';

/** Level-resolved params, cached per item until its level changes. */
export function resolved(item) {
  let r = item.resolved;
  if (!r || r.level !== item.level) {
    const d = item.def;
    r = item.resolved = {
      level: item.level,
      p: resolveParams(d.primary.params || {}, item.level),
      s: d.special ? resolveParams(d.special.params || {}, item.level) : null,
      cdP: P(d.primary.cooldown, item.level),
      cdS: d.special ? P(d.special.cooldown, item.level) : 0,
      charges: d.primary.charges ? P(d.primary.charges, item.level) : 0,
      recharge: d.primary.recharge ? P(d.primary.recharge, item.level) : 0,
      passive: d.passive ? resolveParams(d.passive, item.level) : null,
    };
    if (r.charges && item.charges === undefined) item.charges = r.charges;
  }
  return r;
}

/** The item actually in hand: silence forces fists, an empty slot is fists. */
export function heldItem(f) {
  if (has(f, 'silence')) return f.fists;
  return f.slots[f.held] || f.fists;
}

export function makeCtx(match, f, item, params) {
  const it = f.intents;
  const angle = f.aimAngle;
  return {
    match,
    user: f,
    item,
    params,
    angle,
    ax: it.aimX,
    ay: it.aimY,
    stance: it.stance,
    rangeMul: it.stance ? STANCE.rangeMul : 1,
    spreadMul: it.stance ? STANCE.spreadMul : 1,
    charge: 0,
  };
}

function canFirePrimary(item, r) {
  if (item.cdP > 0) return false;
  if (r.p.returns && item.out > 0) return false;
  if (r.charges && item.charges <= 0) return false;
  return true;
}

function cancelCharge(f) {
  for (const it of f.slots) if (it) { it.charge = -1; it.chargeS = -1; }
  f.fists.charge = -1;
  f.fists.chargeS = -1;
}

/** Recompute passive multipliers from every slot (passives work from any slot). */
function applyPassives(f) {
  const ps = f.pass;
  ps.dashDistMul = 1; ps.dashCdMul = 1; ps.shieldEvery = 0; ps.shield = 0;
  for (let i = 0; i < f.slots.length; i++) {
    const s = f.slots[i];
    if (!s || !s.def.passive) continue;
    const pv = resolved(s).passive;
    if (pv.dashDistMul) ps.dashDistMul *= pv.dashDistMul;
    if (pv.dashCdMul) ps.dashCdMul *= pv.dashCdMul;
    if (pv.shieldEvery) { ps.shieldEvery = pv.shieldEvery; ps.shield = Math.max(ps.shield, pv.shield); }
  }
}

/** Charged use (hold, release) shared by primary and special. */
function chargedUse(match, f, item, act, params, held, key, onFire) {
  if (item[key] === undefined || item[key] < 0) {
    if (held) item[key] = 0;
    return;
  }
  item[key] += match.stepDt;
  if (!held) {
    const ctx = makeCtx(match, f, item, params);
    ctx.charge = Math.max(0, Math.min(1, (item[key] - (params.minDraw || 0)) / Math.max(0.01, (params.maxDraw || 1) - (params.minDraw || 0))));
    act.fire(ctx);
    item[key] = -1;
    onFire();
  }
}

/** Per-step item logic for one fighter: cooldowns, charges, passives, activities, swaps, use. */
export function updateItems(f, dt, match) {
  const it = f.intents;
  match.stepDt = dt;

  // Cooldowns and charge recharge tick for every item, held or not.
  for (let i = 0; i < f.slots.length; i++) {
    const s = f.slots[i];
    if (!s) continue;
    s.cdP = Math.max(0, s.cdP - dt);
    s.cdS = Math.max(0, s.cdS - dt);
    if (s.def.primary.charges) {
      const r = resolved(s);
      if (s.charges < r.charges) {
        s.rechargeT = (s.rechargeT || 0) + dt;
        if (s.rechargeT >= r.recharge) { s.charges++; s.rechargeT = 0; }
      }
    }
  }
  f.fists.cdP = Math.max(0, f.fists.cdP - dt);
  f.fists.cdS = Math.max(0, f.fists.cdS - dt);
  if (f.parry.t > 0) f.parry.t -= dt;

  // Passives (any slot) and the periodic shield.
  applyPassives(f);
  if (f.pass.shieldEvery > 0 && f.shield <= 0) {
    f.shieldT += dt;
    if (f.shieldT >= f.pass.shieldEvery) { f.shield = f.pass.shield; f.shieldT = 0; }
  } else if (f.pass.shieldEvery <= 0) f.shield = 0;

  // Ongoing activity (channel, whirl, brace...).
  const a = f.activity;
  if (a) {
    // Stunned, or the item behind it is no longer in hand: the activity ends.
    if ((!canAct(f) && a.interruptible !== false) || (a.item && a.item !== heldItem(f))) { f.activity = null; }
    else {
      a.t += dt;
      if (a.every) {
        a.next -= dt;
        while (a.next <= 0 && a.t <= a.dur) { a.next += a.every; a.onTick?.(a); }
      }
      a.onUpdate?.(a, dt);
      if (a.t >= a.dur) { f.activity = null; a.onEnd?.(a); }
      if (f.activity && f.activity.lock) return;
    }
  }

  // Swapping.
  let target = -1;
  if (it.swapTo >= 0 && it.swapTo < f.slots.length) target = it.swapTo;
  else if (it.swapStep) target = (f.held + Math.sign(it.swapStep) + f.slots.length) % f.slots.length;
  if (target >= 0 && target !== f.held) {
    cancelCharge(f);
    f.held = target;
    f.swapT = ITEMS.swapTime;
  }
  if (f.swapT > 0) { f.swapT -= dt; return; }

  const item = heldItem(f);
  if (!canAct(f)) { item.charge = -1; item.chargeS = -1; return; }
  const r = resolved(item);
  const act = ACTIONS[item.def.primary.action];
  const cdMul = f.stats.cdMul;

  // Primary.
  if (act.mode === 'charge') {
    if (item.charge >= 0 || canFirePrimary(item, r)) {
      chargedUse(match, f, item, act, r.p, it.use, 'charge', () => { item.cdP = r.cdP * cdMul; });
    }
  } else if (it.use && canFirePrimary(item, r)) {
    act.fire(makeCtx(match, f, item, r.p));
    item.cdP = r.cdP * cdMul;
    if (r.charges) item.charges--;
  }

  // Special (Q): instant, or held and released for 'charge' actions.
  if (item.def.special && item.charge < 0) {
    const sa = ACTIONS[item.def.special.action];
    if (sa.mode === 'charge') {
      if ((item.chargeS ?? -1) >= 0 || (it.specialPressed && item.cdS <= 0)) {
        chargedUse(match, f, item, sa, r.s, it.special, 'chargeS', () => { item.cdS = r.cdS * cdMul; });
      }
    } else if (it.specialPressed && item.cdS <= 0) {
      sa.fire(makeCtx(match, f, item, r.s));
      item.cdS = r.cdS * cdMul;
    }
  }
}

/** Movement multiplier from what the fighter is doing with its item. */
export function itemMoveMul(f) {
  const item = heldItem(f);
  let m = 1;
  if (item.charge >= 0) m *= resolved(item).p.moveMul ?? 0.6;
  if ((item.chargeS ?? -1) >= 0) m *= resolved(item).s?.moveMul ?? 0.6;
  if (f.activity && f.activity.moveMul !== undefined) m *= f.activity.moveMul;
  if (f.parry.t > 0) m *= 0.4;
  return m;
}

/** Fraction 0..1 of the current draw (for UI), or -1. */
export function chargeFrac(f) {
  const item = heldItem(f);
  const special = (item.chargeS ?? -1) >= 0;
  if (item.charge < 0 && !special) return -1;
  const p = special ? resolved(item).s : resolved(item).p;
  if (special) return Math.max(0, Math.min(1, (item.chargeS - (p.minDraw || 0)) / Math.max(0.01, (p.maxDraw || 1) - (p.minDraw || 0))));
  return Math.max(0, Math.min(1, (item.charge - (p.minDraw || 0)) / Math.max(0.01, (p.maxDraw || 1) - (p.minDraw || 0))));
}

export function cooldownFracs(item) {
  if (!item) return [0, 0];
  const r = resolved(item);
  return [r.cdP > 0 ? item.cdP / r.cdP : 0, r.cdS > 0 ? item.cdS / r.cdS : 0];
}

/** Hint of an item's reach for aim lines (px). */
export function itemRange(item) {
  const p = resolved(item).p;
  if (item.def.ai?.range) return item.def.ai.range;
  return p.range || p.length || p.max?.range || p.reach || p.placeRange || p.radius || p.max?.radius || 30;
}

/** Find a slot holding this item id, or -1. */
export function slotOf(f, id) {
  for (let i = 0; i < f.slots.length; i++) if (f.slots[i] && f.slots[i].id === id) return i;
  return -1;
}

export function freeSlot(f) {
  if (!f.slots[f.held]) return f.held; // prefer the empty hand, so it gets equipped
  for (let i = 0; i < f.slots.length; i++) if (!f.slots[i]) return i;
  return -1;
}

/** Upgrade an owned item by one level. Returns false at max level. */
export function upgradeItem(match, f, slot) {
  const item = f.slots[slot];
  if (!item || item.level >= ITEMS.maxLevel) return false;
  item.level++;
  if (f.isPlayer) match.particles.popup(f.x, f.y - 18, `${item.def.name} L${item.level}`, '#ffcd75');
  match.events.emit('upgrade', { fighter: f, item });
  return true;
}

/** Walk-over pickup: upgrade a duplicate, or take a free slot. Returns true if taken. */
export function tryAutoPickup(match, f, item) {
  const own = slotOf(f, item.id);
  if (own >= 0) {
    if (!upgradeItem(match, f, own)) return false;
    match.particles.ring(f.x, f.y, 4, 14, '#ffcd75', 0.25);
    return true;
  }
  const slot = freeSlot(f);
  if (slot < 0) return false;
  f.slots[slot] = item;
  item.charge = -1;
  if (f.isPlayer) match.particles.popup(f.x, f.y - 18, item.def.name, '#ffffff');
  match.events.emit('pickup', { fighter: f, item });
  return true;
}

/** E-swap: put `pickup`'s item in the held slot and drop the held item where you stand. */
export function swapWithPickup(match, f, pickup) {
  const old = f.slots[f.held];
  f.slots[f.held] = pickup.item;
  pickup.item.charge = -1;
  match.pickups.remove(pickup);
  if (old) match.pickups.spawnItem(old, f.x, f.y, 0, 0, f);
  f.swapT = ITEMS.swapTime;
  if (f.isPlayer) match.particles.popup(f.x, f.y - 18, f.slots[f.held].def.name, '#ffffff');
}

/** Drop every slot item around a position (on death). */
export function dropAll(match, f, rng) {
  for (let i = 0; i < f.slots.length; i++) {
    const item = f.slots[i];
    if (!item) continue;
    f.slots[i] = null;
    item.charge = -1;
    item.out = 0;
    const a = rng.range(0, Math.PI * 2);
    const s = rng.range(30, 80);
    match.pickups.spawnItem(item, f.x, f.y, Math.cos(a) * s, Math.sin(a) * s);
  }
}
