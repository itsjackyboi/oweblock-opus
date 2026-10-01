// A single match: map, fighters, items, combat systems, camera, update order and render.

import { GRID_CELL, URLP, INTERNAL_W, INTERNAL_H, ITEMS, XP, STANCE, TILE } from '../config.js';
import { RNG } from '../core/rng.js';
import { SpatialGrid } from '../core/grid.js';
import { Events } from '../core/events.js';
import { GameMap } from './map.js';
import { spreadPoints, openPoints } from './mapgen.js';
import { Fighter, drawFighter } from './fighter.js';
import { PlayerController } from './controllers/player.js';
import { Projectiles } from './projectiles.js';
import { Areas } from './areas.js';
import { Pickups } from './pickups.js';
import { Particles } from './particles.js';
import { updateItems, slotOf, freeSlot, swapWithPickup, dropAll, heldItem, itemRange } from './items.js';
import { getMode } from '../data/modes.js';
import { createItem, lootDefs, RARITY_WEIGHT } from '../data/registry.js';
import { drawHud } from '../ui/hud.js';
import { autoLevel } from './levelup.js';

const near = [];
const byY = (a, b) => a.y - b.y;

export class Match {
  constructor(game, { modeId, seed }) {
    this.game = game;
    this.mode = getMode(modeId);
    this.seed = seed >>> 0;
    this.rng = new RNG(this.seed);
    this.lootRng = this.rng.fork(20);
    this.dropRng = this.rng.fork(21);
    this.offerRng = this.rng.fork(22);
    this.events = new Events();
    this.time = 0;
    this.timers = [];
    this.killFeed = [];
    this.prompt = null;
    this.result = null;

    const t0 = performance.now();
    const gen = this.mode.generate(this.rng.fork(1), this.mode.size, game.assets);
    this.map = new GameMap({ ...gen, tileset: this.mode.tileset, seed: this.seed });
    this.genMs = performance.now() - t0;

    this.grid = new SpatialGrid(this.map.pw, this.map.ph, GRID_CELL);
    this.particles = new Particles();
    this.projectiles = new Projectiles(this);
    this.areas = new Areas(this);
    this.pickups = new Pickups(this);
    this.fighters = [];
    this.drawList = [];
    this.nextId = 1;

    const cam = game.renderer.camera;
    cam.bounds = { w: this.map.pw, h: this.map.ph };
    cam.lookX = 0;
    cam.lookY = 0;
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

    // ?dummies=N: idle fighters around the player holding random loot (test targets until the AI exists).
    const drng = this.rng.fork(3);
    const loot = lootDefs();
    for (let i = 0; i < URLP.dummies; i++) {
      const pos = this._freeSpotNear(sp.x, sp.y, 40 + (i % 8) * 8, drng);
      const palette = i % 4 === 3 ? 'police' : drng.pick(['red', 'blue']);
      const f = this.addFighter({
        name: `DUMMY ${i + 1}`,
        appearance: game.sprites.randomAppearance(drng, palette),
        x: pos.x,
        y: pos.y,
      });
      if (loot.length) f.slots[0] = createItem(drng.pick(loot), drng.int(1, 2));
      f.facing = drng.sign();
    }

    this._spawnLoot();
    this._scatterXp();
  }

  addFighter(opts) {
    const f = new Fighter(this.nextId++, { ...opts, match: this });
    this.fighters.push(f);
    return f;
  }

