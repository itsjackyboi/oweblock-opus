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
