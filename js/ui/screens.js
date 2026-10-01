// Canvas-drawn screens and overlays: level-up picker, death/win result, pause.

import { drawText, wrap } from './font.js';
import { drawItemIcon } from './icons.js';
import { UI } from './hud.js';
import { INTERNAL_W, INTERNAL_H } from '../config.js';
import { getDef } from '../data/registry.js';

const CARD_W = 136;
const CARD_H = 112;
const CARD_GAP = 12;

/** Card rectangles for n offers, centered. */
export function pickerCards(n) {
  const total = n * CARD_W + (n - 1) * CARD_GAP;
  const x0 = Math.round(INTERNAL_W / 2 - total / 2);
  const y0 = 92;
  const out = [];
  for (let i = 0; i < n; i++) out.push({ x: x0 + i * (CARD_W + CARD_GAP), y: y0, w: CARD_W, h: CARD_H });
  return out;
}

const SUB_COLOR = { new: '#38b764', upgrade: '#ffcd75', stat: '#41a6f6' };

export function drawPicker(ctx, picker, match, mouse) {
  const assets = match.game.assets;
  ctx.fillStyle = 'rgba(10, 8, 16, 0.72)';
  ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
  drawText(ctx, 'LEVEL UP!', INTERNAL_W / 2, 40, { color: UI.gold, shadow: '#b13e53', scale: 3, align: 'center' });
  drawText(ctx, `LEVEL ${match.player.level - match.player.pendingLevelUps + 1}   CHOOSE ONE: 1 2 3 OR CLICK`, INTERNAL_W / 2, 72, { color: UI.ink, shadow: UI.shadow, align: 'center' });
  const cards = pickerCards(picker.offers.length);
  picker.hover = -1;
  cards.forEach((c, i) => {
    const o = picker.offers[i];
    const hot = mouse.x >= c.x && mouse.x < c.x + c.w && mouse.y >= c.y && mouse.y < c.y + c.h;
    if (hot) picker.hover = i;
    ctx.fillStyle = hot ? UI.gold : '#000000';
    ctx.fillRect(c.x - 2, c.y - 2, c.w + 4, c.h + 4);
    ctx.fillStyle = '#262b44';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    drawText(ctx, `[${i + 1}]`, c.x + 4, c.y + 4, { color: UI.dim });
    const def = o.id ? getDef(o.id) : null;
    if (def) drawItemIcon(ctx, assets, def, c.x + c.w / 2 - 16, c.y + 12, 32);
    else {
      ctx.fillStyle = '#41a6f6';
      ctx.fillRect(c.x + c.w / 2 - 12, c.y + 16, 24, 24);
      drawText(ctx, '+', c.x + c.w / 2, c.y + 22, { color: '#ffffff', scale: 2, align: 'center' });
    }
    drawText(ctx, o.sub, c.x + c.w / 2, c.y + 50, { color: SUB_COLOR[o.type], align: 'center' });
    const titleLines = wrap(o.title, c.w - 8);
    titleLines.forEach((l, k) => drawText(ctx, l, c.x + c.w / 2, c.y + 61 + k * 9, { color: UI.ink, shadow: UI.shadow, align: 'center' }));
    wrap(o.effect, c.w - 10).slice(0, 4).forEach((l, k) => {
      drawText(ctx, l, c.x + c.w / 2, c.y + 64 + titleLines.length * 9 + k * 9, { color: UI.dim, align: 'center' });
    });
  });
}

export function drawResult(ctx, match) {
  const r = match.result;
  const p = match.player;
  ctx.fillStyle = 'rgba(10, 8, 16, 0.55)';
  ctx.fillRect(0, 70, INTERNAL_W, 120);
  if (r.win) {
    drawText(ctx, 'LAST ONE STANDING', INTERNAL_W / 2, 84, { color: UI.gold, shadow: '#b13e53', scale: 3, align: 'center' });
  } else {
    drawText(ctx, 'YOU DIED', INTERNAL_W / 2, 84, { color: UI.red, shadow: '#000000', scale: 3, align: 'center' });
  }
  drawText(ctx, `#${r.placement} OF ${r.of}`, INTERNAL_W / 2, 116, { color: UI.ink, shadow: UI.shadow, scale: 2, align: 'center' });
  if (!r.win) {
    const by = r.killedBy ? `KILLED BY ${r.killedBy}${r.with ? ' (' + r.with + ')' : ''}` : 'YOU FELL';
    drawText(ctx, by, INTERNAL_W / 2, 140, { color: UI.dim, shadow: UI.shadow, align: 'center' });
  }
  drawText(ctx, `KILLS ${p.kills}   DAMAGE ${Math.round(p.damageDealt)}   LEVEL ${p.level}`, INTERNAL_W / 2, 152, { color: UI.ink, shadow: UI.shadow, align: 'center' });
  drawText(ctx, 'R RESTART   T TITLE', INTERNAL_W / 2, 172, { color: UI.gold, shadow: UI.shadow, align: 'center' });
}

