// Boot: load manifest + images, create the Game, start the loop.

import { INTERNAL_W, INTERNAL_H, URLP } from './config.js';
import { Renderer } from './core/renderer.js';
import { Input } from './core/input.js';
import { Assets } from './core/assets.js';
import { SpriteCache } from './core/sprites.js';
import { Loop, perfStats, resetPerf } from './core/loop.js';
import { Game } from './game/game.js';
import { drawText } from './ui/font.js';
import { initRegistry, createItem, allDefs } from './data/registry.js';
import { ACTIONS } from './game/actions.js';
import { tryAutoPickup } from './game/items.js';
import { addXp, xpNeeded } from './game/levelup.js';
import { dealDamage } from './game/combat.js';

async function boot() {
  const canvas = document.getElementById('game');
  const renderer = new Renderer(canvas, INTERNAL_W, INTERNAL_H);
  renderer.clear('#1a1c2c');
  drawText(renderer.ctx, 'LOADING...', INTERNAL_W / 2, INTERNAL_H / 2, { color: '#f4f4f4', align: 'center' });

  initRegistry(ACTIONS);
  const input = new Input(canvas, INTERNAL_W, INTERNAL_H);
  const assets = await new Assets({ forcePlaceholders: URLP.placeholders }).load('assets/manifest.json');
  const sprites = new SpriteCache(assets);

  const ctx = { renderer, input, assets, sprites, loop: null };
  const loop = new Loop(
    (dt) => game.update(dt),
    () => game.render(),
    () => input.clearEdges(),
  );
  ctx.loop = loop;
  const game = new Game(ctx);
  loop.timeScale = URLP.speed;

  if (URLP.debug) {
    window.__oweblock = {
      game,
      get state() { return game.screen; },
      get match() { return game.match; },
      get perf() { return loop.perf; },
      perfStats: () => perfStats(loop),
      resetPerf: () => resetPerf(loop),
      result: null,
      start: (opts) => game.startMatch(opts),
      items: () => allDefs().map((d) => d.id),
      /** Give the player an item (upgrades if owned; fills a free slot, else replaces the held one). */
      give: (id, level = 1) => {
        const m = game.match;
        const item = createItem(id, level);
        if (!m || !item) return false;
        const p = m.player;
        if (!tryAutoPickup(m, p, item)) p.slots[p.held] = item;
        return true;
      },
      levelUp: () => {
        const p = game.match?.player;
        if (p) addXp(game.match, p, xpNeeded(p.level) - p.xp);
      },
      hurt: (n) => { const m = game.match; if (m) dealDamage(m, m.player, n, { kind: 'dot', raw: true }); },
      killAllAI: () => {
        const m = game.match;
        for (const f of m?.fighters || []) if (!f.isPlayer && f.alive) dealDamage(m, f, 1e6, { kind: 'dot', raw: true });
      },
    };
  }
  // ?sim=1: a high-tier AI plays instead of you; the match runs at ?speed and reports when one is left.
  if (URLP.sim) {
    game.onSimEnd = (r) => {
      const res = { ...r, perf: perfStats(loop) };
      if (window.__oweblock) window.__oweblock.result = res;
      console.log('[sim] ' + JSON.stringify(res));
    };
    game.startMatch();
    resetPerf(loop);
  }
  loop.start();
}

boot().catch((e) => {
  console.error(e);
  const c = document.getElementById('game');
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#e43b44';
  g.font = '10px monospace';
  g.fillText('BOOT ERROR: ' + e.message, 8, 20);
});
