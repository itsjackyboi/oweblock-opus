// Status effects. Every fighter carries one preallocated slot per status, so
// adding or ticking statuses never allocates.
//   root     can't move (can still act)
//   slow     move speed * (1 - v)
//   stun     can't move or act
//   burn     v damage per second (fire)
//   bleed    v damage per second
//   silence  forced to bare knuckles
//   slippery low traction: you slide
//   invuln   immune to damage

export const STATUS_NAMES = ['root', 'slow', 'stun', 'burn', 'bleed', 'silence', 'slippery', 'invuln'];
const DOT_TICK = 0.5;

export function makeStatuses() {
  const s = {};
  for (const n of STATUS_NAMES) s[n] = { t: 0, v: 0, src: null, tick: 0 };
  return s;
}

/** Apply or refresh a status: keeps the longer duration and the stronger value. */
export function addStatus(f, name, t, v = 1, src = null) {
  const s = f.statuses[name];
  if (!s || !f.alive) return;
  if (name !== 'invuln' && f.statuses.invuln.t > 0 && (name === 'stun' || name === 'root')) return;
  if (s.t <= 0) s.tick = DOT_TICK;
  s.t = Math.max(s.t, t);
  s.v = Math.max(s.t > 0 ? s.v : 0, v);
  if (src) s.src = src;
}

export const has = (f, name) => f.statuses[name].t > 0;

/** Tick timers; damage-over-time is dealt through `dealDot(f, amount, src, kind)`. */
export function updateStatuses(f, dt, dealDot) {
  const st = f.statuses;
  for (let i = 0; i < STATUS_NAMES.length; i++) {
    const s = st[STATUS_NAMES[i]];
    if (s.t <= 0) continue;
    s.t -= dt;
    if (STATUS_NAMES[i] === 'burn' || STATUS_NAMES[i] === 'bleed') {
      s.tick -= dt;
      if (s.tick <= 0) {
        s.tick += DOT_TICK;
        dealDot(f, s.v * DOT_TICK, s.src, STATUS_NAMES[i]);
      }
    }
    if (s.t <= 0) { s.t = 0; s.v = 0; s.src = null; }
  }
}

export function moveMul(f) {
  const st = f.statuses;
  if (st.stun.t > 0 || st.root.t > 0) return 0;
  return st.slow.t > 0 ? Math.max(0.1, 1 - st.slow.v) : 1;
}

export const canAct = (f) => f.statuses.stun.t <= 0;
