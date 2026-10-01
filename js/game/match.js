// A single match: map, fighters, spatial hash, camera follow, update order and render.

import { GRID_CELL, URLP, INTERNAL_W, INTERNAL_H } from '../config.js';
import { RNG } from '../core/rng.js';
import { SpatialGrid } from '../core/grid.js';
import { Events } from '../core/events.js';
import { GameMap } from './map.js';
import { Fighter, drawFighter } from './fighter.js';
import { PlayerController } from './controllers/player.js';
import { getMode } from '../data/modes.js';
import { drawHud } from '../ui/hud.js';

const near = [];
const byY = (a, b) => a.y - b.y;

export class Match {
  constructor(game, { modeId, seed }) {
    this.game = game;
    this.mode = getMode(modeId);
    this.seed = seed >>> 0;
    this.rng = new RNG(this.seed);
    this.events = new Events();
    this.time = 0;

    const t0 = performance.now();
    const gen = this.mode.generate(this.rng.fork(1), this.mode.size, game.assets);
    this.map = new GameMap({ ...gen, tileset: this.mode.tileset, seed: this.seed });
    this.genMs = performance.now() - t0;

    this.grid = new SpatialGrid(this.map.pw, this.map.ph, GRID_CELL);
    this.fighters = [];
    this.drawList = [];
    this.nextId = 1;

    const cam = game.renderer.camera;
    cam.bounds = { w: this.map.pw, h: this.map.ph };
    const spawns = this.map.meta.spawns;
    const sp = spawns[0] || { x: this.map.pw / 2, y: this.map.ph / 2 };

    this.player = this.addFighter({
      name: 'NEWCOMER',
      isPlayer: true,
      appearance: game.sprites.randomAppearance(this.rng.fork(2), 'grey'),
      controller: new PlayerController(game.input, cam),
      x: sp.x,
      y: sp.y,
    });
    cam.snap(sp.x, sp.y);

    // ?dummies=N: idle fighters around the player (test targets until the AI exists).
    const drng = this.rng.fork(3);
    for (let i = 0; i < URLP.dummies; i++) {
      const pos = this._freeSpotNear(sp.x, sp.y, 28 + (i % 8) * 6, drng);
      const palette = i % 4 === 3 ? 'police' : drng.pick(['red', 'blue']);
      this.addFighter({
        name: `DUMMY ${i + 1}`,
        appearance: game.sprites.randomAppearance(drng, palette),
        x: pos.x,
        y: pos.y,
      });
    }
  }

  addFighter(opts) {
    const f = new Fighter(this.nextId++, opts);
    this.fighters.push(f);
    return f;
  }

  _freeSpotNear(x, y, radius, rng) {
    for (let tries = 0; tries < 60; tries++) {
      const a = rng.range(0, Math.PI * 2);
      const r = radius * rng.range(0.6, 1.4) + tries;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (!this.map.isSolidAt(px, py) && !this.map.isSolidAt(px + 6, py) && !this.map.isSolidAt(px - 6, py)
        && !this.map.isSolidAt(px, py + 6) && !this.map.isSolidAt(px, py - 6)) return { x: px, y: py };
    }
    return { x, y };
  }

  update(dt) {
    this.time += dt;
    const fs = this.fighters;

    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      if (f.alive && f.controller) f.controller.think(f, this, dt);
      else if (f.alive && !f.controller) { f.intents.aimX = f.x + f.facing; f.intents.aimY = f.y; }
    }
    for (let i = 0; i < fs.length; i++) if (fs[i].alive) fs[i].update(dt, this);

    this.grid.clear();
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      if (f.alive) this.grid.insert(f, f.x, f.y, f.r);
    }
    this._separate();

    const cam = this.game.renderer.camera;
    const p = this.player;
    cam.follow(p.x, p.y, dt);
    cam.update(dt);
  }

  /** Soft push-apart so fighters don't stack on one spot. */
  _separate() {
    const fs = this.fighters;
    for (let i = 0; i < fs.length; i++) {
      const a = fs[i];
      if (!a.alive || a.dashing) continue;
      this.grid.query(a.x, a.y, a.r * 2, near);
      for (let k = 0; k < near.length; k++) {
        const b = near[k];
        if (b === a || b.id < a.id || b.dashing) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (min - d) * 0.5;
        const nx = d2 ? dx / d : 1;
        const ny = d2 ? dy / d : 0;
        if (!this.map.isSolidAt(a.x - nx * push, a.y - ny * push)) { a.x -= nx * push; a.y -= ny * push; }
        if (!this.map.isSolidAt(b.x + nx * push, b.y + ny * push)) { b.x += nx * push; b.y += ny * push; }
      }
    }
  }

  render(ctx) {
    const cam = this.game.renderer.camera;
    const assets = this.game.assets;
    ctx.fillStyle = this.mode.background;
    ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
    this.map.draw(ctx, cam, assets);

    // Y-sorted fighters.
    const list = this.drawList;
    list.length = 0;
    const fs = this.fighters;
    for (let i = 0; i < fs.length; i++) if (fs[i].alive) list.push(fs[i]);
    list.sort(byY);
    let drawn = 0;
    for (let i = 0; i < list.length; i++) if (drawFighter(ctx, list[i], cam, this.game.sprites)) drawn++;
    this.fightersDrawn = drawn;

    drawHud(ctx, this);
  }
}
