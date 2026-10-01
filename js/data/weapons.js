// Weapon entries. Adding a weapon = adding one entry here (see README).
// Any param may be a 5-length array, indexed by item level (L1..L5).
//   primary / special: { action, cooldown, params }   (actions live in js/game/actions.js)
//   passive: stat changes applied while the item is in any slot, or null
//   ai: hints the AI uses to wield it (Stage 3)
//   hold: how the held sprite sits in the hand { rot: degrees, dist: px, size: px }
//   glyph: optional pixel-art fallback icon (rows of '#'/'.'), used when the manifest has no icon

export const WEAPONS = [
  {
    id: 'fists',
    name: 'Bare Knuckles',
    kind: 'fists',
    loot: false,
    rarity: 'common',
    effect: 'Two quick jabs. Q shoves.',
    color: '#e0b48a',
    primary: {
      action: 'meleeArc',
      cooldown: 0.34,
      params: { damage: 6, arc: 70, reach: 12, knockback: 60, hits: 2, hitGap: 0.09, lunge: 30, style: 'jab' },
    },
    special: {
      action: 'meleeArc',
      cooldown: 2.5,
      params: { damage: 2, arc: 90, reach: 14, knockback: 300, wallStun: 0.5, lunge: 60, style: 'shove' },
    },
    passive: null,
    ai: { idealRange: 10, minRange: 0, aim: 'direct', useWhen: 'inRange', specialWhen: 'nearWall' },
    hold: { hidden: true },
    glyph: [
      '................',
      '................',
      '................',
      '....##.##.##....',
      '...#cc#cc#cc#...',
      '...#cc#cc#cc##..',
      '...#cc#cc#cc#c#.',
      '...#cccccccc#c#.',
      '...#ccccccccc#..',
      '...#cccccccc#...',
      '....#cccccc#....',
      '....#cccccc#....',
      '.....######.....',
      '................',
      '................',
      '................',
    ],
  },

  {
    id: 'cutlass',
    name: 'Cutlass',
    kind: 'weapon',
    loot: true,
    rarity: 'common',
    effect: 'Wide slash. Q: Riposte parries and reflects.',
    color: '#f4f4f4',
    primary: {
      action: 'meleeArc',
      cooldown: [0.38, 0.36, 0.34, 0.32, 0.3],
      params: { damage: [14, 16, 18, 20, 23], arc: 100, reach: 22, knockback: 120, lunge: 40, style: 'slash' },
    },
    special: {
      action: 'parry',
      cooldown: [4, 3.7, 3.4, 3.1, 2.8],
      params: { window: [0.3, 0.32, 0.34, 0.36, 0.4], arc: 140, counterDamage: [20, 23, 26, 29, 33], stun: 0.7, reach: 26 },
    },
    passive: null,
    ai: { idealRange: 16, minRange: 0, aim: 'direct', useWhen: 'inRange', specialWhen: 'incoming' },
    hold: { rot: 90, dist: 7, size: 12 },
  },

  {
    id: 'singing_bow',
    name: 'Singing Bow',
    kind: 'weapon',
    loot: true,
    rarity: 'uncommon',
    effect: 'Hold to draw; full draw pierces. Q: 5-arrow Volley.',
    color: '#ffcd75',
    primary: {
      action: 'chargeRelease',
      cooldown: [0.25, 0.24, 0.22, 0.2, 0.18],
      params: {
        minDraw: 0.1,
        maxDraw: [0.8, 0.75, 0.7, 0.65, 0.6],
        moveMul: 0.6,
        release: 'projectile',
        min: { damage: [8, 9, 10, 11, 12], speed: 230, pierce: 0, range: 170 },
        max: { damage: [28, 31, 34, 38, 42], speed: 430, pierce: 1, range: 280 },
        common: { radius: 2, knockback: 70, kind: 'arrow', color: '#ffcd75' },
      },
    },
    special: {
      action: 'projectile',
      cooldown: [7, 6.5, 6, 5.5, 5],
      params: { count: 5, spread: 40, damage: [9, 10, 11, 12, 14], speed: 330, range: 200, radius: 2, knockback: 60, kind: 'arrow', color: '#ffcd75' },
    },
    passive: null,
    ai: { idealRange: 140, minRange: 60, aim: 'lead', useWhen: 'lineOfSight', specialWhen: 'clustered' },
    hold: { rot: 45, dist: 6, size: 12 },
  },

  {
    id: 'ancient_pot',
    name: 'Ancient Pot',
    kind: 'weapon',
    loot: true,
    rarity: 'uncommon',
    effect: 'Lob a fire-pot over cover. Q: Oil Slick that fire ignites.',
    color: '#fe8b3a',
    primary: {
      action: 'throwArea',
      cooldown: [2.4, 2.2, 2.0, 1.8, 1.6],
      params: {
        range: 150, speed: 190, kind: 'pot', color: '#c86f3b', ignites: true,
        area: { radius: 26, duration: 3, dps: [9, 11, 13, 15, 18], style: 'fire', tags: ['fire'], status: { name: 'burn', t: 1.5, v: 3 } },
      },
    },
    special: {
      action: 'throwArea',
      cooldown: [9, 8.5, 8, 7.5, 7],
      params: {
        range: 150, speed: 170, kind: 'pot', color: '#3a2a20',
        area: {
          radius: 34, duration: 8, dps: 0, style: 'oil', tags: ['oil'],
          status: { name: 'slippery', t: 0.4, v: 1 },
          ignite: { radius: 46, duration: 4, dps: [14, 16, 18, 20, 23], style: 'fire', tags: ['fire'], status: { name: 'burn', t: 2, v: 4 } },
        },
      },
    },
    passive: null,
    ai: { idealRange: 110, minRange: 40, aim: 'lob', useWhen: 'inRange', specialWhen: 'clustered' },
    hold: { rot: 0, dist: 6, size: 10 },
  },

  {
    id: 'drifters_call',
    name: "Drifter's Call",
    kind: 'weapon',
    loot: true,
    rarity: 'rare',
    effect: 'Returning blade hits twice; catch it to cut the cooldown. Q: Orbit.',
    color: '#73eff7',
    primary: {
      action: 'projectile',
      cooldown: [1.4, 1.3, 1.2, 1.1, 1.0],
      params: {
        damage: [12, 14, 16, 18, 21], speed: 270, range: 150, radius: 4, knockback: 80,
        returns: true, catchCdMul: 0.5, kind: 'boomerang', color: '#73eff7',
      },
    },
    special: {
      action: 'orbit',
      cooldown: [9, 8.5, 8, 7.5, 7],
      params: { duration: 3, radius: 20, spin: 8, damage: [8, 9, 10, 12, 14], hitEvery: 0.4, knockback: 90, kind: 'boomerang', color: '#73eff7' },
    },
    passive: null,
    ai: { idealRange: 100, minRange: 30, aim: 'lead', useWhen: 'lineOfSight', specialWhen: 'incoming' },
    hold: { rot: 0, dist: 6, size: 10 },
    glyph: [
      '................',
      '................',
      '.....#####......',
      '...##ccccc##....',
      '..#cc#####cc#...',
      '..#c#.....#c#...',
      '.#c#.......#c#..',
      '.#c#........##..',
      '.#c#............',
      '.#c#............',
      '..#c#...........',
      '..#cc#..........',
      '...###..........',
      '................',
      '................',
      '................',
    ],
  },
];
