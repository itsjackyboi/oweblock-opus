// Screen state machine. Stage 1 screens: title -> match, with pause.

import { INTERNAL_W, INTERNAL_H, URLP } from '../config.js';
import { Match } from './match.js';
import { RNG } from '../core/rng.js';
import { drawText } from '../ui/font.js';
import { UI } from '../ui/hud.js';
import { drawDebug } from '../ui/debug.js';
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
      if (inp.wasPressed('Escape')) this.paused = !this.paused;
      if (this.paused) {
        if (inp.wasPressed('KeyR')) this.startMatch({ seed: this.match.seed });
        if (inp.wasPressed('KeyT')) { this.screen = 'title'; this.match = null; }
        return;
      }
      this.match.update(dt);
    }
  }

  render() {
    const ctx = this.renderer.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.screen === 'title') this._renderTitle(ctx);
    else if (this.screen === 'match') {
      this.match.render(ctx);
      if (this.paused) this._renderPause(ctx);
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
    drawText(ctx, 'STAGE 1 BUILD: ENGINE SKELETON', INTERNAL_W / 2, 250, { color: UI.dim, align: 'center' });
  }

  _renderPause(ctx) {
    ctx.fillStyle = 'rgba(10, 8, 16, 0.6)';
    ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
    drawText(ctx, 'PAUSED', INTERNAL_W / 2, 100, { color: UI.gold, shadow: UI.shadow, scale: 3, align: 'center' });
    drawText(ctx, 'ESC RESUME   R RESTART   T TITLE', INTERNAL_W / 2, 140, { color: UI.ink, shadow: UI.shadow, align: 'center' });
  }
}
