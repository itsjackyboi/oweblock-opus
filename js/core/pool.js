// Fixed-capacity object pool. Objects are preallocated; `active` is a dense list
// (swap-remove on release), so iteration allocates nothing.

export class Pool {
  /**
   * @param {() => object} factory creates a blank object
   * @param {number} cap maximum live objects; acquire() returns null when full
   */
  constructor(factory, cap) {
    this.cap = cap;
    this.free = [];
    this.active = [];
    for (let i = 0; i < cap; i++) {
      const o = factory();
      o._poolIndex = -1;
      this.free.push(o);
    }
  }

  get count() { return this.active.length; }

  acquire() {
    const o = this.free.pop();
    if (!o) return null;
    o._poolIndex = this.active.length;
    this.active.push(o);
    return o;
  }

  release(o) {
    const i = o._poolIndex;
    if (i < 0) return;
    const last = this.active.pop();
    if (last !== o) {
      this.active[i] = last;
      last._poolIndex = i;
    }
    o._poolIndex = -1;
    this.free.push(o);
  }

  /** Release every object for which fn returns true. Safe during iteration. */
  sweep(fn) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const o = this.active[i];
      if (fn(o)) this.release(o);
    }
  }

  clear() {
    for (let i = this.active.length - 1; i >= 0; i--) this.release(this.active[i]);
  }
}
