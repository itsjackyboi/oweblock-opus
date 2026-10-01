// A single match: map, fighters, items, combat systems, AI, zone, camera, update order and render.

import { GRID_CELL, URLP, INTERNAL_W, INTERNAL_H, ITEMS, XP, STANCE, TILE, AI_COUNT, TIER_MIX, NAMED_PER_MATCH } from '../config.js';
import { RNG } from '../core/rng.js';
import { SpatialGrid } from '../core/grid.js';
import { Events } from '../core/events.js';
import { GameMap, T, TILE_INFO } from './map.js';
import { spreadPoints, openPoints } from './mapgen.js';
import { Fighter, drawFighter, drawNameTag } from './fighter.js';
import { PlayerController } from './controllers/player.js';
import { AIController } from '../ai/ai.js';
import { Nav } from '../ai/nav.js';
import { Zone, makeHatch, pickFinalPoint } from './zone.js';
import { makeHazards } from './hazards.js';
import { dealDamage } from './combat.js';
import { addStatus } from './statuses.js';
import { Projectiles } from './projectiles.js';
import { Areas } from './areas.js';
import { Pickups } from './pickups.js';
import { Particles } from './particles.js';
import { updateItems, slotOf, freeSlot, swapWithPickup, dropAll, heldItem, itemRange } from './items.js';
import { getMode } from '../data/modes.js';
import { createItem, lootDefs, getDef, RARITY_WEIGHT } from '../data/registry.js';
import { NAMED, HANDLES, PLAYER_NAME } from '../data/fighters.js';
import { drawHud, buildMinimap } from '../ui/hud.js';
import { autoLevel } from './levelup.js';
import { drawText } from '../ui/font.js';

const near = [];
const byY = (a, b) => a.y - b.y;
const AGGRO_RAMP = 420;
// start/end are fractions of the safe time and of the whole sweep.
const PACE = { start: 0.75, end: 1.2, curve: 0.9, slack: 14 };

export class Match {
  /**
   * @param {object} opts
   *   modeId, seed
   *   startItem   item id the player starts holding (gang reward), or null
   *   palette     player outfit palette ('grey' | 'red' | 'blue')
   */
  constructor(game, { modeId, seed, startItem = null, palette = 'grey' }) {
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
    this.simResult = null;
    this.sim = URLP.sim;
    this.perceptionMul = 1;

    const t0 = performance.now();
    const gen = this.mode.generate(this.rng.fork(1), this.mode.size, game.assets);
    this.map = new GameMap({ ...gen, tileset: this.mode.tileset, seed: this.seed });
    this.genMs = performance.now() - t0;

    this.grid = new SpatialGrid(this.map.pw, this.map.ph, GRID_CELL);
    this.projGrid = new SpatialGrid(this.map.pw, this.map.ph, GRID_CELL);
    this.nav = new Nav(this.map);
    this.particles = new Particles();
    this.projectiles = new Projectiles(this);
    this.areas = new Areas(this);
    this.pickups = new Pickups(this);
    this.fighters = [];
    this.drawList = [];
    this.nextId = 1;
    this.hatch = makeHatch();
    this.minimap = buildMinimap(this.map);
    this.hazards = []; // created after the fighters (some need the map meta)
    this.telegraphs = []; // { kind:'line'|'circle'|'arc', x, y, x2, y2, r, w, a, arc, t, dur, owner, color }
    this.covers = new Map(); // tile index -> { tx, ty, hp, owner, born }
    this.map.onChange = (tx, ty, t) => {
      this.nav.walk[ty * this.map.w + tx] = TILE_INFO[t].solid || TILE_INFO[t].pit ? 0 : 1;
    };

    // Zone: final point and the flow field toward the first target.
    const fp = pickFinalPoint(this.map, this.rng.fork(4), this.nav);
    this.zone = new Zone(this, fp.x, fp.y, this.mode.zone?.scale ?? 1);
    this.flowVersion = -1;
    this.policeLook = game.sprites.randomAppearance(this.rng.fork(5), 'police');
    this.events.on('zoneShrink', () => this._lootWave());

    const cam = game.renderer.camera;
    cam.bounds = { w: this.map.pw, h: this.map.ph };
    cam.lookX = 0;
    cam.lookY = 0;
    const spawns = this.rng.fork(6).shuffle(this.map.meta.spawns.slice());
    const sp = spawns[0] || { x: this.map.pw / 2, y: this.map.ph / 2 };

    const prng = this.rng.fork(2);
    this.player = this.addFighter({
      name: this.sim ? 'SIM' : PLAYER_NAME,
      isPlayer: true,
      gang: palette,
      appearance: game.sprites.randomAppearance(prng, palette),
      controller: null,
      x: sp.x,
      y: sp.y,
    });
    this.player.controller = this.sim
      ? new AIController(this, this.player, 'high', prng.fork(1))
      : new PlayerController(game.input, cam);
    if (this.sim) this.player.tier = 'high';
    if (startItem && getDef(startItem)) this.player.slots[0] = createItem(startItem, 1);
    cam.snap(sp.x, sp.y);
    this.camTarget = this.player;

    if (URLP.dummies > 0) this._spawnDummies(sp);
    else this._spawnContestants(spawns.slice(1));

    this._spawnLoot();
    this._scatterXp();
    this.hazards = makeHazards(this, this.mode.hazards);
    if (this.mode.setup) this.mode.setup(this);
  }

