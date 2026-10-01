// Fighter roster: named Owe Block fighters and generic handles for everyone else.
// Named fighters take high-tier slots (3-5 per match, never all at once).
//   gang       'red' (Crimson Cutters) | 'blue' (Seaside Circus) | 'police'
//   signature  item id they spawn holding
//   prefers    item ids they favor when looting and levelling
//   hpMul, speedMul
//   look       fixed paper-doll layers (frame indices in the 'chars' sheet); omitted layers are random
//   always     always in the pool for a match (still subject to the per-match count)
//   onDeath    { spawn: { count:[min,max], gang, name, tier, loadout:[ids], hunt:'killer', life } }

export const NAMED = [
  { id: 'krag', name: 'KRAG', gang: 'red', signature: 'krags_cleaver', prefers: ['wagwans_whopper', 'bully_hill_mantrap'], hpMul: 1.2, always: true,
    look: { body: 54, hair: 23, beard: 185, hat: 136 } },
  { id: 'fin', name: 'FIN', gang: 'red', signature: 'shiv', prefers: ['wolendi_wind_pouch', 'drifters_call'], hpMul: 0.9 * 1.2, speedMul: 1.25, always: true,
    look: { body: 0, hair: 73, beard: -1, hat: -1 } },
  { id: 'dig_dug', name: 'DIG DUG', gang: 'red', signature: 'bully_hill_mantrap', prefers: ['amethyst_shard'], hpMul: 1.2,
    look: { body: 1, hair: 239, beard: 401, hat: 137 } },
  { id: 'bucket', name: 'BUCKET', gang: 'red', signature: 'cutlass', prefers: ['clockheart_tonic'], hpMul: 1.2,
    look: { body: 55, hair: 289, beard: -1, hat: -1 } },
  { id: 'fr_leo', name: 'FR LEO', gang: 'red', signature: 'old_staff', prefers: ['veilwalker_net'], hpMul: 1.2,
    look: { body: 0, hair: 451, beard: 613, hat: -1 } },
  { id: 'zaar', name: 'ZAAR THE EDGEMASTER', short: 'ZAAR', gang: 'blue', signature: 'zaars_edges', prefers: ['ancient_pot', 'sad_sermon'], hpMul: 1.2, always: true,
    look: { body: 108, hair: 240, beard: -1, hat: 190 } },
  { id: 'wagwan', name: 'WAGWAN', gang: 'blue', signature: 'wagwans_whopper', prefers: ['clockheart_tonic'], hpMul: 1.2, always: true,
    look: { body: 109, hair: 293, beard: 403, hat: -1 } },
  { id: 'mickey', name: 'MICKEY', gang: 'blue', signature: 'keg_flail', prefers: ['beast_hook'], hpMul: 1.2,
    look: { body: 54, hair: 77, beard: 187, hat: 191 } },
  { id: 'moby', name: 'MOBY', gang: 'blue', signature: 'powder_keg', prefers: ['ancient_pot', 'wolendi_wind_pouch'], hpMul: 1.2,
    look: { body: 108, hair: -1, beard: 404, hat: 190 } },
  { id: 'baba_paku', name: 'BABA PAKU', gang: 'blue', signature: 'singing_bow', prefers: ['sad_sermon'], hpMul: 1.2,
    look: { body: 109, hair: 452, beard: 616, hat: -1 } },
  { id: 'sergeant_hark', name: 'SGT HARK', gang: 'police', signature: 'gaol_arbalest', prefers: ['bully_hill_mantrap'], hpMul: 1.2,
    look: { body: 1, hair: 293, beard: 400, hat: 28 },
    onDeath: { spawn: { count: [3, 5], gang: 'police', name: 'COPPER', tier: 'med', loadout: ['cutlass'], hunt: 'killer', life: 60 } } },
];

/** Short street handles for unnamed fighters. */
export const HANDLES = [
  'SLICK', 'BOOTS', 'GRIMEY', 'TALLY', 'KNUCKS', 'DUSTY', 'PIPES', 'RUSTY', 'MOSS', 'TICK',
  'BRICK', 'WICK', 'SOOT', 'GULLY', 'SPUD', 'CROW', 'NETTLES', 'BARNACLE', 'KIPPER', 'SCRAPS',
  'LUGS', 'HOBNAIL', 'TUPPENCE', 'CINDER', 'MUCK', 'BILGE', 'SHANK', 'POCKETS', 'DREG', 'FLINT',
  'SKIFF', 'GRUB', 'TOFFEE', 'PEBBLE', 'LANTERN', 'RIVET', 'SPROCKET', 'GRISTLE', 'TADPOLE', 'MANGO',
  'COAL', 'DUNK', 'BOLT', 'STITCH', 'PINCH', 'SORREL', 'CRUMPET', 'WHELK', 'DOCK RAT', 'LOOSE CHANGE',
  'MILKY', 'HOPS', 'BARLEY', 'TIDE', 'GRIT',
];

export const PLAYER_NAME = 'NEWCOMER';
