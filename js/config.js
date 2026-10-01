// Global tunables. Content (items, modes, fighters) lives in js/data/.

export const SLOT_COUNT = 3;
export const INTERNAL_W = 480;
export const INTERNAL_H = 270;
export const TILE = 16;
export const AI_COUNT = 40;
export const TIER_MIX = { low: 15, med: 15, high: 10 };
export const NAMED_PER_MATCH = [3, 5];

export const STEP = 1 / 60;
export const MAX_STEPS_PER_FRAME = 5;

export const GRID_CELL = 32;
export const CHUNK_PX = 256;

export const POOL_CAPS = { projectiles: 1024, particles: 2048 };

export const FIGHTER = {
  radius: 5,
  baseHp: 100,
  speed: 110,
  accel: 1400,
  friction: 1700,
  knockbackFriction: 900,
  dashSpeed: 330,
  dashTime: 0.14,
  dashInvuln: 0.18,
  dashCooldown: 1.6,
};

export const CAMERA = {
  follow: 12, // higher = snappier follow (per second)
  maxShake: 6, // px at trauma 1
  shakeDecay: 1.6, // trauma per second
};

export const HIT_FLASH = 0.08;

// URL params. All are inert unless set.
const params = new URLSearchParams(location.search);
const num = (k, d) => (params.has(k) && !Number.isNaN(+params.get(k)) ? +params.get(k) : d);
export const URLP = {
  seed: params.has('seed') ? num('seed', 1) >>> 0 : null,
  mode: params.get('mode'),
  placeholders: params.get('placeholders') === '1',
  debug: params.get('debug') === '1',
  dummies: num('dummies', 0),
  sim: params.get('sim') === '1',
  speed: num('speed', 1),
};
