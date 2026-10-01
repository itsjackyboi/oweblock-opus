// AIController: perception + utility states -> the same intents the player makes.
// States: LOOT, ENGAGE, KITE (ENGAGE with range keeping), RETREAT, ZONE, THIRD_PARTY,
// XP, ROAM. The best score wins, with hysteresis so states don't flicker.
// Item use is driven entirely by each item's `ai` hints; skill comes from js/data/tiers.js.
// Decisions run at the tier's think interval (staggered by fighter id); steering,
// aiming and triggers run every step.

import { TIERS } from '../data/tiers.js';
import { RARITY_WEIGHT } from '../data/registry.js';
import { heldItem, itemRange, slotOf, freeSlot } from '../game/items.js';
import { ITEMS } from '../config.js';

const near = [];
const tmp = { x: 0, y: 0 };
const HYSTERESIS = 0.12;
const FIGHT_ROLL = 4; // s between fight-or-not rolls for the same target
const ROAM_BASE = 160;
const ROAM_GROWTH = 2; // px per second of match time
const WHISKER = 11;
const WHISKER_OFFSETS = [0.6, -0.6, 1.2, -1.2, 1.8, -1.8];

function itemValue(def, prefers) {
  if (!def) return 0;
  return 1 / RARITY_WEIGHT[def.rarity] + (prefers && prefers.includes(def.id) ? 0.25 : 0);
}

function projSpeed(item) {
  const p = item.resolved?.p || item.def.primary.params || {};
  const s = p.speed ?? p.max?.speed;
  return typeof s === 'number' ? s : Array.isArray(s) ? s[0] : 300;
}

export class AIController {
  constructor(match, fighter, tierId, rng, opts = {}) {
    this.isAI = true;
    this.match = match;
    this.fighter = fighter;
    this.tierId = tierId;
    this.tier = TIERS[tierId] || TIERS.med;
    this.rng = rng;
    this.levelPolicy = { ...this.tier.levelPolicy };
    this.prefers = opts.prefers || [];
    this.hunt = opts.hunt || null;

    this.thinkT = ((fighter.id % 10) / 10) * this.tier.think;
    this.state = 'ROAM';
    this.target = null;
    this.targetVisible = false;
    this.reactT = 0;
    this.goalKind = 'none';
    this.goalX = fighter.x;
    this.goalY = fighter.y;
    this.goalItem = null;
    this.losGoal = true;

    // Path (filled by Nav).
    this.path = [];
    this.pathI = 0;
    this.pathTime = -99;
    this.pathQueued = false;
    this.pathTX = 0;
    this.pathTY = 0;

    this.dodgeX = 0; this.dodgeY = 0; this.dodgeT = 0;
    this.avoidX = 0; this.avoidY = 0;
    this.strafeSign = rng.sign(); this.strafeT = 0;
    this.aimErr = 0;
    this.chargeGoal = 1;
    this.swapCd = 0;
    this.lastX = fighter.x; this.lastY = fighter.y; this.stuckT = 0; this.unstickT = 0; this.unstickA = 0;
    this.roamX = fighter.x; this.roamY = fighter.y; this.roamT = 0;
    this.wantSpecial = false;
    this.wantDash = false;
    this.dashDX = 0; this.dashDY = 0;
    this.wantPickup = false;
    this.wantSwapTo = -1;
    this.threat = null;
    this.thirdT = 0;
    this.engaged = false;
    // Personality: each fighter's appetite for a fight varies around its tier's.
    this.aggr = this.tier.aggression * rng.range(0.6, 1.3);
    this.wantFight = false;
    this.fightRollT = 0;
  }

  // ---------------------------------------------------------------- per step

