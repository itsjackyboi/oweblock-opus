// Boot: load manifest + images, create the Game, start the loop.

import { INTERNAL_W, INTERNAL_H, URLP } from './config.js';
import { Renderer } from './core/renderer.js';
import { Input } from './core/input.js';
import { Assets } from './core/assets.js';
import { SpriteCache } from './core/sprites.js';
import { Loop } from './core/loop.js';
import { Game } from './game/game.js';
import { drawText } from './ui/font.js';

async function boot() {
  const canvas = document.getElementById('game');
  const renderer = new Renderer(canvas, INTERNAL_W, INTERNAL_H);
  renderer.clear('#1a1c2c');
  drawText(renderer.ctx, 'LOADING...', INTERNAL_W / 2, INTERNAL_H / 2, { color: '#f4f4f4', align: 'center' });

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
      start: (opts) => game.startMatch(opts),
      give: () => console.warn('[debug] give() arrives with items in Stage 2'),
      levelUp: () => console.warn('[debug] levelUp() arrives in Stage 2'),
      killAllAI: () => {
        for (const f of game.match?.fighters || []) if (!f.isPlayer) f.alive = false;
      },
    };
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