  get aliveCount() {
    let n = 0;
    for (let i = 0; i < this.fighters.length; i++) if (this.fighters[i].alive) n++;
    return n;
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

  // ------------------------------------------------------------------ loot

  /** Weighted [id, weight] table from the mode's loot weights and item rarity. */
  _lootTable(relicBoost = 1) {
    const w = this.mode.loot.weights || {};
    const out = [];
    for (const d of lootDefs()) {
      const base = w[d.id] ?? 0;
      if (base <= 0) continue;
      out.push([d.id, base * RARITY_WEIGHT[d.rarity] * (d.rarity === 'relic' ? relicBoost : 1)]);
    }
    return out;
  }

  _spawnLoot() {
    const L = this.mode.loot;
    const rng = this.lootRng;
    const table = this._lootTable();
    if (!table.length) return;
    const points = this.map.meta.lootPoints || [];
    for (const p of points) {
      if (!rng.chance(L.density)) continue;
      this.pickups.spawnItem(createItem(rng.weighted(table), rng.chance(0.1) ? 2 : 1), p.x, p.y);
    }
    const vaultTable = this._lootTable(L.vaultRelicBoost || 1);
    for (const p of this.map.meta.vaultPoints || []) {
      this.pickups.spawnItem(createItem(rng.weighted(vaultTable), rng.int(1, 2)), p.x, p.y);
    }
  }

  _scatterXp() {
    const pts = spreadPoints(openPoints(this.map.tiles, this.map.w, this.map.h, TILE), XP.scatterSpacing, 0, this.lootRng);
    for (const p of pts) this.pickups.spawnXp(XP.scatterValue, p.x + this.lootRng.range(-4, 4), p.y + this.lootRng.range(-4, 4));
  }

  // ------------------------------------------------------------------ hooks used by systems

  later(t, fn) { this.timers.push({ t, fn }); }
  hitStop(s) { this.game.loop.addHitStop(s); }
  shake(t) { this.game.renderer.camera.addTrauma(t); }
  isNearPlayer(x, y) {
    const c = this.game.renderer.camera;
    return Math.abs(x - (c.ox + c.w / 2)) < c.w * 0.7 && Math.abs(y - (c.oy + c.h / 2)) < c.h * 0.7;
  }

  onDeath(victim, killer, item) {
    victim.diedAt = this.time;
    victim.placement = this.aliveCount + 1;
    victim.killedBy = killer;
    victim.killedWith = item;
    dropAll(this, victim, this.dropRng);
    const xp = XP.killBase + XP.killPerLevel * victim.level + XP.killBankShare * victim.xpTotal;
    this.pickups.scatterXp(xp, victim.x, victim.y, this.dropRng);
    this.particles.burst(victim.x, victim.y, 22, '#e43b44', 30, 140, 0.6, 1);
    this.particles.burst(victim.x, victim.y, 10, '#ffffff', 20, 80, 0.4, 2);
    this.particles.ring(victim.x, victim.y, 4, 20, '#ffffff', 0.3);
    this.killFeed.push({ t: 0, killer: killer ? killer.name : null, victim: victim.name, item: item ? item.def.name : null, player: victim.isPlayer || !!killer?.isPlayer });
    if (this.killFeed.length > 5) this.killFeed.shift();
    this.events.emit('death', { victim, killer, item });

    const p = this.player;
    if (victim === p && !this.result) {
      this.result = { win: false, placement: victim.placement, of: this.fighters.length, killedBy: killer?.name || null, with: item?.def.name || null };
    } else if (p.alive && this.aliveCount === 1 && !this.result && this.fighters.length > 1) {
      p.placement = 1;
      this.result = { win: true, placement: 1, of: this.fighters.length };
    }
  }

  // ------------------------------------------------------------------ update

  update(dt) {
    this.time += dt;
    const fs = this.fighters;

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); }
    }

    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      if (!f.alive) continue;
      if (f.controller) f.controller.think(f, this, dt);
      else { f.intents.aimX = f.x + f.facing * 10; f.intents.aimY = f.y; }
    }
    for (let i = 0; i < fs.length; i++) if (fs[i].alive) fs[i].update(dt, this);

    this.grid.clear();
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      if (f.alive) this.grid.insert(f, f.x, f.y, f.r);
    }
    this._separate();

    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      if (!f.alive) continue;
      updateItems(f, dt, this);
      if (f.intents.pickup) this._trySwap(f);
      if (!f.isPlayer && f.pendingLevelUps > 0) autoLevel(this, f, this.offerRng, f.controller?.levelPolicy);
    }
    this._updatePrompt();

    this.projectiles.update(dt);
    this.areas.update(dt);
    this.pickups.update(dt);
    this.particles.update(dt);
    for (let i = this.killFeed.length - 1; i >= 0; i--) {
      this.killFeed[i].t += dt;
      if (this.killFeed[i].t > 6) this.killFeed.splice(i, 1);
    }

    // Camera: follow the player (or their last spot), lean toward the cursor in aim stance.
    const cam = this.game.renderer.camera;
    const p = this.player;
    cam.follow(p.x, p.y, dt);
    let lx = 0;
    let ly = 0;
    if (p.alive && p.intents.stance) {
      lx = Math.max(-STANCE.cameraLeanMax, Math.min(STANCE.cameraLeanMax, (p.intents.aimX - p.x) * STANCE.cameraLean));
      ly = Math.max(-STANCE.cameraLeanMax, Math.min(STANCE.cameraLeanMax, (p.intents.aimY - p.y) * STANCE.cameraLean));
    }
    const k = Math.min(1, dt * 8);
    cam.lookX += (lx - cam.lookX) * k;
    cam.lookY += (ly - cam.lookY) * k;
    cam.update(dt);
  }

  /** E with full slots: swap the held item for the nearest item on the ground. */
  _trySwap(f) {
    const pk = this.pickups.nearestItem(f.x, f.y, ITEMS.promptRange, f);
    if (!pk || slotOf(f, pk.item.id) >= 0 || freeSlot(f) >= 0) return;
    swapWithPickup(this, f, pk);
  }

  _updatePrompt() {
    const p = this.player;
    this.prompt = null;
    if (!p.alive) return;
    const pk = this.pickups.nearestItem(p.x, p.y, ITEMS.promptRange, p);
    if (!pk) return;
    const own = slotOf(p, pk.item.id);
    if (own >= 0) {
      if (p.slots[own].level >= ITEMS.maxLevel) this.prompt = { text: `${pk.item.def.name} IS MAX LEVEL` };
      return;
    }
    if (freeSlot(p) >= 0) return;
    const held = heldItem(p);
    this.prompt = { text: `E: SWAP ${held.def.name} FOR ${pk.item.def.name} L${pk.item.level}` };
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
        if (b === a || b.id < a.id || b.dashing || !b.alive) continue;
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

  // ------------------------------------------------------------------ render

  render(ctx) {
    const cam = this.game.renderer.camera;
    const assets = this.game.assets;
    ctx.fillStyle = this.mode.background;
    ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
    this.map.draw(ctx, cam, assets);
    this.areas.draw(ctx, cam);
    this.pickups.draw(ctx, cam, assets);

    // Aim line in stance (player only).
    const p = this.player;
    if (p.alive && p.intents.stance) {
      const L = itemRange(heldItem(p)) * STANCE.rangeMul;
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.55;
      const c = Math.cos(p.aimAngle);
      const s = Math.sin(p.aimAngle);
      for (let d = 10; d < L; d += 6) {
        ctx.fillRect(Math.round(p.x + c * d - cam.ox), Math.round(p.y - 1 + s * d - cam.oy), 1, 1);
        ctx.fillRect(Math.round(p.x + c * (d + 1) - cam.ox), Math.round(p.y - 1 + s * (d + 1) - cam.oy), 1, 1);
      }
      ctx.globalAlpha = 1;
    }

    // Y-sorted fighters.
    const list = this.drawList;
    list.length = 0;
    const fs = this.fighters;
    for (let i = 0; i < fs.length; i++) if (fs[i].alive) list.push(fs[i]);
    list.sort(byY);
    let drawn = 0;
    for (let i = 0; i < list.length; i++) if (drawFighter(ctx, list[i], cam, this.game.sprites, assets)) drawn++;
    this.fightersDrawn = drawn;

    this.projectiles.draw(ctx, cam, assets);
    this.particles.draw(ctx, cam);
    drawHud(ctx, this);
  }
}
