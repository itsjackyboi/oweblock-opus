// In-match HUD, drawn on the canvas with the bitmap font.
// Top-left: level, HP, XP, dash. Top-right: alive, kills, kill feed.
// Bottom-center: the item slots with level pips and cooldown sweeps, plus prompts.
// (Zone timer and minimap arrive in Stage 3.)

import { drawText } from './font.js';
import { drawItemIcon } from './icons.js';
import { INTERNAL_W, INTERNAL_H, FIGHTER, ITEMS } from '../config.js';
import { xpNeeded } from '../game/levelup.js';
import { cooldownFracs, heldItem } from '../game/items.js';
import { has } from '../game/statuses.js';

export const UI = {
  ink: '#f4f4f4',
  shadow: '#000000',
  dim: '#8b93af',
  panel: 'rgba(16, 14, 24, 0.72)',
  hp: '#38b764',
  hpLow: '#e43b44',
  hpBack: '#3a1d2a',
  xp: '#a7f070',
  dash: '#73eff7',
  gold: '#ffcd75',
  red: '#e43b44',
  blue: '#41a6f6',
};

export function bar(ctx, x, y, w, h, frac, fg, bg) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fg;
  ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, frac))), h);
}

const SLOT = 24;
const GAP = 4;

export function drawHud(ctx, match) {
  const p = match.player;
  const assets = match.game.assets;

  // ---- top-left: level, HP, XP, dash
  ctx.fillStyle = UI.panel;
  ctx.fillRect(4, 4, 112, 36);
  drawText(ctx, `LV ${p.level}`, 8, 7, { color: UI.gold, shadow: UI.shadow });
  drawText(ctx, `${Math.ceil(p.hp)}/${Math.round(p.maxHp)}`, 112, 7, { color: UI.ink, shadow: UI.shadow, align: 'right' });
  const hpf = p.hp / p.maxHp;
  bar(ctx, 8, 17, 104, 5, hpf, hpf < 0.3 ? UI.hpLow : UI.hp, UI.hpBack);
  bar(ctx, 8, 26, 104, 3, p.xp / xpNeeded(p.level), UI.xp, '#1b2a1d');
  const dashFrac = 1 - p.dashCd / (FIGHTER.dashCooldown * p.stats.dashCdMul);
  bar(ctx, 8, 33, 104, 2, dashFrac, dashFrac >= 1 ? UI.dash : UI.dim, '#1b1b2a');

  // ---- top-right: alive, kills
  drawText(ctx, `ALIVE ${match.aliveCount}`, INTERNAL_W - 6, 6, { color: UI.ink, shadow: UI.shadow, align: 'right' });
  drawText(ctx, `KILLS ${p.kills}`, INTERNAL_W - 6, 16, { color: UI.gold, shadow: UI.shadow, align: 'right' });

  // ---- kill feed
  const feed = match.killFeed;
  for (let i = 0; i < feed.length; i++) {
    const e = feed[i];
    ctx.globalAlpha = Math.min(1, (6 - e.t) / 1);
    const txt = e.killer ? `${e.killer} > ${e.victim}` : `${e.victim} FELL`;
    drawText(ctx, txt, INTERNAL_W - 6, 30 + i * 9, { color: e.player ? UI.gold : UI.dim, shadow: UI.shadow, align: 'right' });
  }
  ctx.globalAlpha = 1;

  // ---- mode name
  drawText(ctx, match.mode.name, INTERNAL_W / 2, 6, { color: UI.gold, shadow: UI.shadow, align: 'center' });

  // ---- slots (bottom-center)
  const n = p.slots.length;
  const total = n * SLOT + (n - 1) * GAP;
  const x0 = Math.round(INTERNAL_W / 2 - total / 2);
  const y0 = INTERNAL_H - SLOT - 8;
  const silenced = has(p, 'silence');
  for (let i = 0; i < n; i++) {
    const x = x0 + i * (SLOT + GAP);
    const item = p.slots[i];
    const held = i === p.held;
    ctx.fillStyle = held ? UI.gold : '#000000';
    ctx.fillRect(x - 1, y0 - 1, SLOT + 2, SLOT + 2);
    ctx.fillStyle = UI.panel;
    ctx.fillRect(x, y0, SLOT, SLOT);
    if (item) {
      drawItemIcon(ctx, assets, item.def, x + 4, y0 + 2, 16);
      const [cp, cs] = cooldownFracs(item);
      if (cp > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        const h = Math.ceil(SLOT * cp);
        ctx.fillRect(x, y0 + SLOT - h, SLOT, h);
      }
      for (let l = 0; l < ITEMS.maxLevel; l++) {
        ctx.fillStyle = l < item.level ? UI.gold : '#3a3448';
        ctx.fillRect(x + 3 + l * 4, y0 + SLOT - 4, 3, 2);
      }
      bar(ctx, x, y0 + SLOT + 3, SLOT, 1, 1 - cs, cs > 0 ? UI.dim : UI.dash, '#1b1b2a');
    } else {
      ctx.globalAlpha = 0.35;
      drawItemIcon(ctx, assets, p.fists.def, x + 4, y0 + 4, 16);
      ctx.globalAlpha = 1;
    }
    drawText(ctx, String(i + 1), x + 1, y0 + 1, { color: held ? UI.gold : UI.dim });
  }
  const h = heldItem(p);
  const label = silenced ? 'SILENCED' : `${h.def.name}${p.slots[p.held] ? ' L' + h.level : ''}`;
  drawText(ctx, label, INTERNAL_W / 2, y0 - 10, { color: silenced ? UI.blue : UI.ink, shadow: UI.shadow, align: 'center' });

  // ---- prompt
  if (match.prompt) {
    drawText(ctx, match.prompt.text, INTERNAL_W / 2, y0 - 22, { color: UI.gold, shadow: UI.shadow, align: 'center' });
  }

  // ---- controls hint for the first seconds
  if (match.time < 10 && !match.result) {
    ctx.globalAlpha = Math.min(1, (10 - match.time) / 2);
    drawText(ctx, 'WASD MOVE  SPACE DASH  CLICK USE  Q SPECIAL', INTERNAL_W / 2, 60, { color: UI.ink, shadow: UI.shadow, align: 'center' });
    drawText(ctx, 'RMB AIM  1-3/WHEEL SWAP  E SWAP ITEM  ESC PAUSE', INTERNAL_W / 2, 70, { color: UI.ink, shadow: UI.shadow, align: 'center' });
    ctx.globalAlpha = 1;
  }
}
