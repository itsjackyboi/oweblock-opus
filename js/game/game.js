// Screen state machine: title -> match (pause, level-up picker, death/win result).

import { INTERNAL_W, INTERNAL_H, URLP } from '../config.js';
import { Match } from './match.js';
import { RNG } from '../core/rng.js';
import { drawText } from '../ui/font.js';
import { UI } from '../ui/hud.js';
import { drawDebug } from '../ui/debug.js';
import { drawPicker, drawResult, drawPause, pickerCards } from '../ui/screens.js';
import { generateOffers, applyOffer } from './levelup.js';
import { DEFAULT_MODE } from '../data/modes.js';

export class Game {
  constructor({ renderer, input, assets, sprites, loop }) {
    this.renderer = renderer;
    this.input = input;
    this.assets = assets;
    this.sprites = sprites;
    this.loop = loop;
    this.screen = 'title';
    this.match = null;
    this.paused = false;
    this.showDebug = URLP.debug;
    this.titleT = 0;
    this._buildTitleCast();
  }

  _buildTitleCast() {
    const rng = new RNG(7);
    const palettes = ['red', 'red', 'red', 'grey', 'blue', 'blue', 'blue'];
    this.titleCast = palettes.map((p) => this.sprites.randomAppearance(rng, p));
    this.titleCast.push(this.sprites.randomAppearance(rng, 'police'));
  }

  startMatch(opts = {}) {
    const seed = opts.seed ?? URLP.seed ?? ((Math.random() * 2 ** 32) >>> 0);
    this.match = new Match(this, { modeId: opts.mode ?? URLP.mode ?? DEFAULT_MODE, seed });
    this.screen = 'match';
    this.paused = false;
    this.picker = null;
    this.simReported = false;
  }

  update(dt) {
    const inp = this.input;
    if (inp.wasPressed('F3')) this.showDebug = !this.showDebug;
    if (this.screen === 'title') {
      this.titleT += dt;
      if (inp.wasPressed('Enter') || inp.wasPressed('Space') || inp.btnPressed[0]) this.startMatch();
      return;
    }
    if (this.screen === 'match') {
      const m = this.match;
      if (this.picker) { this._updatePicker(); return; }
      if (inp.wasPressed('Escape') && !m.result) this.paused = !this.paused;
      if (this.paused || m.result) {
        if (inp.wasPressed('KeyR')) { this.startMatch({ seed: m.seed }); return; }
        if (inp.wasPressed('KeyT')) { this.screen = 'title'; this.match = null; return; }
      }
      if (this.paused) return;
      m.update(dt);
      const p = m.player;
      if (m.simResult && !this.simReported) {
        this.simReported = true;
        this.onSimEnd?.(m.simResult);
      }
      if (p.alive && p.pendingLevelUps > 0 && !m.result && !p.controller.isAI) {
        this.picker = { offers: generateOffers(m, p, m.offerRng), hover: -1 };
        if (!this.picker.offers.length) { p.pendingLevelUps = 0; this.picker = null; }
      }
    }
  }

  /** Level-up picker: the world is paused until a card is chosen. */
  _updatePicker() {
    const inp = this.input;
    const pk = this.picker;
    let choice = -1;
    for (let i = 0; i < pk.offers.length; i++) if (inp.wasPressed(`Digit${i + 1}`)) choice = i;
    if (inp.btnPressed[0]) {
      const cards = pickerCards(pk.offers.length);
      const mx = inp.mouse.x;
      const my = inp.mouse.y;
      cards.forEach((c, i) => { if (mx >= c.x && mx < c.x + c.w && my >= c.y && my < c.y + c.h) choice = i; });
    }
    if (choice < 0) return;
    const m = this.match;
    applyOffer(m, m.player, pk.offers[choice]);
    this.picker = null;
    if (m.player.controller) m.player.controller.blockUse = true;
    if (m.player.pendingLevelUps > 0) this.picker = { offers: generateOffers(m, m.player, m.offerRng), hover: -1 };
  }

  render() {
    const ctx = this.renderer.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.screen === 'title') this._renderTitle(ctx);
    else if (this.screen === 'match') {
      this.match.render(ctx);
      if (this.picker) drawPicker(ctx, this.picker, this.match, this.input.mouse);
      else if (this.match.result) drawResult(ctx, this.match);
      else if (this.paused) drawPause(ctx);
    }
    if (this.showDebug) drawDebug(ctx, this);
  }

  _renderTitle(ctx) {
    ctx.fillStyle = '#1a1c2c';
    ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
    // Ground strip.
    ctx.fillStyle = '#29366f';
    ctx.fillRect(0, 168, INTERNAL_W, 2);
    ctx.fillStyle = '#333c57';
    ctx.fillRect(0, 170, INTERNAL_W, 100);

    drawText(ctx, 'OWE BLOCK', INTERNAL_W / 2, 40, { color: UI.gold, shadow: '#b13e53', scale: 5, align: 'center' });
    drawText(ctx, 'BRAWL', INTERNAL_W / 2, 84, { color: UI.ink, shadow: '#b13e53', scale: 3, align: 'center' });

    // A row of fighters, bobbing.
    const n = this.titleCast.length;
    for (let i = 0; i < n; i++) {
      const spr = this.sprites.get(this.titleCast[i]).normal;
      const x = INTERNAL_W / 2 + (i - (n - 1) / 2) * 40;
      const bob = Math.round(Math.abs(Math.sin(this.titleT * 3 + i)) * -3);
      ctx.drawImage(spr, Math.round(x - 16), 136 + bob, 32, 32);
    }

    if (Math.floor(this.titleT * 2) % 2 === 0) {
      drawText(ctx, 'CLICK OR PRESS ENTER', INTERNAL_W / 2, 196, { color: UI.ink, shadow: UI.shadow, align: 'center' });
    }
    drawText(ctx, 'STAGE 3 BUILD: AI', INTERNAL_W / 2, 250, { color: UI.dim, align: 'center' });
  }
}