export function drawPause(ctx) {
  ctx.fillStyle = 'rgba(10, 8, 16, 0.6)';
  ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
  drawText(ctx, 'PAUSED', INTERNAL_W / 2, 100, { color: UI.gold, shadow: UI.shadow, scale: 3, align: 'center' });
  drawText(ctx, 'ESC RESUME   R RESTART   T TITLE', INTERNAL_W / 2, 140, { color: UI.ink, shadow: UI.shadow, align: 'center' });
}

// ------------------------------------------------------------------ title menu

const MENU_Y = 172;
const MENU_STEP = 16;
const MENU_W = 200;

export function menuHit(n, mouse) {
  for (let i = 0; i < n; i++) {
    const y = MENU_Y + i * MENU_STEP;
    if (mouse.x >= INTERNAL_W / 2 - MENU_W / 2 && mouse.x < INTERNAL_W / 2 + MENU_W / 2 && mouse.y >= y - 3 && mouse.y < y + 11) return i;
  }
  return -1;
}

export function drawMenu(ctx, items, sel, mouse, t) {
  const hover = menuHit(items.length, mouse);
  items.forEach((it, i) => {
    const y = MENU_Y + i * MENU_STEP;
    const on = i === sel || i === hover;
    if (on) {
      ctx.fillStyle = 'rgba(255, 205, 117, 0.15)';
      ctx.fillRect(INTERNAL_W / 2 - MENU_W / 2, y - 3, MENU_W, 13);
      const blink = Math.floor(t * 3) % 2 === 0;
      drawText(ctx, '>', INTERNAL_W / 2 - MENU_W / 2 + 6, y, { color: blink ? UI.gold : UI.ink });
    }
    drawText(ctx, it.label, INTERNAL_W / 2, y, { color: on ? UI.gold : UI.ink, shadow: UI.shadow, align: 'center' });
  });
  drawText(ctx, 'ARROWS/W S + ENTER, OR CLICK', INTERNAL_W / 2, INTERNAL_H - 12, { color: UI.dim, align: 'center' });
}

// ------------------------------------------------------------------ mode select

const MODE_W = 140;
const MODE_H = 150;
const MODE_GAP = 12;

export function modeCards(n) {
  const total = n * MODE_W + (n - 1) * MODE_GAP;
  const x0 = Math.round(INTERNAL_W / 2 - total / 2);
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * (MODE_W + MODE_GAP), y: 60, w: MODE_W, h: MODE_H }));
}

export function drawModeSelect(ctx, game, modes, sel) {
  const assets = game.assets;
  ctx.fillStyle = '#1a1c2c';
  ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
  drawText(ctx, 'MODE SELECT', INTERNAL_W / 2, 20, { color: UI.gold, shadow: '#b13e53', scale: 2, align: 'center' });
  const cards = modeCards(modes.length);
  const mouse = game.input.mouse;
  modes.forEach((m, i) => {
    const c = cards[i];
    const hot = i === sel || (mouse.x >= c.x && mouse.x < c.x + c.w && mouse.y >= c.y && mouse.y < c.y + c.h);
    ctx.fillStyle = hot ? UI.gold : '#000000';
    ctx.fillRect(c.x - 2, c.y - 2, c.w + 4, c.h + 4);
    ctx.fillStyle = '#262b44';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    // A little tile swatch from the mode's tileset: floor, wall, wall top.
    const ts = assets.tileset(m.tileset);
    const sheet = ts?.sheet;
    const sw = c.x + c.w / 2 - 36;
    const roles = ['wallTop', 'wallTop', 'wallTop', 'wall', 'wall', 'wall', 'floor', 'floor', 'floor'];
    roles.forEach((r, k) => {
      const frame = assets.pickRole(m.tileset, r === 'floor' && ts?.roles?.roofRed ? 'roofRed' : r, k);
      assets.draw(ctx, sheet, frame, sw + (k % 3) * 24, c.y + 10 + Math.floor(k / 3) * 16, assets.roleColor(m.tileset, r), 24, 16);
    });
    drawText(ctx, `[${i + 1}]`, c.x + 4, c.y + 4, { color: UI.dim });
    drawText(ctx, m.name, c.x + c.w / 2, c.y + 70, { color: UI.ink, shadow: UI.shadow, scale: 2, align: 'center' });
    wrap(m.place, c.w - 10).forEach((l, k) => drawText(ctx, l, c.x + c.w / 2, c.y + 92 + k * 9, { color: UI.gold, align: 'center' }));
    wrap(m.hint || '', c.w - 12).forEach((l, k) => drawText(ctx, l, c.x + c.w / 2, c.y + 114 + k * 9, { color: UI.dim, align: 'center' }));
  });
  drawText(ctx, 'LEFT/RIGHT + ENTER, 1-3, OR CLICK   ESC BACK', INTERNAL_W / 2, INTERNAL_H - 14, { color: UI.dim, align: 'center' });
}
