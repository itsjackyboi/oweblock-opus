# Owe Block Brawl

A fast, 8-bit, top-down arena battle royale set in Owe Block (Pintland Isles): you against 40 AI fighters, last one standing wins.

It is a static site with no build step: `index.html`, plain ES modules, Canvas 2D, WebAudio and `localStorage`.

**Status:** Stage 2 of 6, player combat. It has the held-item model, Bare Knuckles plus 4 weapons (Cutlass, Singing Bow, Ancient Pot, Drifter's Call), XP, the level-up picker, map loot, death and win screens. AI arrives in Stage 3.

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
| F3 | debug overlay |

## URL parameters

All of them are inert unless set.

| Param | Effect |
|---|---|
| `?seed=N` | fixed match seed |
| `?mode=mines` | mode (`rooftops` and `pipepit` arrive in Stage 5) |
| `?placeholders=1` | flat-color placeholders instead of art (still fully playable) |
| `?debug=1` | debug overlay on, plus `window.__oweblock`: `state`, `perf`, `start({seed})`, `items()`, `give(id, level)`, `levelUp()`, `hurt(n)`, `killAllAI()` |
| `?dummies=N` | N idle fighters around the player, each holding a random item |
| `?sim=1&speed=10` | AI-only fast simulation (Stage 3) |

## Layout

```
js/core/    engine: loop, input, renderer + camera, assets, paper-doll sprites, spatial grid, pools, rng, events
js/game/    match, fighter, map + collision, shared map-gen tools, controllers
js/ai/      AI controller and navigation (Stage 3)
js/data/    all content: modes, maps, items, fighters, tiers, ...
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
- Behavior comes from the generic primitives in `js/game/actions.js`: `meleeArc`, `projectile` (with `pierce`, `bounce` and `returns`), `chargeRelease`, `throwArea`, `parry` and `orbit`. More arrive in Stage 4.
- Give the item an icon with `icons.<id>` in the manifest, or a 16x16 pixel `glyph` in its entry. Without either, it gets a colored box with its initial.
- To add it to a mode's loot, put its id in `loot.weights` in `js/data/modes.js`.

## Development

```sh
npx eslint js            # lint (flat config in eslint.config.js)
node tools/smoke.mjs     # Playwright smoke test; screenshots land in tools/screens/
```

`smoke.mjs` starts its own static server under `/oweblock-opus/`, which proves the relative paths work on a Pages subpath. It fails on any console error and blocks `localStorage` in one run.

## Credits

Art: [Kenney](https://www.kenney.nl) (CC0): Tiny Dungeon, Tiny Town, Tiny Factory and Roguelike Characters. Each license is next to its sheet in `assets/kenney/`.

Setting and names: the Pintland Isles lore (the *Master Lore Compendium* and the *Hoegaarden Hall of Records*).
