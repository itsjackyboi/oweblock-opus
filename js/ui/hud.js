// In-match HUD, drawn on the canvas with the bitmap font.
// Stage 1: health, dash cooldown, mode name and a controls hint.

import { drawText } from './font.js';
import { INTERNAL_W, INTERNAL_H, FIGHTER } from '../config.js';

export const UI = {
  ink: '#f4f4f4',
  shadow: '#000000',
  dim: '#8b93af',
  panel: 'rgba(16, 14, 24, 0.72)',
  hp: '#38b764',
  hpLow: '#e43b44',
  hpBack: '#3a1d2a',
  dash: '#73eff7',
  gold: '#ffcd75',
};

export function bar(ctx, x, y, w, h, frac, fg, bg) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fg;
  ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, frac))), h);
}

export function drawHud(ctx, match) {
  const p = match.player;

  // Health (top-left).
  ctx.fillStyle = UI.panel;
  ctx.fillRect(4, 4, 92, 24);
  drawText(ctx, `HP ${Math.ceil(p.hp)}`, 8, 7, { color: UI.ink, shadow: UI.shadow });
  bar(ctx, 8, 16, 84, 4, p.hp / p.maxHp, p.hp / p.maxHp < 0.3 ? UI.hpLow : UI.hp, UI.hpBack);
  const dashFrac = 1 - p.dashCd / (FIGHTER.dashCooldown * p.stats.dashCdMul);
  bar(ctx, 8, 23, 84, 2, dashFrac, dashFrac >= 1 ? UI.dash : UI.dim, '#1b1b2a');

  // Mode (top-center).
  drawText(ctx, match.mode.name, INTERNAL_W / 2, 6, { color: UI.gold, shadow: UI.shadow, align: 'center' });

  // Controls hint for the first seconds.
  if (match.time < 10) {
    ctx.globalAlpha = Math.min(1, (10 - match.time) / 2);
    drawText(ctx, 'WASD MOVE   SPACE DASH   ESC PAUSE   F3 DEBUG', INTERNAL_W / 2, INTERNAL_H - 12,
      { color: UI.ink, shadow: UI.shadow, align: 'center' });
    ctx.globalAlpha = 1;
  }
}
