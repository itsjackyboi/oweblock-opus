// AI skill tiers. The AI controller reads only these numbers; nothing in js/ai
// names a tier.
//   reaction     [min, max] s before acting on a newly seen target
//   aimError     std-dev of aim error (radians), sampled per attack
//   lead         0..1 fraction of target-velocity lead on projectiles
//   dodge        chance to react to an incoming projectile or telegraph
//   dash         uses: panic (low HP only), dodge, engage, escape
//   kite         0 none, 1 basic range keeping, 2 strafe + per-item ideal range
//   focusWeak    0..1 preference for low-HP targets
//   thirdParty   0..1 chance to join fights within thirdPartyRange
//   zone         'damage' (moves once hurt) | 'moderate' | 'early' (rotates before the shrink)
//   relic        'random' | 'timed' | 'predictive' item-special timing
//   think        seconds between decisions (staggered per fighter)
//   aggression   0..1 willingness to engage
//   perception   px a fighter notices enemies within (with line of sight)
//   levelPolicy  weights for auto-picking level-up offers

export const TIERS = {
  low: {
    reaction: [0.45, 0.6], aimError: 0.2, lead: 0, dodge: 0.05,
    dash: { panic: true, dodge: false, engage: false, escape: false },
    kite: 0, focusWeak: 0, thirdParty: 0, thirdPartyRange: 0,
    zone: 'damage', relic: 'random', think: 0.3, aggression: 0.3, perception: 140,
    chargeSkill: 0.4,
    levelPolicy: { new: 1, upgrade: 0.6, stat: 1 },
  },
  med: {
    reaction: [0.25, 0.35], aimError: 0.1, lead: 0.5, dodge: 0.35,
    dash: { panic: true, dodge: true, engage: false, escape: false },
    kite: 1, focusWeak: 0.5, thirdParty: 0.35, thirdPartyRange: 280,
    zone: 'moderate', relic: 'timed', think: 0.2, aggression: 0.55, perception: 170,
    chargeSkill: 0.7,
    levelPolicy: { new: 1, upgrade: 1, stat: 0.7 },
  },
  high: {
    reaction: [0.12, 0.18], aimError: 0.04, lead: 0.95, dodge: 0.75,
    dash: { panic: true, dodge: true, engage: true, escape: true },
    kite: 2, focusWeak: 1, thirdParty: 1, thirdPartyRange: 400,
    zone: 'early', relic: 'predictive', think: 0.1, aggression: 0.85, perception: 210,
    chargeSkill: 1,
    levelPolicy: { new: 0.9, upgrade: 1.4, stat: 0.6 },
  },
};
