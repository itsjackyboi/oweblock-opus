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
    const txt = e.text || (e.killer ? `${e.killer} > ${e.victim}` : e.swept ? `${e.victim} SWEPT` : `${e.victim} FELL`);
    drawText(ctx, txt, INTERNAL_W - 6, 30 + i * 9, { color: e.player ? UI.gold : UI.dim, shadow: UI.shadow, align: 'right' });
  }
  ctx.globalAlpha = 1;

  // ---- zone timer (top-center)
  const z = match.zone;
  if (z) {
    const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    let label;
    let col = UI.ink;
    if (z.state === 'wait' && !z.done) label = `SWEEP IN ${mmss(Math.max(0, z.t))}`;
    else if (z.state === 'shrink') { label = `SWEEPING ${mmss(Math.max(0, z.t))}`; col = UI.red; }
    else { label = 'FINAL SWEEP'; col = UI.red; }
    drawText(ctx, label, INTERNAL_W / 2, 6, { color: col, shadow: UI.shadow, align: 'center' });
    drawText(ctx, "GOBBLER'S POLICE", INTERNAL_W / 2, 16, { color: UI.dim, shadow: UI.shadow, align: 'center' });
    if (p.alive && !z.inside(p.x, p.y)) {
      const blink = Math.floor(match.time * 4) % 2 === 0;
      drawText(ctx, 'OUTSIDE THE SWEEP!', INTERNAL_W / 2, 30, { color: blink ? UI.red : UI.gold, shadow: UI.shadow, align: 'center' });
    }
  } else {
    drawText(ctx, match.mode.name, INTERNAL_W / 2, 6, { color: UI.gold, shadow: UI.shadow, align: 'center' });
  }

  // ---- minimap (bottom-right)
  if (match.minimap) drawMinimap(ctx, match);

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

const MM = 64;

/** Pre-rendered 64x64 silhouette of the map (floor light, walls dark). */
export function buildMinimap(map) {
  const c = document.createElement('canvas');
  c.width = MM;
  c.height = MM;
  const g = c.getContext('2d');
  const img = g.createImageData(MM, MM);
  for (let y = 0; y < MM; y++) {
    for (let x = 0; x < MM; x++) {
      const tx = Math.floor((x / MM) * map.w);
      const ty = Math.floor((y / MM) * map.h);
      const t = map.get(tx, ty);
      const i = (y * MM + x) * 4;
      const floor = t !== 1;
      img.data[i] = floor ? 150 : 34;
      img.data[i + 1] = floor ? 130 : 28;
      img.data[i + 2] = floor ? 110 : 40;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Minimap: silhouette, current and next zone, the player dot. No enemies. */
function drawMinimap(ctx, match) {
  const x0 = INTERNAL_W - MM - 6;
  const y0 = INTERNAL_H - MM - 6;
  const sx = MM / match.map.pw;
  const sy = MM / match.map.ph;
  ctx.fillStyle = '#000000';
  ctx.fillRect(x0 - 1, y0 - 1, MM + 2, MM + 2);
  ctx.globalAlpha = 0.85;
  ctx.drawImage(match.minimap, x0, y0);
  ctx.globalAlpha = 1;
  const z = match.zone;
  if (z) {
    const c = z.cur;
    const rx0 = x0 + Math.round(c.x0 * sx);
    const ry0 = y0 + Math.round(c.y0 * sy);
    const rx1 = x0 + Math.round(c.x1 * sx);
    const ry1 = y0 + Math.round(c.y1 * sy);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#0b0a1a';
    ctx.fillRect(x0, y0, MM, Math.max(0, ry0 - y0));
    ctx.fillRect(x0, ry1, MM, Math.max(0, y0 + MM - ry1));
    ctx.fillRect(x0, ry0, Math.max(0, rx0 - x0), ry1 - ry0);
    ctx.fillRect(rx1, ry0, Math.max(0, x0 + MM - rx1), ry1 - ry0);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#e43b44';
    ctx.lineWidth = 1;
    ctx.strokeRect(rx0 + 0.5, ry0 + 0.5, Math.max(1, rx1 - rx0 - 1), Math.max(1, ry1 - ry0 - 1));
    if (z.state === 'wait' && !z.done) {
      const n = z.next;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(x0 + Math.round(n.x0 * sx) + 0.5, y0 + Math.round(n.y0 * sy) + 0.5,
        Math.max(1, Math.round((n.x1 - n.x0) * sx) - 1), Math.max(1, Math.round((n.y1 - n.y0) * sy) - 1));
    }
  }
  const p = match.player;
  if (p.alive && Math.floor(match.time * 3) % 3 !== 0) {
    ctx.fillStyle = UI.gold;
    ctx.fillRect(x0 + Math.round(p.x * sx) - 1, y0 + Math.round(p.y * sy) - 1, 3, 3);
  }
}
