// XP, levels and the level-up offer generator. The same generator serves the
// player (picker UI) and the AI (auto-pick by tier policy).
// Offers: a new item if a slot is free (relics weighted low), an upgrade for an
// owned item below max level, or a stat boost. At least one non-stat offer
// whenever one is possible.

import { XP, ITEMS } from '../config.js';
import { STAT_BOOSTS } from '../data/stats.js';
import { getDef, lootDefs, createItem, RARITY_WEIGHT } from '../data/registry.js';
import { slotOf, freeSlot } from './items.js';

export function xpNeeded(level) { return XP.need(level); }

export function addXp(match, f, n) {
  if (!f.alive || n <= 0) return;
  f.xp += n;
  f.xpTotal += n;
  let need = XP.need(f.level);
  while (f.xp >= need) {
    f.xp -= need;
    f.level++;
    f.pendingLevelUps++;
    need = XP.need(f.level);
    match.events.emit('levelUp', { fighter: f });
    if (f.isPlayer) match.particles.ring(f.x, f.y, 4, 22, '#ffcd75', 0.4, 2);
  }
}

/** Weighted list of item ids that may be offered as new items in this match. */
function itemPool(match) {
  const w = match.mode.loot.weights || {};
  const out = [];
  for (const d of lootDefs()) {
    const base = w[d.id] ?? 1;
    if (base > 0) out.push([d.id, base * RARITY_WEIGHT[d.rarity]]);
  }
  return out;
}

/**
 * Three offers for fighter f.
 * offer = { type:'new'|'upgrade'|'stat', id?, slot?, boost?, title, sub, effect }
 */
export function generateOffers(match, f, rng) {
  const nonStat = [];
  for (let i = 0; i < f.slots.length; i++) {
    const it = f.slots[i];
    if (it && it.level < ITEMS.maxLevel) {
      nonStat.push({ type: 'upgrade', slot: i, id: it.id, title: it.def.name, sub: `UPGRADE L${it.level} > L${it.level + 1}`, effect: it.def.effect });
    }
  }
  if (freeSlot(f) >= 0) {
    const pool = itemPool(match).filter(([id]) => slotOf(f, id) < 0);
    for (let k = 0; k < 2 && pool.length; k++) {
      const id = rng.weighted(pool);
      pool.splice(pool.findIndex(([pid]) => pid === id), 1);
      const d = getDef(id);
      nonStat.push({ type: 'new', id, title: d.name, sub: 'NEW ITEM', effect: d.effect });
    }
  }
  rng.shuffle(nonStat);
  const stats = rng.shuffle(STAT_BOOSTS.slice()).map((b) => ({ type: 'stat', boost: b, title: b.name, sub: 'STAT', effect: b.effect }));

  const offers = [];
  if (nonStat.length) offers.push(nonStat.shift());
  while (offers.length < 3 && (nonStat.length || stats.length)) {
    const fromNon = nonStat.length && (!stats.length || rng.chance(0.5));
    offers.push(fromNon ? nonStat.shift() : stats.shift());
  }
  return rng.shuffle(offers);
}

export function applyOffer(match, f, offer) {
  f.pendingLevelUps = Math.max(0, f.pendingLevelUps - 1);
  if (offer.type === 'stat') {
    offer.boost.apply(f);
  } else if (offer.type === 'upgrade') {
    const it = f.slots[offer.slot];
    if (it && it.level < ITEMS.maxLevel) it.level++;
  } else if (offer.type === 'new') {
    const slot = freeSlot(f);
    if (slot >= 0) f.slots[slot] = createItem(offer.id, 1);
  }
  match.events.emit('levelChoice', { fighter: f, offer });
}

/**
 * Non-player pick. policy: { preferNew, preferUpgrade } weights (tiers set these in Stage 3).
 */
export function autoLevel(match, f, rng, policy = { new: 1, upgrade: 1, stat: 0.6 }) {
  while (f.pendingLevelUps > 0) {
    const offers = generateOffers(match, f, rng);
    if (!offers.length) { f.pendingLevelUps = 0; return; }
    const pick = rng.weighted(offers.map((o, i) => [i, policy[o.type] ?? 1]));
    applyOffer(match, f, offers[pick]);
  }
}