  addFighter(opts) {
    const f = new Fighter(this.nextId++, { ...opts, match: this });
    this.fighters.push(f);
    return f;
  }

  /** Battle-royale contestants still alive (police hunters don't count). */
  get aliveCount() {
    let n = 0;
    for (let i = 0; i < this.fighters.length; i++) {
      const f = this.fighters[i];
      if (f.alive && !f.extra) n++;
    }
    return n;
  }

  get contestants() {
    let n = 0;
    for (let i = 0; i < this.fighters.length; i++) if (!this.fighters[i].extra) n++;
    return n;
  }

  _freeSpotNear(x, y, radius, rng) {
    for (let tries = 0; tries < 60; tries++) {
      const a = rng.range(0, Math.PI * 2);
      const r = radius * rng.range(0.6, 1.4) + tries;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (this.nav.walkableAt(px, py) && this.nav.walkableAt(px + 6, py) && this.nav.walkableAt(px - 6, py)
        && this.nav.walkableAt(px, py + 6) && this.nav.walkableAt(px, py - 6)) return { x: px, y: py };
    }
    return { x, y };
  }

  // ------------------------------------------------------------------ roster

  _spawnDummies(sp) {
    // ?dummies=N: idle fighters around the player holding random loot (test targets).
    const drng = this.rng.fork(3);
    const loot = lootDefs();
    for (let i = 0; i < URLP.dummies; i++) {
      const pos = this._freeSpotNear(sp.x, sp.y, 40 + (i % 8) * 8, drng);
      const palette = i % 4 === 3 ? 'police' : drng.pick(['red', 'blue']);
      const f = this.addFighter({
        name: `DUMMY ${i + 1}`,
        appearance: this.game.sprites.randomAppearance(drng, palette),
        x: pos.x,
        y: pos.y,
      });
      if (loot.length) f.slots[0] = createItem(drng.pick(loot), drng.int(1, 2));
      f.facing = drng.sign();
    }
  }

  _spawnContestants(spawns) {
    const rng = this.rng.fork(7);
    const sprites = this.game.sprites;
    const handles = rng.shuffle(HANDLES.slice());

    // Named fighters (3-5) take high-tier slots. Only those whose signature item exists.
    const avail = NAMED.filter((n) => !n.signature || getDef(n.signature));
    const always = rng.shuffle(avail.filter((n) => n.always));
    const others = rng.shuffle(avail.filter((n) => !n.always));
    const count = Math.min(avail.length, rng.int(NAMED_PER_MATCH[0], NAMED_PER_MATCH[1]));
    const named = [...always, ...others].slice(0, count);
    rng.shuffle(named);

    const tiers = [];
    for (const [t, n] of Object.entries(TIER_MIX)) for (let i = 0; i < n; i++) tiers.push(t);
    // Named fighters replace high-tier slots.
    for (let i = 0; i < named.length; i++) {
      const k = tiers.indexOf('high');
      if (k >= 0) tiers.splice(k, 1);
    }

    let si = 0;
    const nextSpawn = () => {
      const p = spawns[si++ % Math.max(1, spawns.length)] || { x: this.map.pw / 2, y: this.map.ph / 2 };
      return si > spawns.length ? this._freeSpotNear(p.x, p.y, 30, rng) : p;
    };

    for (const n of named) {
      const pos = nextSpawn();
      const app = sprites.randomAppearance(rng, n.gang);
      Object.assign(app, n.look || {});
      const f = this.addFighter({
        name: n.short || n.name, fullName: n.name, named: true, gang: n.gang, tier: 'high',
        appearance: app, x: pos.x, y: pos.y, hpMul: n.hpMul || 1.2, speedMul: n.speedMul || 1,
        onDeath: n.onDeath || null,
      });
      f.controller = new AIController(this, f, 'high', rng.fork(f.id), { prefers: n.prefers });
      if (n.signature) f.slots[0] = createItem(n.signature, 1);
    }
    for (let i = 0; i < AI_COUNT - named.length; i++) {
      const tier = tiers[i % tiers.length];
      const pos = nextSpawn();
      const gang = rng.chance(0.5) ? 'red' : 'blue';
      const f = this.addFighter({
        name: handles[i % handles.length], gang, tier,
        appearance: sprites.randomAppearance(rng, gang), x: pos.x, y: pos.y,
      });
      f.controller = new AIController(this, f, tier, rng.fork(f.id));
    }
  }

