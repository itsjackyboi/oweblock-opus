// Seeded mulberry32 PRNG with helpers. Every match-affecting random call goes through one of these.

export class RNG {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.s = this.seed || 0x9e3779b9;
  }

  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  sign() { return this.next() < 0.5 ? -1 : 1; }

  /** Standard normal sample (Box-Muller). */
  gauss() {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** Pick a key from { key: weight } (or [[key, weight]]). */
  weighted(table) {
    const entries = Array.isArray(table) ? table : Object.entries(table);
    let total = 0;
    for (const [, w] of entries) total += w;
    let r = this.next() * total;
    for (const [k, w] of entries) { if ((r -= w) < 0) return k; }
    return entries[entries.length - 1][0];
  }

  /** Independent child stream, stable for a given salt. */
  fork(salt) {
    return new RNG((Math.imul(this.seed ^ 0x85ebca6b, 31) + Math.imul(salt | 0, 0x27d4eb2f)) >>> 0);
  }
}
