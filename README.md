# Owe Block Brawl

A fast, 8-bit, top-down arena battle royale set in Owe Block (Pintland Isles): you against 40 AI fighters, last one standing wins.

It is a static site with no build step: `index.html`, plain ES modules, Canvas 2D, WebAudio and `localStorage`.

**Status:** all 6 stages done. Three modes (Mines, Rooftops, Pipe Pit) with their hazards, 20 items, 40 AI fighters with tiers and a pacing director, named fighters and police hunters, gang induction after a win, saved stats and unlocks, chiptune music and SFX, and options.

## Run it

ES modules and `fetch` do not work from `file://`, so serve the folder:

```sh
npx http-server -p 8080 -c-1 .
# then open http://localhost:8080/
```

On GitHub Pages, enable Settings → Pages → *Deploy from a branch*, then pick this branch and `/ (root)`. All paths are relative, so the game works under a subpath such as `https://<user>.github.io/<repo>/`.

## Controls

| Input | Action |
|---|---|
| WASD / arrows | move |
| Space | dash (toward movement, or toward the aim when standing still) |
| Mouse | aim |
| Left click | use the held item (hold to draw a bow) |
| Q | the held item's special |
| Right mouse | aim stance: camera leans, spread tightens, +15% range, -35% move speed |
| 1 2 3 / wheel | swap held item (0.15 s) |
| E | swap the held item for the one on the ground (when all slots are full) |
| Esc | pause (R restart, T title) |
| Enter / click | menus; continue from the result screen |
| F3 | debug overlay |

## URL parameters

All of them are inert unless set.

| Param | Effect |
|---|---|
| `?seed=N` | fixed match seed |
| `?mode=mines` | `mines`, `rooftops` or `pipepit` |
| `?placeholders=1` | flat-color placeholders instead of art (still fully playable) |
| `?debug=1` | debug overlay on, plus `window.__oweblock`: `state`, `perf`, `start({seed})`, `items()`, `give(id, level)`, `levelUp()`, `hurt(n)`, `killAllAI()` |
| `?dummies=N` | N idle fighters around the player, each holding a random item |
| `?sim=1&speed=10` | a high-tier AI plays in your place at 10x speed; when one fighter is left, `__oweblock.result` holds the length, winner tier and frame costs |

## Layout

```
js/core/    engine: loop, input, renderer + camera, assets, paper-doll sprites, spatial grid, pools, rng, events, save, audio
js/game/    match, fighter, map + collision, shared map-gen tools, controllers
js/ai/      AI controller (utility states, tiers) and navigation (flow field + budgeted A*)
js/data/    all content: modes, maps, items, fighters, tiers, gangs, sfx, music, ...
js/ui/      bitmap font, HUD, debug overlay, screens
assets/     manifest.json + Kenney sheets
tools/      atlas.html (sheet viewer), smoke.mjs (Playwright smoke test)
```

The engine never names a specific item, mode or fighter. All content lives in `js/data/`.

## Adding content

**A mode.** Add one entry to `js/data/modes.js` with `id`, `name`, `tileset`, `size`, `generate(rng, size, assets)`, `loot`, `zone`, `hazards` and `music`. The generator goes in `js/data/maps/<id>.js` and composes the tools in `js/game/mapgen.js`: blobs, tunnels, cellular smoothing, region fill, Poisson disc, spread points and MST. It returns `{ w, h, tiles, deco, meta: { spawns, ... } }`.

**A tileset.** Add `tilesets.<id>` to `assets/manifest.json` and map each role (`floor`, `wall`, `wallTop`, ...) to frame indices. Find the indices with `tools/atlas.html?sheet=<sheet>&scale=4`. The `_doc` key at the top of the manifest documents the whole format.

**An item.** Add one entry to `js/data/weapons.js` or `js/data/magic.js`:

```js
{ id: 'cutlass', name: 'Cutlass', kind: 'weapon', loot: true, rarity: 'common',
  effect: 'Wide slash. Q: Riposte parries and reflects.',   // the one line shown in the UI
  primary: { action: 'meleeArc', cooldown: [0.38, 0.36, 0.34, 0.32, 0.3],
             params: { damage: [14, 16, 18, 20, 23], arc: 100, reach: 22, knockback: 120 } },
  special: { action: 'parry', cooldown: 4, params: { window: 0.3, arc: 140, counterDamage: 20, stun: 0.7 } },
  passive: null,
  ai: { idealRange: 16, aim: 'direct', useWhen: 'inRange', specialWhen: 'incoming' },
  hold: { rot: 90, dist: 7, size: 12 } }
```

- Any param can be a 5-length array, indexed by item level.
- `js/data/registry.js` validates every entry at boot and logs a clear error for a bad one.
- Behavior comes from the generic primitives in `js/game/actions.js`:
  - melee: `meleeArc` (combo, backstab, outer sweet spot), `thrust`, `dashStrike`, `spin`, `shockwave`, `parry`;
  - ranged: `projectile` (pierce, bounce, returns, toCursor + burst, trail, stagger), `chargeRelease`, `throwArea`, `salvo`, `orbit`, `hookPull`, `hookSelf`;
  - beams: `channelBeam`, `sweepBeam`;
  - placed and area effects: `placeTrap`, `castArea`, `areaAura`, `decoy`, `cone`, `detonate`;
  - self and cover: `selfBuff`, `consume`, `spawnCover`, `burst`.