  /** Police hunters spawned around (x, y) when a fighter with an onDeath spawn is killed. */
  spawnHunters(spec, x, y, target) {
    if (!target || !target.alive) return;
    const rng = this.rng.fork(1000 + this.nextId);
    const n = rng.int(spec.count[0], spec.count[1]);
    for (let i = 0; i < n; i++) {
      const pos = this._freeSpotNear(x, y, 24 + i * 6, rng);
      const f = this.addFighter({
        name: spec.name || 'COPPER', gang: spec.gang || 'police', tier: spec.tier || 'med',
        appearance: this.game.sprites.randomAppearance(rng, spec.gang || 'police'),
        x: pos.x, y: pos.y, extra: true, zoneImmune: true,
      });
      f.controller = new AIController(this, f, spec.tier || 'med', rng.fork(i), { hunt: target });
      (spec.loadout || []).forEach((id, k) => { if (k < f.slots.length) f.slots[k] = createItem(id, 2); });
      f.huntLife = spec.life || 60;
      this.particles.burst(pos.x, pos.y, 10, '#8b93af', 30, 90, 0.4);
    }
    this.killFeed.push({ t: 0, killer: null, victim: null, text: `POLICE HUNT ${target.name}`, player: target.isPlayer });
  }

  /**
   * A fighter dropped into a pit (knocked in, dash ended over a gap, skylight broke).
   * Costs the mode's fall spec, then puts them back on their last safe spot.
   */
  onFall(f, spec = this.mode.fall || { damage: 20 }) {
    if (!f.alive) return;
    const src = f.lastHitBy && this.time - f.lastHitTime < 3 ? f.lastHitBy : null;
    this.particles.burst(f.x, f.y, 10, '#1a1c2c', 20, 70, 0.4);
    if (f.isPlayer) this.particles.popup(f.x, f.y - 16, 'FELL!', '#e43b44');
    const dmg = (spec.damage || 0) + (spec.maxHpFrac || 0) * f.maxHp;
    f.x = f.safeX;
    f.y = f.safeY;
    f.vx = f.vy = f.kbx = f.kby = 0;
    f.dashT = 0;
    f.lungeT = 0;
    f.reelT = 0;
    if (spec.stun) addStatus(f, 'stun', spec.stun, 1, src);
    dealDamage(this, f, dmg, { source: src, kind: 'zone', raw: true });
    this.particles.ring(f.x, f.y, 3, 14, '#ffffff', 0.3);
    this.events.emit('fall', { fighter: f });
  }

  /** Remove a fighter quietly (hunters leaving), with no drops or kill feed. */
  despawn(f) {
    if (!f.alive) return;
    f.alive = false;
    f.despawned = true;
    this.particles.burst(f.x, f.y, 8, '#8b93af', 20, 60, 0.4);
  }

  // ------------------------------------------------------------------ loot