  think(f, m, dt) {
    this.thinkT -= dt;
    this.reactT -= dt;
    this.dodgeT -= dt;
    this.swapCd -= dt;
    this.strafeT -= dt;
    this.unstickT -= dt;
    this.thirdT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT += this.tier.think;
      this.decide(f, m);
    }
    this.act(f, m, dt);
  }

  // ---------------------------------------------------------------- decisions

  decide(f, m) {
    const tier = this.tier;
    const rng = this.rng;
    const zone = m.zone;

    if (this.hunt) {
      if (!this.hunt.alive) { m.despawn(f); return; }
      this.target = this.hunt;
      this.targetVisible = m.map.lineOfSight(f.x, f.y, this.hunt.x, this.hunt.y);
      this.state = 'ENGAGE';
      this.engaged = true;
      this._goalFighter(f, m, this.hunt);
      this._chooseSlot(f, Math.hypot(this.hunt.x - f.x, this.hunt.y - f.y));
      this._specials(f, m);
      return;
    }

    // --- perception: pick a target among visible enemies
    const perc = tier.perception * (m.perceptionMul || 1);
    m.grid.query(f.x, f.y, perc, near);
    let best = null;
    let bestScore = Infinity;
    let enemiesClose = 0;
    for (let i = 0; i < near.length; i++) {
      const e = near[i];
      if (e === f || !e.alive || e.extra) continue;
      const d = Math.hypot(e.x - f.x, e.y - f.y);
      if (d > perc) continue;
      if (d < 70) enemiesClose++;
      if (e !== this.target && !m.map.lineOfSight(f.x, f.y, e.x, e.y)) continue;
      let s = d / perc - tier.focusWeak * (1 - e.hp / e.maxHp) * 0.6;
      if (e === this.target) s -= 0.2;
      if (s < bestScore) { bestScore = s; best = e; }
    }
    // Retaliate: whoever hurt us recently becomes the target.
    const attacker = f.lastHitBy;
    // Stray splash from someone else's fight doesn't count: only deliberate attackers (or the player).
    const retaliate = attacker && attacker.alive && !attacker.extra && m.time - f.lastHitTime < 3
      && (attacker.isPlayer || !attacker.controller || attacker.controller.target === f)
      && Math.hypot(attacker.x - f.x, attacker.y - f.y) < perc * 1.2;
    if (retaliate) best = attacker;
    if (best && best !== this.target) { this.reactT = rng.range(tier.reaction[0], tier.reaction[1]); this.fightRollT = 0; }
    // Decide per encounter (re-rolled every few seconds) whether to pick a fight.
    this.fightRollT -= tier.think;
    const fightChance = () => Math.max(0, Math.min(1, m.fightPressure * (this.aggr / 0.85) * FIGHT_ROLL / Math.max(4, m.aliveCount)));
    if (!best) this.wantFight = false;
    else if (this.fightRollT <= 0) {
      this.fightRollT = FIGHT_ROLL;
      this.wantFight = rng.chance(fightChance());
    }
    this.target = best;
    this.targetVisible = !!best && m.map.lineOfSight(f.x, f.y, best.x, best.y);

    // --- third party: join a fight nearby
    if (!best && tier.thirdParty > 0 && this.thirdT <= 0) {
      this.thirdT = 1.5;
      if (rng.chance(tier.thirdParty)) {
        m.grid.query(f.x, f.y, tier.thirdPartyRange, near);
        for (let i = 0; i < near.length; i++) {
          const e = near[i];
          if (e === f || !e.alive || e.extra) continue;
          const a = e.lastHitBy;
          if (a && a.alive && a !== f && m.time - e.lastHitTime < 2) {
            best = e.hp / e.maxHp < a.hp / a.maxHp ? e : a;
            break;
          }
        }
        // Joining a fight is more tempting than starting one, but still paced by the director.
        if (best && rng.chance(Math.min(1, fightChance() * 3))) {
          this.target = best;
          this.wantFight = true;
          this.fightRollT = FIGHT_ROLL;
          this.reactT = rng.range(tier.reaction[0], tier.reaction[1]);
        } else best = null;
      }
    }

    const hpFrac = f.hp / f.maxHp;
    const tgt = this.target;
    const dT = tgt ? Math.hypot(tgt.x - f.x, tgt.y - f.y) : Infinity;
    const armed = f.slots.some((s) => s);

    // --- zone urgency
    let zoneU = 0;
    if (zone && !f.zoneImmune) {
      const inCur = zone.inside(f.x, f.y, 10);
      const inNext = zone.insideNext(f.x, f.y, 14);
      if (tier.zone === 'damage') zoneU = f.exposure > 0 ? 1.2 : 0;
      else if (tier.zone === 'moderate') zoneU = !inCur ? 1.2 : (!inNext && zone.state === 'shrink' ? 0.85 : 0);
      else zoneU = !inCur ? 1.2 : (!inNext && (zone.state === 'shrink' || zone.timeToShrink < 25) ? 0.9 : 0);
    }

    // --- loot / xp candidates
    const loot = this._findLoot(f, m, armed ? 230 : 360);
    const xpCap = !loot ? this._findXp(f, m, 130) : null;

    // --- scores
    const h = (s) => (this.state === s ? HYSTERESIS : 0);
    const scores = {
      ZONE: zoneU,
      // Spontaneous fights need real appetite (aggression ramps up over the match);
      // being hit always gets a response.
      ENGAGE: tgt ? (this.wantFight ? 0.35 + this.aggr * 0.4 * (0.6 + 0.4 * hpFrac) * (armed ? 1 : 0.6) : 0)
        + (retaliate ? 0.7 : 0) - (enemiesClose > 2 ? 0.15 : 0) : 0,
      RETREAT: tgt && hpFrac < 0.35 && tier.kite > 0 && (retaliate || tgt.controller?.target === f) ? (0.4 - hpFrac) * 2 + (tgt.hp / tgt.maxHp > hpFrac ? 0.2 : 0) : 0,
      LOOT: loot ? (armed ? 0.5 : 0.95) - loot.d / 1200 : 0,
      XP: xpCap ? 0.38 : 0,
      ROAM: 0.3,
    };
    if (tgt && this.state === 'THIRD_PARTY') scores.ENGAGE += 0.05;
    let st = 'ROAM';
    let sv = -1;
    for (const k in scores) {
      const v = scores[k] + h(k);
      if (v > sv) { sv = v; st = k; }
    }
    this.state = st;
    // Only fight when engaged, retaliating, or (sometimes) when an enemy is right on top of us.
    this.engaged = st === 'ENGAGE' || !!retaliate
      || (tgt && dT < 24 && this.wantFight);

    // --- goals
    if (st === 'ZONE') {
      this.goalKind = 'flow';
    } else if (st === 'ENGAGE') {
      this._goalFighter(f, m, tgt);
    } else if (st === 'RETREAT') {
      const dx = f.x - tgt.x;
      const dy = f.y - tgt.y;
      const l = Math.hypot(dx, dy) || 1;
      this.goalKind = 'dir';
      this.goalX = dx / l;
      this.goalY = dy / l;
    } else if (st === 'LOOT') {
      this._goalPoint(f, m, loot.p.x, loot.p.y);
      this.goalItem = loot.p;
    } else if (st === 'XP') {
      this._goalPoint(f, m, xpCap.x, xpCap.y);
    } else {
      this._roam(f, m);
    }

    // --- full slots: swap for a better item when standing on it
    this.wantPickup = false;
    if (loot && loot.swap && loot.d < ITEMS.promptRange) {
      if (f.held !== loot.worst) this.wantSwapTo = loot.worst;
      else this.wantPickup = true;
    } else {
      this._chooseSlot(f, dT);
    }

    // --- danger: projectiles, lob landings, enemy areas
    this._danger(f, m);
    this._specials(f, m);

    // --- dash decisions
    this.wantDash = false;
    const d = tier.dash;
    if (f.dashCd <= 0) {
      if (this.threat && d.dodge && this.threat.tti < 0.3 && rng.chance(tier.dodge)) {
        this.wantDash = true; this.dashDX = this.dodgeX; this.dashDY = this.dodgeY;
      } else if (tgt && d.engage && st === 'ENGAGE' && this.targetVisible && dT > 35 && dT < 90 && itemRange(heldItem(f)) < 40 && rng.chance(0.25)) {
        this.wantDash = true; this.dashDX = (tgt.x - f.x) / dT; this.dashDY = (tgt.y - f.y) / dT;
      } else if (tgt && ((d.escape && st === 'RETREAT' && dT < 60) || (d.panic && hpFrac < 0.25 && dT < 40))) {
        this.wantDash = true; this.dashDX = (f.x - tgt.x) / (dT || 1); this.dashDY = (f.y - tgt.y) / (dT || 1);
      } else if (st === 'ZONE' && tier.zone !== 'damage' && !zone.inside(f.x, f.y) && rng.chance(0.5)) {
        m.nav.flowDir(f.x, f.y, tmp);
        this.wantDash = true; this.dashDX = tmp.x; this.dashDY = tmp.y;
      }
    }

    // --- per-attack aim error
    this.aimErr = rng.gauss() * tier.aimError;
    if (this.strafeT <= 0) { this.strafeSign = rng.sign(); this.strafeT = rng.range(0.6, 1.4); }
  }

  _goalFighter(f, m, t) {
    this.goalKind = 'fighter';
    this.goalX = t.x;
    this.goalY = t.y;
    this.losGoal = m.map.lineOfSight(f.x, f.y, t.x, t.y);
    if (!this.losGoal) this._ensurePath(f, m, t.x, t.y);
  }

  _goalPoint(f, m, x, y) {
    this.goalKind = 'point';
    this.goalX = x;
    this.goalY = y;
    this.losGoal = m.map.lineOfSight(f.x, f.y, x, y);
    if (!this.losGoal) this._ensurePath(f, m, x, y);
  }

  _ensurePath(f, m, x, y) {
    const stale = m.time - this.pathTime > 1 || Math.hypot(x - this.pathTX, y - this.pathTY) > 48 || this.pathI >= this.path.length;
    if (stale && !this.pathQueued) m.nav.request(this, x, y);
  }

  _roam(f, m) {
    this.roamT -= this.tier.think;
    const zone = m.zone;
    const reached = Math.hypot(this.roamX - f.x, this.roamY - f.y) < 24;
    const outside = zone && !zone.insideNext(this.roamX, this.roamY, 16);
    if (reached || this.roamT <= 0 || outside) {
      // Roam locally early on; the radius grows as the match goes on.
      const pts = m.map.meta.lootPoints && m.map.meta.lootPoints.length ? m.map.meta.lootPoints : m.map.meta.spawns;
      const R = ROAM_BASE + m.time * ROAM_GROWTH;
      let pick = null;
      for (let k = 0; k < 16; k++) {
        const p = this.rng.pick(pts);
        if (zone && !zone.insideNext(p.x, p.y, 16)) continue;
        if (Math.abs(p.x - f.x) + Math.abs(p.y - f.y) > R && k < 12) continue;
        pick = p;
        break;
      }
      if (!pick) pick = this.rng.pick(pts);
      this.roamX = pick.x;
      this.roamY = pick.y;
      this.roamT = this.rng.range(6, 12);
    }
    this._goalPoint(f, m, this.roamX, this.roamY);
  }

  /** Nearest useful item on the ground: { p, d, swap, worst }. */
  _findLoot(f, m, range) {
    const act = m.pickups.pool.active;
    let best = null;
    let bd = range;
    const full = freeSlot(f) < 0;
    let worst = -1;
    let worstV = Infinity;
    if (full) {
      for (let i = 0; i < f.slots.length; i++) {
        const v = itemValue(f.slots[i].def, this.prefers) + f.slots[i].level * 0.05;
        if (v < worstV) { worstV = v; worst = i; }
      }
    }
    for (let i = 0; i < act.length; i++) {
      const p = act[i];
      if (p.kind !== 'item' || (p.noT > 0 && p.noId === f.id)) continue;
      const d = Math.abs(p.x - f.x) + Math.abs(p.y - f.y);
      if (d >= bd) continue;
      const own = slotOf(f, p.item.id);
      let useful = false;
      let swap = false;
      if (own >= 0) useful = f.slots[own].level < ITEMS.maxLevel;
      else if (!full) useful = true;
      else if (itemValue(p.item.def, this.prefers) + p.item.level * 0.05 > worstV + 0.08) { useful = true; swap = true; }
      if (!useful) continue;
      if (m.zone && !m.zone.inside(p.x, p.y, 8)) continue;
      bd = d;
      best = { p, d, swap, worst };
    }
    return best;
  }

  _findXp(f, m, range) {
    const act = m.pickups.pool.active;
    let best = null;
    let bd = range;
    for (let i = 0; i < act.length; i++) {
      const p = act[i];
      if (p.kind !== 'xp') continue;
      const d = Math.abs(p.x - f.x) + Math.abs(p.y - f.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** Hold the slot whose item best suits the distance to the target. */
  _chooseSlot(f, d) {
    if (this.swapCd > 0) return;
    const cur = heldItem(f);
    if (cur.charge >= 0) return;
    let bestI = -1;
    let bestS = -Infinity;
    for (let i = 0; i < f.slots.length; i++) {
      const it = f.slots[i];
      if (!it) continue;
      const hints = it.def.ai || {};
      const range = itemRange(it);
      const ideal = hints.idealRange ?? range;
      let s = it.level * 0.08 + itemValue(it.def, this.prefers) * 0.3;
      if (d === Infinity) s += Math.min(1, range / 150) * 0.3; // no target: favor reach
      else {
        s += d <= range * 1.05 ? 1 : 0.4 - Math.min(0.4, (d - range) / 400);
        s += (1 - Math.min(1, Math.abs(d - ideal) / 200)) * 0.5;
        if (hints.minRange && d < hints.minRange) s -= 0.4;
      }
      if (i === f.held) s += 0.15;
      if (s > bestS) { bestS = s; bestI = i; }
    }
    if (bestI >= 0 && bestI !== f.held) {
      this.wantSwapTo = bestI;
      this.swapCd = 1;
    }
  }

  _danger(f, m) {
    this.threat = null;
    m.projGrid.query(f.x, f.y, 110, near);
    for (let i = 0; i < near.length; i++) {
      const p = near[i];
      if (!p.alive || p.owner === f || p.orbit) continue;
      if (p.lob) {
        const r = (p.area?.radius || 20) + 8;
        if ((p.tx - f.x) ** 2 + (p.ty - f.y) ** 2 < r * r) {
          const dx = f.x - p.tx;
          const dy = f.y - p.ty;
          const l = Math.hypot(dx, dy) || 1;
          this.threat = { tti: p.lobDur - p.lobT, x: dx / l, y: dy / l };
          break;
        }
        continue;
      }
      const rx = f.x - p.x;
      const ry = f.y - p.y;
      const v2 = p.vx * p.vx + p.vy * p.vy;
      if (v2 < 1) continue;
      const t = (rx * p.vx + ry * p.vy) / v2;
      if (t < 0 || t > 0.6) continue;
      const cx = rx - p.vx * t;
      const cy = ry - p.vy * t;
      if (cx * cx + cy * cy > (f.r + p.radius + 7) ** 2) continue;
      const sp = Math.sqrt(v2);
      let px = -p.vy / sp;
      let py = p.vx / sp;
      if (px * rx + py * ry < 0) { px = -px; py = -py; }
      this.threat = { tti: t, x: px, y: py, incoming: true };
      break;
    }
    if (this.threat && this.dodgeT <= 0 && this.rng.chance(this.tier.dodge)) {
      this.dodgeX = this.threat.x;
      this.dodgeY = this.threat.y;
      this.dodgeT = 0.3;
    }
    // Enemy damaging areas: step out.
    this.avoidX = 0;
    this.avoidY = 0;
    const areas = m.areas.pool.active;
    for (let i = 0; i < areas.length; i++) {
      const a = areas[i];
      if (a.owner === f || (a.dps <= 0 && !a.status)) continue;
      const dx = f.x - a.x;
      const dy = f.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d < a.r + 8) { this.avoidX += dx / (d || 1); this.avoidY += dy / (d || 1); }
    }
  }

  /** Decide whether to fire the held item's special this think, from its `ai.specialWhen` hint. */
  _specials(f, m) {
    this.wantSpecial = false;
    const item = heldItem(f);
    if (!item.def.special || item.cdS > 0) return;
    const hints = item.def.ai || {};
    const t = this.target;
    const tier = this.tier;
    const d = t ? Math.hypot(t.x - f.x, t.y - f.y) : Infinity;
    const range = itemRange(item);
    const inRange = t && d <= range * 1.05 && (this.targetVisible || hints.aim === 'lob');
    let ok = false;
    switch (hints.specialWhen) {
      case 'incoming': {
        const swing = t && d < 30 && t.swingT > 0;
        ok = (this.threat?.incoming || swing) && this.rng.chance(tier.dodge + 0.1);
        break;
      }
      case 'clustered': {
        if (!inRange) break;
        let n = 0;
        m.grid.query(t.x, t.y, 44, near);
        for (let i = 0; i < near.length; i++) if (near[i] !== f && near[i].alive) n++;
        ok = n >= 2 || (tier.relic === 'random' ? this.rng.chance(0.15) : this.rng.chance(0.06));
        break;
      }
      case 'nearWall': {
        if (!t || d > 18) break;
        const ux = (t.x - f.x) / (d || 1);
        const uy = (t.y - f.y) / (d || 1);
        ok = m.map.isSolidAt(t.x + ux * 18, t.y + uy * 18) || this.rng.chance(0.1);
        break;
      }
      case 'targetRooted':
        ok = inRange && (t.statuses.root.t > 0 || t.statuses.stun.t > 0 || (tier.relic !== 'predictive' && this.rng.chance(0.1)));
        break;
      case 'lowHp':
        ok = f.hp / f.maxHp < 0.45;
        break;
      case 'always':
        ok = true;
        break;
      default:
        ok = inRange && this.rng.chance(tier.relic === 'random' ? 0.2 : 0.35);
    }
    this.wantSpecial = !!ok && this.reactT <= 0 && (this.engaged || hints.specialWhen === 'incoming');
  }

  // ---------------------------------------------------------------- actions

  act(f, m, dt) {
    const it = f.intents;
    const tier = this.tier;
    it.use = false;
    it.usePressed = false;
    it.useReleased = false;
    it.special = false;
    it.specialPressed = false;
    it.stance = false;
    it.dash = false;
    it.pickup = false;
    it.swapTo = -1;
    it.swapStep = 0;

    // --- movement direction
    let mx = 0;
    let my = 0;
    const t = this.target && this.target.alive ? this.target : null;
    if (!t && this.goalKind === 'fighter') this.goalKind = 'none';
    const item = heldItem(f);
    const hints = item.def.ai || {};

    if (this.goalKind === 'flow') {
      const dist = m.nav.flowDir(f.x, f.y, tmp);
      if (dist === 0) {
        // Inside the target zone: drift toward its middle.
        const z = m.zone.next;
        const cx = (z.x0 + z.x1) / 2 - f.x;
        const cy = (z.y0 + z.y1) / 2 - f.y;
        const l = Math.hypot(cx, cy);
        if (l > 24) { mx = cx / l * 0.6; my = cy / l * 0.6; }
      } else { mx = tmp.x; my = tmp.y; }
    } else if (this.goalKind === 'dir') {
      mx = this.goalX; my = this.goalY;
    } else if (this.goalKind === 'fighter' && t) {
      const dx = t.x - f.x;
      const dy = t.y - f.y;
      const d = Math.hypot(dx, dy) || 1;
      const ideal = hints.idealRange ?? 14;
      const minR = hints.minRange ?? 0;
      let toward = 0;
      if (!this.losGoal) toward = 1;
      else if (tier.kite === 0) toward = d > ideal * 0.9 ? 1 : 0;
      else if (d > ideal * 1.1) toward = 1;
      else if (d < Math.max(minR, ideal * 0.6)) toward = -1;
      if (toward === 1 && !this.losGoal && this.path.length) {
        this._followPath(f, tmp);
        mx = tmp.x; my = tmp.y;
      } else {
        mx = (dx / d) * toward;
        my = (dy / d) * toward;
      }
      if (tier.kite === 2 && this.losGoal && ideal > 30) {
        mx += (-dy / d) * this.strafeSign * 0.7;
        my += (dx / d) * this.strafeSign * 0.7;
      } else if (tier.kite >= 1 && this.losGoal && ideal <= 30 && d < 40) {
        mx += (-dy / d) * this.strafeSign * 0.35;
        my += (dx / d) * this.strafeSign * 0.35;
      }
    } else if (this.goalKind === 'point') {
      if (this.losGoal || !this.path.length) {
        const dx = this.goalX - f.x;
        const dy = this.goalY - f.y;
        const d = Math.hypot(dx, dy);
        if (d > 3) { mx = dx / d; my = dy / d; }
      } else {
        this._followPath(f, tmp);
        mx = tmp.x; my = tmp.y;
      }
    }

    // Dodge, area avoidance, separation.
    if (this.dodgeT > 0) { mx = mx * 0.3 + this.dodgeX; my = my * 0.3 + this.dodgeY; }
    mx += this.avoidX * 1.5;
    my += this.avoidY * 1.5;
    m.grid.query(f.x, f.y, 13, near);
    for (let i = 0; i < near.length; i++) {
      const o = near[i];
      if (o === f || !o.alive || o === t) continue;
      const dx = f.x - o.x;
      const dy = f.y - o.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 13) { mx += (dx / d) * 0.5; my += (dy / d) * 0.5; }
    }

    // Unstick: if pushing but not moving, try a sideways shove for a moment.
    if (this.unstickT > 0) { mx = Math.cos(this.unstickA); my = Math.sin(this.unstickA); }

    const ml = Math.hypot(mx, my);
    if (ml > 0.01) {
      mx /= ml; my /= ml;
      // Whiskers: if the way ahead is a wall, rotate until it isn't.
      if (m.map.isSolidAt(f.x + mx * WHISKER, f.y + my * WHISKER)) {
        const base = Math.atan2(my, mx);
        for (const off of WHISKER_OFFSETS) {
          const a = base + off * this.strafeSign;
          if (!m.map.isSolidAt(f.x + Math.cos(a) * WHISKER, f.y + Math.sin(a) * WHISKER)) { mx = Math.cos(a); my = Math.sin(a); break; }
        }
      }
    }
    it.moveX = mx;
    it.moveY = my;

    this.stuckT += dt;
    if (this.stuckT > 0.8) {
      const moved = Math.hypot(f.x - this.lastX, f.y - this.lastY);
      if (ml > 0.3 && moved < 4 && !f.dashing) {
        this.unstickT = 0.4;
        this.unstickA = this.rng.range(0, Math.PI * 2);
        this.pathTime = -99;
      }
      this.stuckT = 0;
      this.lastX = f.x;
      this.lastY = f.y;
    }

    // --- aim
    if (t) {
      const dx = t.x - f.x;
      const dy = t.y - f.y;
      const d = Math.hypot(dx, dy);
      let ax = t.x;
      let ay = t.y;
      if (hints.aim === 'lead' || hints.aim === 'lob') {
        const flight = d / projSpeed(item);
        ax += t.vx * flight * tier.lead;
        ay += t.vy * flight * tier.lead;
      }
      const a = Math.atan2(ay - f.y, ax - f.x) + this.aimErr;
      const ad = Math.hypot(ax - f.x, ay - f.y);
      it.aimX = f.x + Math.cos(a) * ad;
      it.aimY = f.y + Math.sin(a) * ad;
      it.stance = tier.kite === 2 && d > 90 && hints.aim !== 'direct';

      // --- use
      const range = itemRange(item) * (it.stance ? 1.15 : 1);
      const reach = hints.idealRange != null && hints.idealRange < 30 ? range + t.r : range * 0.95;
      const canHit = this.engaged && d <= reach && (this.targetVisible || hints.aim === 'lob') && this.reactT <= 0;
      const charging = item.charge >= 0;
      if (charging) {
        const p = item.resolved?.p || {};
        it.use = item.charge < this.chargeGoal * (p.maxDraw || 0.8);
        if (!canHit && item.charge > (p.minDraw || 0.1) + 0.1) it.use = false;
      } else if (canHit && f.swapT <= 0) {
        it.use = true;
        it.usePressed = true;
        this.chargeGoal = this.rng.range(tier.chargeSkill * 0.6, 1);
      }
    } else {
      it.aimX = f.x + (mx || f.facing) * 30;
      it.aimY = f.y + my * 30;
      if (item.charge >= 0) it.use = false;
    }

    if (this.wantSpecial) { it.specialPressed = true; it.special = true; this.wantSpecial = false; }
    if (this.wantDash) {
      it.dash = true;
      it.moveX = this.dashDX;
      it.moveY = this.dashDY;
      this.wantDash = false;
    }
    if (this.wantSwapTo >= 0) { it.swapTo = this.wantSwapTo; this.wantSwapTo = -1; }
    if (this.wantPickup) { it.pickup = true; this.wantPickup = false; }
  }

  _followPath(f, out) {
    const path = this.path;
    while (this.pathI < path.length) {
      const w = path[this.pathI];
      if (Math.abs(w.x - f.x) + Math.abs(w.y - f.y) < 9) this.pathI++;
      else break;
    }
    // Skip ahead when the next-next waypoint is visible (cheap string pulling).
    if (this.pathI + 2 < path.length && (this.pathI & 1) === 0) {
      const w2 = path[this.pathI + 2];
      if (this.match.map.lineOfSight(f.x, f.y, w2.x, w2.y)) this.pathI += 1;
    }
    const w = path[Math.min(this.pathI, path.length - 1)];
    const dx = w.x - f.x;
    const dy = w.y - f.y;
    const l = Math.hypot(dx, dy) || 1;
    out.x = dx / l;
    out.y = dy / l;
  }
}
