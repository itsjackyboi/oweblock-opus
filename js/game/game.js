// Screen state machine:
//   title (menu) -> modes (mode select) -> match (pause, level-up picker, death/win result)

import { INTERNAL_W, INTERNAL_H, URLP } from '../config.js';
import { Match } from './match.js';
import { RNG } from '../core/rng.js';
import { drawText } from '../ui/font.js';
import { UI } from '../ui/hud.js';
import { drawDebug } from '../ui/debug.js';
import { drawPicker, drawResult, drawPause, pickerCards, drawMenu, menuHit, drawModeSelect, modeCards } from '../ui/screens.js';
import { generateOffers, applyOffer } from './levelup.js';
import { MODES, DEFAULT_MODE, getMode } from '../data/modes.js';

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
    this.modeId = getMode(URLP.mode || DEFAULT_MODE).id;
    this.menuSel = 0;
    this.modeSel = Math.max(0, MODES.findIndex((m) => m.id === this.modeId));
    this._buildTitleCast();
  }

  _buildTitleCast() {
    const rng = new RNG(7);
    const palettes = ['red', 'red', 'red', 'grey', 'blue', 'blue', 'blue'];
    this.titleCast = palettes.map((p) => this.sprites.randomAppearance(rng, p));
    this.titleCast.push(this.sprites.randomAppearance(rng, 'police'));
  }

  /** Title menu entries (label + action). */
  get menu() {
    return [
      { label: `START: ${getMode(this.modeId).name}`, act: () => this.startMatch() },
      { label: 'MODE SELECT', act: () => { this.screen = 'modes'; } },
    ];
  }

  startMatch(opts = {}) {
    const seed = opts.seed ?? URLP.seed ?? ((Math.random() * 2 ** 32) >>> 0);
    this.modeId = opts.mode ?? this.modeId;
    this.match = new Match(this, { modeId: this.modeId, seed });
    this.screen = 'match';
    this.paused = false;
    this.picker = null;
    this.simReported = false;
  }

  toTitle() {
    this.screen = 'title';
    this.match = null;
  }

  update(dt) {
    const inp = this.input;
    if (inp.wasPressed('F3')) this.showDebug = !this.showDebug;
    this.titleT += dt;
    if (this.screen === 'title') return this._updateTitle();
    if (this.screen === 'modes') return this._updateModes();
    if (this.screen === 'match') {
      const m = this.match;
      if (this.picker) { this._updatePicker(); return; }
      if (inp.wasPressed('Escape') && !m.result) this.paused = !this.paused;
      if (this.paused || m.result) {
        if (inp.wasPressed('KeyR')) { this.startMatch({ seed: m.seed }); return; }
        if (inp.wasPressed('KeyT')) { this.toTitle(); return; }
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

  /** Up/down (W/S, arrows) or left/right; returns the new selection. */
  _menuNav(n, sel, horizontal = false) {
    const inp = this.input;
    const prev = horizontal ? ['ArrowLeft', 'KeyA'] : ['ArrowUp', 'KeyW'];
    const next = horizontal ? ['ArrowRight', 'KeyD'] : ['ArrowDown', 'KeyS'];
    if (prev.some((k) => inp.wasPressed(k))) sel = (sel + n - 1) % n;
    if (next.some((k) => inp.wasPressed(k))) sel = (sel + 1) % n;
    return sel;
  }

  _updateTitle() {
    const inp = this.input;
    const items = this.menu;
    this.menuSel = this._menuNav(items.length, this.menuSel);
    const hit = menuHit(items.length, inp.mouse);
    if (hit >= 0 && inp.btnPressed[0]) { this.menuSel = hit; items[hit].act(); return; }
    if (inp.wasPressed('Enter') || inp.wasPressed('Space')) items[this.menuSel].act();
  }

  _updateModes() {
    const inp = this.input;
    this.modeSel = this._menuNav(MODES.length, this.modeSel, true);
    if (inp.wasPressed('Escape')) { this.screen = 'title'; return; }
    for (let i = 0; i < MODES.length; i++) if (inp.wasPressed(`Digit${i + 1}`)) { this.modeSel = i; this._pickMode(); return; }
    if (inp.btnPressed[0]) {
      const cards = modeCards(MODES.length);
      const { x, y } = inp.mouse;
      cards.forEach((c, i) => { if (x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) { this.modeSel = i; this._pickMode(); } });
      return;
    }
    if (inp.wasPressed('Enter') || inp.wasPressed('Space')) this._pickMode();
  }

  _pickMode() {
    this.modeId = MODES[this.modeSel].id;
    this.startMatch();
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
    else if (this.screen === 'modes') drawModeSelect(ctx, this, MODES, this.modeSel);
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
    ctx.fillStyle = '#29366f';
    ctx.fillRect(0, 150, INTERNAL_W, 2);
    ctx.fillStyle = '#333c57';
    ctx.fillRect(0, 152, INTERNAL_W, 118);

    drawText(ctx, 'OWE BLOCK', INTERNAL_W / 2, 26, { color: UI.gold, shadow: '#b13e53', scale: 5, align: 'center' });
    drawText(ctx, 'BRAWL', INTERNAL_W / 2, 70, { color: UI.ink, shadow: '#b13e53', scale: 3, align: 'center' });

    const n = this.titleCast.length;
    for (let i = 0; i < n; i++) {
      const spr = this.sprites.get(this.titleCast[i]).normal;
      const x = INTERNAL_W / 2 + (i - (n - 1) / 2) * 40;
      const bob = Math.round(Math.abs(Math.sin(this.titleT * 3 + i)) * -3);
      ctx.drawImage(spr, Math.round(x - 16), 118 + bob, 32, 32);
    }
    drawMenu(ctx, this.menu, this.menuSel, this.input.mouse, this.titleT);
  }
}
