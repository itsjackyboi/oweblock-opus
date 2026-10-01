// Screen state machine:
//   title (menu) -> modes | stats | options
//   match (pause, level-up picker, death/win result) -> induct (after a win) -> summary -> title

import { INTERNAL_W, INTERNAL_H, URLP } from '../config.js';
import { Match } from './match.js';
import { RNG } from '../core/rng.js';
import { Save } from '../core/save.js';
import { Audio } from '../core/audio.js';
import { drawText } from '../ui/font.js';
import { UI } from '../ui/hud.js';
import { drawDebug } from '../ui/debug.js';
import {
  drawPicker, drawResult, drawPause, pickerCards, drawMenu, menuHit, drawModeSelect, modeCards,
  drawInduct, inductCards, drawSummary, drawStats, drawOptions, optionsHit,
} from '../ui/screens.js';
import { generateOffers, applyOffer } from './levelup.js';
import { MODES, DEFAULT_MODE, getMode } from '../data/modes.js';
import { GANGS } from '../data/gangs.js';

export class Game {
  constructor({ renderer, input, assets, sprites, loop }) {
    this.renderer = renderer;
    this.input = input;
    this.assets = assets;
    this.sprites = sprites;
    this.loop = loop;
    this.save = new Save();
    this.audio = new Audio(this.save.settings);
    this.renderer.camera.shakeEnabled = this.save.settings.shake;
    this.screen = 'title';
    this.match = null;
    this.paused = false;
    this.showDebug = URLP.debug;
    this.titleT = 0;
    this.modeId = getMode(URLP.mode || DEFAULT_MODE).id;
    this.menuSel = 0;
    this.optSel = 0;
    this.inductSel = 0;
    this.modeSel = Math.max(0, MODES.findIndex((m) => m.id === this.modeId));
    this.summary = null;
    this._buildTitleCast();
  }

  _buildTitleCast() {
    const rng = new RNG(7);
    const palettes = ['red', 'red', 'red', this.save.data.color, 'blue', 'blue', 'blue'];
    this.titleCast = palettes.map((p) => this.sprites.randomAppearance(rng, p));
    this.titleCast.push(this.sprites.randomAppearance(rng, 'police'));
  }

  /** Title menu entries (label + action). */
  get menu() {
    return [
      { label: `START: ${getMode(this.modeId).name}`, act: () => this.startMatch() },
      { label: 'MODE SELECT', act: () => { this.screen = 'modes'; } },
      { label: 'UNLOCKS / STATS', act: () => { this.screen = 'stats'; } },
      { label: 'OPTIONS', act: () => { this.screen = 'options'; this.optSel = 0; } },
    ];
  }

  /** Options rows: label, value text, and how left/right/enter change it. */
  get options() {
    const s = this.save.settings;
    const vol = (k) => ({
      label: k.toUpperCase() + ' VOLUME', value: `${Math.round(s[k] * 100)}%`,
      adjust: (d) => { this.save.setSetting(k, Math.max(0, Math.min(1, Math.round((s[k] + d * 0.1) * 10) / 10))); this.audio.applyVolumes(); this.audio.play('uiMove'); },
    });
    return [
      { label: 'SCREEN SHAKE', value: s.shake ? 'ON' : 'OFF', adjust: () => { this.save.setSetting('shake', !s.shake); this.renderer.camera.shakeEnabled = s.shake; } },
      vol('master'),
      vol('music'),
      vol('sfx'),
      { label: 'BACK', value: '', press: () => { this.screen = 'title'; } },
    ];
  }

  /** The player's loadout from the save: gang color and (unlocked) start weapon. */
  _loadout() {
    const d = this.save.data;
    const gang = GANGS.find((g) => g.weapon === d.startWeapon);
    const startItem = gang && d.unlocked[gang.unlockKey] ? d.startWeapon : null;
    const okColor = d.color === 'grey' || GANGS.some((g) => g.color === d.color && d.unlocked[g.unlockKey]);
    return { startItem, palette: okColor ? d.color : 'grey' };
  }

  startMatch(opts = {}) {
    const seed = opts.seed ?? URLP.seed ?? ((Math.random() * 2 ** 32) >>> 0);
    this.modeId = opts.mode ?? this.modeId;
    const lo = URLP.sim ? { startItem: null, palette: 'grey' } : this._loadout();
    this.match = new Match(this, { modeId: this.modeId, seed, ...lo });
    this.screen = 'match';
    this.paused = false;
    this.picker = null;
    this.simReported = false;
    this.recorded = false;
    this._wireSfx(this.match);
    this.audio.playMusic(this.match.mode.music);
  }

