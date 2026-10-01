// Merges weapons + magic into one item registry, validates every entry at boot,
// and creates item instances. A bad entry is skipped with a clear console error.

import { WEAPONS } from './weapons.js';
import { MAGIC } from './magic.js';
import { ITEMS } from '../config.js';

export const RARITY_WEIGHT = { common: 10, uncommon: 6, rare: 3, relic: 1 };
const KINDS = new Set(['fists', 'weapon', 'relic', 'everyday', 'exclusive']);

const defs = new Map();
let initialized = false;

/** Param value at an item level: 5-length arrays are indexed by level, scalars pass through. */
export function P(v, level) {
  if (Array.isArray(v)) return v[Math.max(0, Math.min(v.length - 1, level - 1))];
  return v;
}

/** Resolve a params object at a level (recurses into nested plain objects). */
export function resolveParams(params, level) {
  const out = {};
  for (const k in params) {
    const v = params[k];
    if (Array.isArray(v) && v.length && typeof v[0] !== 'object' && typeof v[0] !== 'string') out[k] = P(v, level);
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = resolveParams(v, level);
    else out[k] = v;
  }
  return out;
}

function validate(e, actions) {
  const errs = [];
  const need = (cond, msg) => { if (!cond) errs.push(msg); };
  need(typeof e.id === 'string' && e.id, 'missing id');
  need(typeof e.name === 'string', 'missing name');
  need(KINDS.has(e.kind), `kind must be one of ${[...KINDS].join(', ')}`);
  need(e.rarity in RARITY_WEIGHT, `rarity must be one of ${Object.keys(RARITY_WEIGHT).join(', ')}`);
  need(typeof e.effect === 'string', 'missing one-line effect');
  for (const slot of ['primary', 'special']) {
    const a = e[slot];
    if (slot === 'special' && !a) continue;
    need(a && typeof a === 'object', `missing ${slot}`);
    if (!a) continue;
    need(a.action in actions, `${slot}.action "${a.action}" is not a known action`);
    need(a.cooldown != null, `${slot}.cooldown missing`);
    const checkArrays = (obj, path) => {
      for (const k in obj) {
        const v = obj[k];
        if (Array.isArray(v) && typeof v[0] === 'number' && (v.length < 1 || v.length > ITEMS.maxLevel)) {
          errs.push(`${path}.${k} has ${v.length} levels (max ${ITEMS.maxLevel})`);
        } else if (v && typeof v === 'object' && !Array.isArray(v)) checkArrays(v, `${path}.${k}`);
      }
    };
    checkArrays(a, slot);
    if (a.params?.release) need(a.params.release in actions, `${slot}.params.release "${a.params.release}" is not a known action`);
  }
  if (defs.has(e.id)) errs.push('duplicate id');
  return errs;
}

/** Validate and register all entries. `actions` is the action table from js/game/actions.js. */
export function initRegistry(actions) {
  if (initialized) return;
  initialized = true;
  for (const e of [...WEAPONS, ...MAGIC]) {
    const errs = validate(e, actions);
    if (errs.length) {
      console.error(`[items] entry "${e.id ?? '?'}" skipped: ${errs.join('; ')}`);
      continue;
    }
    defs.set(e.id, e);
  }
}

export function getDef(id) { return defs.get(id) || null; }
export function allDefs() { return [...defs.values()]; }

/** Item ids that may appear as loot or as new-item level-up offers. */
export function lootDefs() { return allDefs().filter((d) => d.loot); }

export function createItem(id, level = 1) {
  const def = typeof id === 'string' ? getDef(id) : id;
  if (!def) return null;
  return {
    def,
    id: def.id,
    level: Math.max(1, Math.min(ITEMS.maxLevel, level)),
    cdP: 0, // primary cooldown remaining
    cdS: 0, // special cooldown remaining
    out: 0, // projectiles out that must come back (returning weapons)
    charge: -1, // draw time while charging, -1 when not charging
    state: {},
  };
}
