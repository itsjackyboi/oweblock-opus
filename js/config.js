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

export const POOL_CAPS = { projectiles: 1024, particles: 2048, fx: 128, popups: 96, pickups: 768, areas: 128 };

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

export const COMBAT = {
  hitStop: 0.045, // s, only for hits involving the player
  killHitStop: 0.07,
  shakePlayerHit: 0.35, // trauma added when the player is hit
  shakePlayerDeals: 0.12, // trauma when the player hits someone
  shakeKill: 0.3,
  killCreditWindow: 5, // s since the last hit for kill credit
  wallSlamSpeed: 60, // px/s of knockback needed to count as a wall slam
  armorCap: 0.6,
};

export const ITEMS = {
  maxLevel: 5,
  swapTime: 0.15,
  pickupRange: 11, // px from fighter center to grab an item
  promptRange: 16, // px to show the swap prompt
  dropNoPickup: 1.0, // s a fighter can't re-grab what it just dropped
};

export const XP = {
  need: (level) => Math.round(25 * Math.pow(level, 1.35)),
  killBase: 30,
  killPerLevel: 10,
  killBankShare: 0.3,
  magnet: 30, // px base magnet radius for XP caps
  scatterValue: 3, // value of each XP cap scattered on the map
  scatterSpacing: 52, // px between scattered caps
};

export const STANCE = {
  speedMul: 0.65,
  spreadMul: 0.4,
  rangeMul: 1.15,
  cameraLean: 0.3, // fraction of the cursor offset
  cameraLeanMax: 70,
};

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