  /** Map match events to sounds. */
  _wireSfx(m) {
    if (m.sim) return;
    const ev = m.events;
    ev.on('dash', ({ fighter }) => m.sfx('dash', fighter.x, fighter.y));
    ev.on('pickup', ({ fighter }) => m.sfx('pickup', fighter.x, fighter.y));
    ev.on('upgrade', ({ fighter }) => m.sfx('upgrade', fighter.x, fighter.y));
    ev.on('levelUp', ({ fighter }) => { if (fighter.isPlayer) this.audio.play('levelUp'); });
    ev.on('zoneShrink', () => this.audio.play('siren'));
    ev.on('fall', ({ fighter }) => m.sfx('fall', fighter.x, fighter.y));
    ev.on('explosion', ({ x, y }) => m.sfx('explode', x, y));
  }

  toTitle() {
    this.screen = 'title';
    this.match = null;
    this._buildTitleCast();
    this.audio.playMusic('title');
  }

  update(dt) {
    const inp = this.input;
    if (inp.anyPressed) {
      this.audio.unlock();
      if (!this.audio.track && this.screen !== 'match') this.audio.playMusic('title');
    }
    if (inp.wasPressed('F3')) this.showDebug = !this.showDebug;
    this.titleT += dt;
    switch (this.screen) {
      case 'title': return this._updateTitle();
      case 'modes': return this._updateModes();
      case 'stats': return this._updateStats();
      case 'options': return this._updateOptions();
      case 'induct': return this._updateInduct();
      case 'summary': return this._updateSummary();
      case 'match': return this._updateMatch(dt);
    }
  }

  _updateMatch(dt) {
    const inp = this.input;
    const m = this.match;
    if (this.picker) { this._updatePicker(); return; }
    if (inp.wasPressed('Escape') && !m.result) this.paused = !this.paused;
    if (this.paused || m.result) {
      if (inp.wasPressed('KeyR')) { this.startMatch({ seed: URLP.seed ?? undefined }); return; }
      if (inp.wasPressed('KeyT')) { this.toTitle(); return; }
    }
    if (m.result && !m.sim && (inp.wasPressed('Enter') || inp.wasPressed('Space') || inp.btnPressed[0])) {
      this.audio.play('uiSelect');
      if (m.result.win) { this.screen = 'induct'; this.inductSel = 0; } else this.screen = 'summary';
      return;
    }
    if (this.paused) return;
    m.update(dt);
    const p = m.player;
    if (m.simResult && !this.simReported) {
      this.simReported = true;
      this.onSimEnd?.(m.simResult);
    }
    if (m.result && !this.recorded && !m.sim) {
      this.recorded = true;
      const newBest = this.save.recordMatch(m.result);
      this.summary = { ...m.result, newBest };
      this.audio.play(m.result.win ? 'win' : 'death');
    }
    if (p.alive && p.pendingLevelUps > 0 && !m.result && !p.controller.isAI) {
      this.picker = { offers: generateOffers(m, p, m.offerRng), hover: -1 };
      if (!this.picker.offers.length) { p.pendingLevelUps = 0; this.picker = null; }
    }
  }

  /** Up/down (W/S, arrows) or left/right; returns the new selection. */
  _menuNav(n, sel, horizontal = false) {
    const inp = this.input;
    const prev = horizontal ? ['ArrowLeft', 'KeyA'] : ['ArrowUp', 'KeyW'];
    const next = horizontal ? ['ArrowRight', 'KeyD'] : ['ArrowDown', 'KeyS'];
    const was = sel;
    if (prev.some((k) => inp.wasPressed(k))) sel = (sel + n - 1) % n;
    if (next.some((k) => inp.wasPressed(k))) sel = (sel + 1) % n;
    if (sel !== was) this.audio.play('uiMove');
    return sel;
  }

  _confirm() {
    const inp = this.input;
    return inp.wasPressed('Enter') || inp.wasPressed('Space');
  }