  /** Weighted [id, weight] table from the mode's loot weights and item rarity. */
  _lootTable(relicBoost = 1) {
    const L = this.mode.loot;
    const w = L.weights || {};
    const out = [];
    let relicW = 0;
    let other = 0;
    for (const d of lootDefs()) {
      const base = w[d.id] ?? 0;
      if (base <= 0) continue;
      const v = base * RARITY_WEIGHT[d.rarity];
      out.push([d.id, v, d.rarity === 'relic']);
      if (d.rarity === 'relic') relicW += v; else other += v;
    }
    // Scale relics to the mode's relic share (about 6% of spawns), times any vault boost.
    if (relicW > 0 && other > 0 && L.relicShare) {
      const share = Math.min(0.9, L.relicShare * relicBoost);
      const k = (share * other) / ((1 - share) * relicW);
      for (const e of out) if (e[2]) e[1] *= k;
    }
    return out.map(([id, v]) => [id, v]);
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

  /** One light respawn wave per zone phase, inside the safe area. */
  _lootWave() {
    const rng = this.lootRng;
    const table = this._lootTable();
    if (!table.length) return;
    const pts = (this.map.meta.lootPoints || []).filter((p) => this.zone.insideNext(p.x, p.y, 16));
    rng.shuffle(pts);
    const n = Math.min(pts.length, 6);
    for (let i = 0; i < n; i++) {
      this.pickups.spawnItem(createItem(rng.weighted(table), rng.int(1, 2)), pts[i].x, pts[i].y);
      this.particles.ring(pts[i].x, pts[i].y, 2, 14, '#ffcd75', 0.5);
    }
  }

  _scatterXp() {
    const pts = spreadPoints(openPoints(this.map.tiles, this.map.w, this.map.h, TILE), XP.scatterSpacing, 0, this.lootRng);
    for (const p of pts) this.pickups.spawnXp(XP.scatterValue, p.x + this.lootRng.range(-4, 4), p.y + this.lootRng.range(-4, 4));
  }

  // ------------------------------------------------------------------ hooks used by systems

  /** 0.2 at the start -> 1 after AGGRO_RAMP seconds: early game is for looting. */
  get aggroRamp() { return Math.min(1, 0.2 + 0.8 * (this.time / AGGRO_RAMP)); }

  /**
   * Pacing director: how many contestants "should" be alive at this time
   * (everyone until most of the safe time is over, easing to ~0 after the sweep closes). AI only starts fights when
   * more are alive than this; retaliation is always allowed.
   */
  get paceTarget() {
    const start = this.zone.sched.safe * this.zone.scale * PACE.start;
    const end = this.zone.total * PACE.end;
    const k = Math.max(0, Math.min(1, (this.time - start) / (end - start)));
    return this.contestants * (1 - Math.pow(k, PACE.curve));
  }

  /**
   * Desired new fights per second, from how far ahead of the pace curve the match is.
   * Each AI turns this into a per-encounter chance (see ai.js).
   */
  get fightPressure() {
    return Math.max(0, (this.aliveCount - this.paceTarget) / PACE.slack);
  }

  later(t, fn) { this.timers.push({ t, fn }); }

  /** Register a readable warning (beam lines, rings). AI reads these to dodge. Returns it (mutable). */
  telegraph(o) {
    const tg = { kind: 'circle', x: 0, y: 0, x2: 0, y2: 0, r: 0, w: 4, a: 0, arc: 0, t: 0, dur: 0.5, owner: null, color: '#b55088', ...o };
    this.telegraphs.push(tg);
    return tg;
  }

  // ------------------------------------------------------------------ cover (crystals)

  addCover(tx, ty, hp, owner, maxPerOwner = 4) {
    const mine = this.coversOf(owner);
    if (mine.length >= maxPerOwner) {
      mine.sort((a, b) => a.born - b.born);
      this.removeCover(mine[0].tx, mine[0].ty);
    }
    this.covers.set(ty * this.map.w + tx, { tx, ty, hp, owner, born: this.time });
    this.map.set(tx, ty, T.COVER);
  }

  removeCover(tx, ty) {
    const i = ty * this.map.w + tx;
    if (!this.covers.has(i)) return;
    this.covers.delete(i);
    this.map.set(tx, ty, T.FLOOR);
    this.particles.burst((tx + 0.5) * TILE, (ty + 0.5) * TILE, 12, '#b55088', 30, 110, 0.4);
  }

  damageCover(tx, ty, amount) {
    const c = this.covers.get(ty * this.map.w + tx);
    if (!c) return;
    c.hp -= amount;
    this.particles.burst((tx + 0.5) * TILE, (ty + 0.5) * TILE, 3, '#e0a8f0', 20, 60, 0.2);
    if (c.hp <= 0) this.removeCover(tx, ty);
  }

  coversOf(owner) {
    const out = [];
    for (const c of this.covers.values()) if (c.owner === owner) out.push(c);
    return out;
  }
  hitStop(s) { if (!this.sim) this.game.loop.addHitStop(s); }
  /** Positional sound (attenuated by distance from the camera). */
  sfx(name, x, y) { if (!this.sim) this.game.audio?.play(name, x, y, this.game.renderer.camera); }
  shake(t) { if (!this.sim) this.game.renderer.camera.addTrauma(t); }
  isNearPlayer(x, y) {
    const c = this.game.renderer.camera;
    return Math.abs(x - (c.ox + c.w / 2)) < c.w * 0.7 && Math.abs(y - (c.oy + c.h / 2)) < c.h * 0.7;
  }

  onDeath(victim, killer, item) {
    victim.diedAt = this.time;
    victim.killedBy = killer;
    victim.killedWith = item;
    this.particles.burst(victim.x, victim.y, 22, '#e43b44', 30, 140, 0.6, 1);
    this.particles.burst(victim.x, victim.y, 10, '#ffffff', 20, 80, 0.4, 2);
    this.particles.ring(victim.x, victim.y, 4, 20, '#ffffff', 0.3);
    const swept = !killer && victim.exposure > 0;
    this.killFeed.push({
      t: 0, killer: killer ? killer.name : null, victim: victim.name, swept,
      item: item ? item.def.name : null, player: victim.isPlayer || !!killer?.isPlayer,
    });
    if (this.killFeed.length > 5) this.killFeed.shift();

    if (victim.extra) {
      this.pickups.scatterXp(20, victim.x, victim.y, this.dropRng);
      this.events.emit('death', { victim, killer, item });
      return;
    }
    victim.placement = this.aliveCount + 1;
    victim.finalBuild = victim.slots.filter(Boolean).map((s) => ({ id: s.id, level: s.level })); // before the drop
    dropAll(this, victim, this.dropRng);
    const xp = XP.killBase + XP.killPerLevel * victim.level + XP.killBankShare * victim.xpTotal;
    this.pickups.scatterXp(xp, victim.x, victim.y, this.dropRng);
    if (victim.onDeath?.spawn && killer) this.spawnHunters(victim.onDeath.spawn, victim.x, victim.y, killer);
    this.events.emit('death', { victim, killer, item });

    const p = this.player;
    const alive = this.aliveCount;
    if (victim === p && !this.result) {
      this.result = this._resultFor(p, false);
    } else if (p.alive && alive === 1 && !this.result && this.contestants > 1) {
      p.placement = 1;
      this.result = this._resultFor(p, true);
    }
    // Everyone fell in the same sweep tick: the last to drop is the last one standing.
    if (alive === 0) {
      victim.placement = 1;
      if (victim === p && this.result) this.result = { ...this._resultFor(p, true), placement: 1 };
    }
    if (alive <= 1 && !this.simResult) this._finish(alive === 0 ? victim : null);
  }

  _resultFor(p, win) {
    return {
      win, placement: win ? 1 : p.placement, of: this.contestants,
      killedBy: p.killedBy?.fullName || p.killedBy?.name || (p.exposure > 0 ? "GOBBLER'S POLICE" : null),
      with: p.killedWith?.def.name || null, time: this.time,
      kills: p.kills, damage: Math.round(p.damageDealt), level: p.level,
      build: p.finalBuild || p.slots.filter(Boolean).map((s) => ({ id: s.id, level: s.level })),
      mode: this.mode.id,
    };
  }

  _finish(lastStanding = null) {
    const w = lastStanding || this.fighters.find((f) => f.alive && !f.extra) || null;
    if (w) w.placement = 1;
    this.simResult = {
      seed: this.seed, mode: this.mode.id, duration: +this.time.toFixed(1),
      winner: w ? w.name : null, winnerTier: w ? (w.named ? 'named' : w.tier || (w.isPlayer ? 'player' : '?')) : null,
      winnerKills: w ? w.kills : 0,
    };
    this.events.emit('matchEnd', this.simResult);
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

    // Zone first, so the flow field and AI see the current target.
    this.zone.update(dt);
    if (this.zone.version !== this.flowVersion) {
      this.flowVersion = this.zone.version;
      this.nav.buildFlow(this.zone.next);
    }
    for (let i = 0; i < this.hazards.length; i++) this.hazards[i].update(dt, this);
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const tg = this.telegraphs[i];
      tg.t += dt;
      if (tg.t >= tg.dur || (tg.owner && !tg.owner.alive)) this.telegraphs.splice(i, 1);
    }

    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      if (!f.alive) continue;
      if (f.huntLife !== undefined && (f.huntLife -= dt) <= 0) { this.despawn(f); continue; }
      if (f.controller) f.controller.think(f, this, dt);
      else { f.intents.aimX = f.x + f.facing * 10; f.intents.aimY = f.y; }
    }
    this.nav.process(this.time);
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
      if (f.pendingLevelUps > 0 && (!f.controller || f.controller.isAI)) autoLevel(this, f, this.offerRng, f.controller?.levelPolicy);
    }
    this._updatePrompt();

    this.projectiles.update(dt);
    this.projGrid.clear();
    const pa = this.projectiles.pool.active;
    for (let i = 0; i < pa.length; i++) {
      const q = pa[i];
      if (q.lob) this.projGrid.insert(q, q.tx, q.ty, 0);
      else if (!q.orbit) this.projGrid.insert(q, q.x, q.y, 0);
    }
    this.areas.update(dt);
    this.pickups.update(dt);
    this.particles.update(dt);
    for (let i = this.killFeed.length - 1; i >= 0; i--) {
      this.killFeed[i].t += dt;
      if (this.killFeed[i].t > 6) this.killFeed.splice(i, 1);
    }

    // Camera: follow the player; once dead, spectate their killer (or the leader).
    const cam = this.game.renderer.camera;
    const p = this.player;
    if (!p.alive && (!this.camTarget || !this.camTarget.alive || this.camTarget === p)) {
      let best = p.killedBy && p.killedBy.alive ? p.killedBy : null;
      if (!best) for (const f of fs) if (f.alive && !f.extra && (!best || f.kills > best.kills)) best = f;
      if (best) this.camTarget = best;
    }
    const ct = p.alive ? p : this.camTarget || p;
    cam.follow(ct.x, ct.y, dt);
    let lx = 0;
    let ly = 0;
    if (p.alive && p.intents.stance && !this.sim) {
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
    if (!p.alive || this.sim) return;
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

  _drawTelegraphs(ctx, cam) {
    for (const tg of this.telegraphs) {
      const k = tg.t / tg.dur;
      const pulse = 0.45 + 0.35 * Math.sin(this.time * 30);
      ctx.strokeStyle = tg.color;
      ctx.fillStyle = tg.color;
      if (tg.kind === 'line') {
        ctx.globalAlpha = 0.25 + 0.5 * k;
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1 + Math.round(k * (tg.w - 1));
        ctx.beginPath();
        ctx.moveTo(tg.x - cam.ox, tg.y - 2 - cam.oy);
        ctx.lineTo(tg.x2 - cam.ox, tg.y2 - 2 - cam.oy);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (tg.kind === 'circle') {
        ctx.globalAlpha = pulse;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(tg.x - cam.ox, tg.y - cam.oy, tg.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.arc(tg.x - cam.ox, tg.y - cam.oy, Math.max(0.5, tg.r * k), 0, Math.PI * 2);
        ctx.fill();
      } else if (tg.kind === 'arc') {
        ctx.globalAlpha = pulse * 0.6;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tg.x - cam.ox, tg.y - cam.oy);
        ctx.arc(tg.x - cam.ox, tg.y - cam.oy, tg.r, tg.a - tg.arc / 2, tg.a + tg.arc / 2);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  render(ctx) {
    const cam = this.game.renderer.camera;
    const assets = this.game.assets;
    ctx.fillStyle = this.mode.background;
    ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
    this.map.draw(ctx, cam, assets);
    for (let i = 0; i < this.hazards.length; i++) if (this.hazards[i].drawGround) this.hazards[i].drawGround(ctx, cam, this);
    this.areas.draw(ctx, cam);
    this._drawTelegraphs(ctx, cam);
    this.pickups.draw(ctx, cam, assets);

    // Aim line in stance (player only).
    const p = this.player;
    if (p.alive && p.intents.stance && !this.sim) {
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
    for (let i = 0; i < this.hazards.length; i++) if (this.hazards[i].drawTop) this.hazards[i].drawTop(ctx, cam, this);
    this.zone.draw(ctx, cam, this.game.sprites, this.policeLook, this.hatch);
    this.particles.draw(ctx, cam);
    for (let i = 0; i < this.hazards.length; i++) if (this.hazards[i].drawOverlay) this.hazards[i].drawOverlay(ctx, cam, this);
    for (let i = 0; i < list.length; i++) if (list[i].named || list[i].extra) drawNameTag(ctx, list[i], cam);
    if (this.mode.drawOverlay) this.mode.drawOverlay(ctx, cam, this);
    drawHud(ctx, this);
    if (this.sim) drawText(ctx, `SIM  ${this.time.toFixed(0)}S`, 4, INTERNAL_H - 10, { color: '#a7f070', shadow: '#000' });
  }
}
