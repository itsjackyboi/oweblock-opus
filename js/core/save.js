// Versioned localStorage save. Every access is wrapped in try/catch: with storage
// blocked (private mode, sandboxed frame) the game still runs on in-memory data.

const KEY = 'oweblock.save.v1';
const VERSION = 1;
const HISTORY_MAX = 20;

export function defaultSave() {
  return {
    version: VERSION,
    unlocked: { cutters: false, circus: false },
    color: 'grey', // 'grey' | 'red' | 'blue'
    startWeapon: null, // item id of an unlocked gang weapon, or null
    history: [], // last matches, newest first
    best: { kills: 0, damage: 0, placement: 0, longestLife: 0, fastestWin: 0 },
    totals: { matches: 0, wins: 0, kills: 0, damage: 0, time: 0 },
    settings: { shake: true, master: 0.8, music: 0.6, sfx: 0.8 },
  };
}

/** Upgrade older saves in place. Add a case per version bump. */
function migrate(data) {
  const base = defaultSave();
  const out = { ...base, ...data };
  out.unlocked = { ...base.unlocked, ...(data.unlocked || {}) };
  out.best = { ...base.best, ...(data.best || {}) };
  out.totals = { ...base.totals, ...(data.totals || {}) };
  out.settings = { ...base.settings, ...(data.settings || {}) };
  out.history = Array.isArray(data.history) ? data.history.slice(0, HISTORY_MAX) : [];
  // (no versions before 1 yet)
  out.version = VERSION;
  return out;
}

export class Save {
  constructor() {
    this.data = defaultSave();
    this.available = false;
    try {
      const raw = localStorage.getItem(KEY);
      this.available = true;
      if (raw) this.data = migrate(JSON.parse(raw));
    } catch (e) {
      console.warn(`[save] storage unavailable (${e.message}); progress will not persist`);
    }
  }

  write() {
    if (!this.available) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn(`[save] write failed (${e.message})`);
    }
  }

  get settings() { return this.data.settings; }

  setSetting(k, v) {
    this.data.settings[k] = v;
    this.write();
  }

  /**
   * Record a finished match for the player. r = match result
   * ({ win, placement, of, kills, damage, level, time, build, killedBy, with, mode }).
   * Returns the list of bests that were beaten.
   */
  recordMatch(r) {
    const d = this.data;
    const b = d.best;
    const newBest = [];
    d.history.unshift({ ...r, date: Date.now() });
    d.history.length = Math.min(d.history.length, HISTORY_MAX);
    d.totals.matches++;
    if (r.win) d.totals.wins++;
    d.totals.kills += r.kills;
    d.totals.damage += r.damage;
    d.totals.time += r.time;
    if (r.kills > b.kills) { b.kills = r.kills; newBest.push('kills'); }
    if (r.damage > b.damage) { b.damage = r.damage; newBest.push('damage'); }
    if (!b.placement || r.placement < b.placement) { b.placement = r.placement; newBest.push('placement'); }
    if (r.time > b.longestLife) { b.longestLife = r.time; newBest.push('longestLife'); }
    if (r.win && (!b.fastestWin || r.time < b.fastestWin)) { b.fastestWin = r.time; newBest.push('fastestWin'); }
    this.write();
    return newBest;
  }

  /** Join a gang after a win: unlocks its weapon and color, and makes them active. */
  induct(gang) {
    const d = this.data;
    d.unlocked[gang.unlockKey] = true;
    d.color = gang.color;
    d.startWeapon = gang.weapon;
    this.write();
  }
}
