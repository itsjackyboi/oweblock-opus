// Level-up stat boosts. Each one changes fighter.stats (or HP) when picked.

export const STAT_BOOSTS = [
  { id: 'hp', name: 'Max HP +15', effect: 'Also heals 15.', apply: (f) => { f.maxHp += 15; f.hp = Math.min(f.maxHp, f.hp + 15); } },
  { id: 'move', name: 'Move +6%', effect: 'Run faster.', apply: (f) => { f.stats.speedMul *= 1.06; } },
  { id: 'damage', name: 'Damage +8%', effect: 'All your hits.', apply: (f) => { f.stats.damageMul *= 1.08; } },
  { id: 'cooldown', name: 'Cooldown -7%', effect: 'All item cooldowns.', apply: (f) => { f.stats.cdMul *= 0.93; } },
  { id: 'dash', name: 'Dash CD -12%', effect: 'Dash more often.', apply: (f) => { f.stats.dashCdMul *= 0.88; } },
  { id: 'pickup', name: 'Pickup +25%', effect: 'Wider XP magnet.', apply: (f) => { f.stats.pickupMul *= 1.25; } },
  { id: 'armor', name: 'Armor +6%', effect: 'Take less damage.', apply: (f) => { f.stats.armor += 0.06; } },
  { id: 'regen', name: 'Regen +0.6/s', effect: 'Heal over time.', apply: (f) => { f.stats.regen += 0.6; } },
];