  _updateTitle() {
    const inp = this.input;
    const items = this.menu;
    this.menuSel = this._menuNav(items.length, this.menuSel);
    const hit = menuHit(items.length, inp.mouse);
    if (hit >= 0 && inp.btnPressed[0]) { this.menuSel = hit; this.audio.play('uiSelect'); items[hit].act(); return; }
    if (this._confirm()) { this.audio.play('uiSelect'); items[this.menuSel].act(); }
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
    if (this._confirm()) this._pickMode();
  }

  _pickMode() {
    this.audio.play('uiSelect');
    this.modeId = MODES[this.modeSel].id;
    this.startMatch();
  }

  /** Stats: [1] cycle outfit color, [2] cycle start weapon (only unlocked ones). */
  _updateStats() {
    const inp = this.input;
    const d = this.save.data;
    if (inp.wasPressed('Digit1')) {
      const colors = ['grey', ...GANGS.filter((g) => d.unlocked[g.unlockKey]).map((g) => g.color)];
      d.color = colors[(colors.indexOf(d.color) + 1) % colors.length];
      this.save.write();
      this._buildTitleCast();
      this.audio.play('uiMove');
    }
    if (inp.wasPressed('Digit2')) {
      const weapons = [null, ...GANGS.filter((g) => d.unlocked[g.unlockKey]).map((g) => g.weapon)];
      d.startWeapon = weapons[(weapons.indexOf(d.startWeapon) + 1) % weapons.length];
      this.save.write();
      this.audio.play('uiMove');
    }
    if (inp.wasPressed('Escape') || this._confirm() || inp.btnPressed[0]) { this.audio.play('uiSelect'); this.screen = 'title'; }
  }

  _updateOptions() {
    const inp = this.input;
    const rows = this.options;
    this.optSel = this._menuNav(rows.length, this.optSel);
    const hit = optionsHit(rows.length, inp.mouse);
    if (hit >= 0 && inp.btnPressed[0]) this.optSel = hit;
    const row = rows[this.optSel];
    if (['ArrowLeft', 'KeyA'].some((k) => inp.wasPressed(k))) row.adjust?.(-1);
    if (['ArrowRight', 'KeyD'].some((k) => inp.wasPressed(k))) row.adjust?.(1);
    if (this._confirm() || (hit >= 0 && inp.btnPressed[0])) {
      this.audio.play('uiSelect');
      if (row.press) row.press();
      else row.adjust?.(1);
    }
    if (inp.wasPressed('Escape')) this.screen = 'title';
  }

  /** After a win: join a gang (unlocks its weapon and color). */
  _updateInduct() {
    const inp = this.input;
    this.inductSel = this._menuNav(GANGS.length, this.inductSel, true);
    let pick = -1;
    for (let i = 0; i < GANGS.length; i++) if (inp.wasPressed(`Digit${i + 1}`)) pick = i;
    if (inp.btnPressed[0]) {
      const { x, y } = inp.mouse;
      inductCards().forEach((c, i) => { if (x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) pick = i; });
    }
    if (this._confirm()) pick = this.inductSel;
    if (pick < 0) return;
    const gang = GANGS[pick];
    this.save.induct(gang);
    if (this.summary) this.summary.joined = gang;
    this.audio.play('upgrade');
    this.screen = 'summary';
  }

  _updateSummary() {
    if (this._confirm() || this.input.btnPressed[0] || this.input.wasPressed('Escape')) {
      this.audio.play('uiSelect');
      this.toTitle();
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
    this.audio.play('uiSelect');
    this.picker = null;
    if (m.player.controller) m.player.controller.blockUse = true;
    if (m.player.pendingLevelUps > 0) this.picker = { offers: generateOffers(m, m.player, m.offerRng), hover: -1 };
  }

  render() {
    const ctx = this.renderer.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    switch (this.screen) {
      case 'title': this._renderTitle(ctx); break;
      case 'modes': drawModeSelect(ctx, this, MODES, this.modeSel); break;
      case 'stats': drawStats(ctx, this); break;
      case 'options': drawOptions(ctx, this.options, this.optSel, this.input.mouse); break;
      case 'induct': drawInduct(ctx, this, this.inductSel); break;
      case 'summary': drawSummary(ctx, this, this.summary); break;
      case 'match':
        this.match.render(ctx);
        if (this.picker) drawPicker(ctx, this.picker, this.match, this.input.mouse);
        else if (this.match.result) drawResult(ctx, this.match);
        else if (this.paused) drawPause(ctx);
        break;
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