- Ground effects (fire, oil, traps, nets, dirges, kegs, lures) are area specs; `js/game/areas.js` documents the fields.
- `passive` (for example `{ dashDistMul: 1.35 }`) works from any slot. A primary can have `charges` and `recharge`.
- AI hints (`useWhen` / `specialWhen`) are evaluated in `js/ai/ai.js` (`_cond`). Relic timing gets smarter with tier.
- Give the item an icon with `icons.<id>` in the manifest, or a 16x16 pixel `glyph` in its entry. Without either, it gets a colored box with its initial.
- To add it to a mode's loot, put its id in `loot.weights` in `js/data/modes.js`.

## Modes

| Mode | Tiles | Layout | Hazards |
|---|---|---|---|
| Mines (Dig Dug's mines, Bully Hill) | Tiny Dungeon | cave chambers and narrow tunnels; vault in the deepest chamber | darkness (light around fighters, shorter AI sight), cave-ins, void pits |
| Rooftops (the final gang war) | Tiny Town | roofs over alleys, plank bridges, chimneys; isolated vault roofs (dash or hook only) | falling into alleys (15% max HP, stun), cracking skylights |
| Pipe Pit (Mickey's Pipe Club) | Tiny Factory | open central pit (risky loot) ringed by a pipe maze | conveyors, steam vents |

Named fighters (3 to 5 per match) hold their signature item and wear name tags. Kill **Sgt Hark** and 3 to 5 police hunt down the killer.

## Items

| Item | Left click | Q |
|---|---|---|
| Bare Knuckles | two jabs | shove |
| Cutlass | 100° slash | Riposte (parry, reflect) |
| Shiv | stab, x2.5 from behind | Lunge with bleed; a kill resets your dash |
| Wagwan's Whopper | 160° smash, wall-slam stun | hold: Thunderclap shockwave |
| Keg Flail | 220° sweep, tip x1.5 | Whirl |
| Singing Bow | hold to draw; a full draw pierces | 5-arrow Volley |
| Gaol Arbalest | piercing bolt | Brace, then 3 bolts |
| Drifter's Call | returning blade | Orbit |
| Beast Hook | yank a fighter to you | reel yourself in |
| Bully Hill Mantrap | hidden root trap (max 3) | toss a trap that snaps on landing |
| Ancient Pot | lobbed fire pool | oil slick (fire ignites it) |
| Powder Keg | lit keg, short fuse | set them all off |
| Old Staff (relic) | channelled beam through walls | Sweep |
| Veilwalker Net (relic) | rooting net | Lure, then a small net |
| Sad Sermon (relic) | silencing dirge | Last Rites aura |
| Wolendi Wind Pouch | Gust: push and deflect; passive: better dash | Tailwind |
| ClockHeart Tonic | drink: heal, then slowed (2 charges) | throw it to slow enemies |
| Amethyst Shard | grow crystal cover; passive: periodic shield | Shatter crystals into slivers |
| Krag's Cleaver (Cutters) | 3-hit combo, the third bleeds | Cutter's Charge |
| Zaar's Edges (Circus) | three ricocheting knives | Ring of Fire |

## Progress and saves

- **Winning** a match opens the induction screen: join the **Crimson Cutters** (Krag's Cleaver, red) or the **Seaside Circus** (Zaar's Edges, blue). The gang's weapon and color unlock for good.
- **Unlocks / Stats** on the title menu shows both gangs, your totals, your bests (kills, damage, placement, longest life, fastest win) and the last matches. Press 1 to cycle your color and 2 to pick your starting weapon from what you've unlocked.
- After every match, a summary screen shows your placement, kills, damage, level, time, who got you and your final build, with any new bests marked.
- **Options:** screen shake on/off, plus master, music and SFX volume (left/right to change).
- Everything is saved in `localStorage` under `oweblock.save.v1` (`js/core/save.js`), with a version field and a migration hook. If storage is blocked, the game still runs and just forgets on reload.

## Audio

All sound is synthesized at runtime in `js/core/audio.js`: two pulse voices (12.5/25/50% duty), a triangle and a noise channel. There are no audio files.

- SFX are data in `js/data/sfx.js` (frequency sweep, envelope, wave, duty, repeats). At most 12 play at once, quieter with distance from the camera.
- Music tracks are 16th-note step patterns in `js/data/music.js` (title, plus one per mode), played on a lookahead sequencer. A mode picks its track with `music: '<id>'`.
- The browser only allows audio after a user gesture, so sound starts with the first key press or click.

## AI and pacing

- Each AI reads its skill from `js/data/tiers.js`. The AI code itself never names a tier.
- AIs choose between LOOT, ENGAGE, RETREAT, ZONE, XP and ROAM by score, with hysteresis so they don't flicker. Third-party joins happen inside ENGAGE.
- A pacing director in `match.js` (`paceTarget` and `fightPressure`) only lets AIs *start* fights when more fighters are alive than the curve allows. Fighting back is always allowed.
- Gobbler's police sweep (`js/game/zone.js`) shrinks from the map edges toward a seeded point. Matches last about 7 minutes.

## Development

```sh
npx eslint js            # lint (flat config in eslint.config.js)
node tools/smoke.mjs     # Playwright smoke test + 10 AI sims; screenshots land in tools/screens/
node tools/smoke.mjs --sims 3 --speed 20   # quicker
```

`smoke.mjs` starts its own static server under `/oweblock-opus/`, which proves the relative paths work on a Pages subpath. It fails on any console error and blocks `localStorage` in one run.

## Credits

Art: [Kenney](https://www.kenney.nl) (CC0): Tiny Dungeon, Tiny Town, Tiny Factory and Roguelike Characters. Each license is next to its sheet in `assets/kenney/`.

Setting and names: the Pintland Isles lore (the *Master Lore Compendium* and the *Hoegaarden Hall of Records*).
