// Canvas-drawn screens and overlays: level-up picker, death/win result, pause.

import { drawText, wrap } from './font.js';
import { drawItemIcon } from './icons.js';
import { UI } from './hud.js';
import { INTERNAL_W, INTERNAL_H } from '../config.js';
import { getDef } from '../data/registry.js';
import { GANGS } from '../data/gangs.js';

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
  const blink = Math.floor(performance.now() / 400) % 2 === 0;
  if (match.sim) drawText(ctx, 'R RESTART   T TITLE', INTERNAL_W / 2, 172, { color: UI.gold, shadow: UI.shadow, align: 'center' });
  else drawText(ctx, `${blink ? 'ENTER' : '     '} CONTINUE   R RESTART   T TITLE`, INTERNAL_W / 2, 172, { color: UI.gold, shadow: UI.shadow, align: 'center' });
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

const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// ------------------------------------------------------------------ induction (after a win)

export function inductCards() {
  const w = 190;
  const gap = 20;
  const x0 = Math.round(INTERNAL_W / 2 - w - gap / 2);
  return GANGS.map((g, i) => ({ x: x0 + i * (w + gap), y: 92, w, h: 120 }));
}

export function drawInduct(ctx, game, sel) {
  ctx.fillStyle = '#1a1c2c';
  ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
  drawText(ctx, 'LAST ONE STANDING', INTERNAL_W / 2, 22, { color: UI.gold, shadow: '#b13e53', scale: 3, align: 'center' });
  drawText(ctx, 'OWE BLOCK TAKES NOTICE. CHOOSE YOUR GANG.', INTERNAL_W / 2, 62, { color: UI.ink, shadow: UI.shadow, align: 'center' });
  const mouse = game.input.mouse;
  inductCards().forEach((c, i) => {
    const g = GANGS[i];
    const hot = i === sel || (mouse.x >= c.x && mouse.x < c.x + c.w && mouse.y >= c.y && mouse.y < c.y + c.h);
    ctx.fillStyle = hot ? '#ffffff' : '#000000';
    ctx.fillRect(c.x - 2, c.y - 2, c.w + 4, c.h + 4);
    ctx.fillStyle = g.dark;
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = g.ui;
    ctx.fillRect(c.x, c.y, c.w, 6);
    drawText(ctx, `[${i + 1}]`, c.x + 4, c.y + 10, { color: '#ffffff' });
    drawText(ctx, g.name, c.x + c.w / 2, c.y + 22, { color: '#ffffff', shadow: '#000000', scale: 2, align: 'center' });
    const def = getDef(g.weapon);
    if (def) drawItemIcon(ctx, game.assets, def, c.x + c.w / 2 - 16, c.y + 44, 32);
    drawText(ctx, def ? def.name : g.weapon, c.x + c.w / 2, c.y + 84, { color: UI.gold, align: 'center' });
    drawText(ctx, `UNLOCKS WEAPON + ${g.color.toUpperCase()} COLORS`, c.x + c.w / 2, c.y + 100, { color: '#c0cbdc', align: 'center' });
  });
  drawText(ctx, 'LEFT/RIGHT + ENTER, 1/2, OR CLICK', INTERNAL_W / 2, INTERNAL_H - 14, { color: UI.dim, align: 'center' });
}

// ------------------------------------------------------------------ summary


export function drawSummary(ctx, game, r) {
  ctx.fillStyle = '#1a1c2c';
  ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
  if (!r) { drawText(ctx, 'NO MATCH', INTERNAL_W / 2, 120, { color: UI.ink, align: 'center' }); return; }
  drawText(ctx, r.win ? 'VICTORY' : 'MATCH SUMMARY', INTERNAL_W / 2, 14, { color: r.win ? UI.gold : UI.ink, shadow: '#b13e53', scale: 2, align: 'center' });
  drawText(ctx, `#${r.placement} OF ${r.of}`, INTERNAL_W / 2, 40, { color: UI.gold, shadow: UI.shadow, scale: 3, align: 'center' });
  const rows = [
    ['KILLS', String(r.kills), 'kills'],
    ['DAMAGE', String(r.damage), 'damage'],
    ['LEVEL', String(r.level)],
    ['TIME SURVIVED', mmss(r.time), 'longestLife'],
    ['KILLED BY', r.win ? '-' : `${r.killedBy || 'NOBODY'}${r.with ? ' (' + r.with + ')' : ''}`],
  ];
  const x0 = 70;
  rows.forEach(([k, v, best], i) => {
    const y = 76 + i * 12;
    drawText(ctx, k, x0, y, { color: UI.dim });
    const nb = best && r.newBest?.includes(best);
    drawText(ctx, v, x0 + 120, y, { color: nb ? UI.gold : UI.ink });
    if (nb) drawText(ctx, 'NEW BEST', x0 + 125 + v.length * 6, y, { color: UI.gold });
  });
  if (r.win && r.newBest?.includes('fastestWin')) drawText(ctx, 'NEW FASTEST WIN!', x0, 76 + rows.length * 12, { color: UI.gold });
  // Build: icons with level pips.
  drawText(ctx, 'BUILD', 300, 76, { color: UI.dim });
  (r.build || []).forEach((b, i) => {
    const def = getDef(b.id);
    const x = 300 + i * 36;
    ctx.fillStyle = '#262b44';
    ctx.fillRect(x, 88, 30, 30);
    if (def) drawItemIcon(ctx, game.assets, def, x + 3, 90, 24);
    for (let l = 0; l < 5; l++) { ctx.fillStyle = l < b.level ? UI.gold : '#3a3448'; ctx.fillRect(x + 3 + l * 5, 120, 4, 2); }
  });
  if (!r.build?.length) drawText(ctx, 'BARE KNUCKLES', 300, 92, { color: UI.ink });
  if (r.joined) {
    ctx.fillStyle = r.joined.dark;
    ctx.fillRect(40, 160, INTERNAL_W - 80, 40);
    ctx.fillStyle = r.joined.ui;
    ctx.fillRect(40, 160, INTERNAL_W - 80, 3);
    drawText(ctx, `WELCOME TO THE ${r.joined.name}`, INTERNAL_W / 2, 170, { color: '#ffffff', shadow: '#000', align: 'center' });
    const def = getDef(r.joined.weapon);
    drawText(ctx, `${def ? def.name : ''} UNLOCKED. YOU START YOUR NEXT RUN WITH IT.`, INTERNAL_W / 2, 184, { color: UI.gold, align: 'center' });
  }
  const t = game.save.data.totals;
  drawText(ctx, `MATCHES ${t.matches}   WINS ${t.wins}   TOTAL KILLS ${t.kills}`, INTERNAL_W / 2, 220, { color: UI.dim, align: 'center' });
  drawText(ctx, 'ENTER OR CLICK: TITLE', INTERNAL_W / 2, INTERNAL_H - 14, { color: UI.gold, align: 'center' });
}

// ------------------------------------------------------------------ unlocks / stats

export function drawStats(ctx, game) {
  const d = game.save.data;
  ctx.fillStyle = '#1a1c2c';
  ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
  drawText(ctx, 'UNLOCKS / STATS', INTERNAL_W / 2, 12, { color: UI.gold, shadow: '#b13e53', scale: 2, align: 'center' });
  // Gangs.
  GANGS.forEach((g, i) => {
    const x = 16;
    const y = 40 + i * 44;
    const on = d.unlocked[g.unlockKey];
    ctx.fillStyle = on ? g.dark : '#262b44';
    ctx.fillRect(x, y, 210, 38);
    ctx.fillStyle = on ? g.ui : '#3a3448';
    ctx.fillRect(x, y, 3, 38);
    const def = getDef(g.weapon);
    ctx.globalAlpha = on ? 1 : 0.3;
    if (def) drawItemIcon(ctx, game.assets, def, x + 8, y + 3, 32);
    ctx.globalAlpha = 1;
    drawText(ctx, g.name, x + 46, y + 6, { color: on ? '#ffffff' : UI.dim });
    drawText(ctx, on ? (def ? def.name : '') : 'LOCKED: WIN A MATCH', x + 46, y + 20, { color: on ? UI.gold : UI.dim });
  });
  const wdef = d.startWeapon ? getDef(d.startWeapon) : null;
  drawText(ctx, `[1] COLOR: ${d.color.toUpperCase()}`, 16, 136, { color: UI.ink });
  drawText(ctx, `[2] START WITH: ${wdef ? wdef.name : 'BARE KNUCKLES'}`, 16, 148, { color: UI.ink });
  // Bests and totals.
  const b = d.best;
  const t = d.totals;
  const col = 250;
  const lines = [
    ['MATCHES', t.matches], ['WINS', t.wins], ['TOTAL KILLS', t.kills], ['TOTAL DAMAGE', Math.round(t.damage)], ['TIME PLAYED', mmss(t.time)],
    ['BEST KILLS', b.kills], ['BEST DAMAGE', Math.round(b.damage)], ['BEST PLACEMENT', b.placement ? `#${b.placement}` : '-'],
    ['LONGEST LIFE', mmss(b.longestLife)], ['FASTEST WIN', b.fastestWin ? mmss(b.fastestWin) : '-'],
  ];
  lines.forEach(([k, v], i) => {
    drawText(ctx, k, col, 40 + i * 10, { color: UI.dim });
    drawText(ctx, String(v), INTERNAL_W - 16, 40 + i * 10, { color: UI.ink, align: 'right' });
  });
  // Recent matches.
  drawText(ctx, 'RECENT', 16, 170, { color: UI.dim });
  d.history.slice(0, 6).forEach((h, i) => {
    drawText(ctx, `${h.win ? 'WIN' : '#' + h.placement} ${(h.mode || '').toUpperCase()}  ${h.kills}K  ${mmss(h.time)}`, 16, 182 + i * 10, { color: h.win ? UI.gold : UI.ink });
  });
  if (!game.save.available) drawText(ctx, 'STORAGE BLOCKED: PROGRESS WILL NOT BE SAVED', INTERNAL_W / 2, 248, { color: UI.red, align: 'center' });
  drawText(ctx, 'ENTER / ESC / CLICK: BACK', INTERNAL_W / 2, INTERNAL_H - 12, { color: UI.dim, align: 'center' });
}

// ------------------------------------------------------------------ options

const OPT_Y = 80;
const OPT_STEP = 20;

export function optionsHit(n, mouse) {
  for (let i = 0; i < n; i++) {
    const y = OPT_Y + i * OPT_STEP;
    if (mouse.x >= 110 && mouse.x < 370 && mouse.y >= y - 5 && mouse.y < y + 12) return i;
  }
  return -1;
}

export function drawOptions(ctx, rows, sel, mouse) {
  ctx.fillStyle = '#1a1c2c';
  ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
  drawText(ctx, 'OPTIONS', INTERNAL_W / 2, 24, { color: UI.gold, shadow: '#b13e53', scale: 2, align: 'center' });
  const hover = optionsHit(rows.length, mouse);
  rows.forEach((r, i) => {
    const y = OPT_Y + i * OPT_STEP;
    const on = i === sel || i === hover;
    if (on) { ctx.fillStyle = 'rgba(255, 205, 117, 0.15)'; ctx.fillRect(110, y - 5, 260, 17); }
    drawText(ctx, r.label, 120, y, { color: on ? UI.gold : UI.ink });
    if (r.value) drawText(ctx, `< ${r.value} >`, 360, y, { color: on ? UI.gold : UI.ink, align: 'right' });
  });
  drawText(ctx, 'UP/DOWN SELECT   LEFT/RIGHT CHANGE   ENTER TOGGLE   ESC BACK', INTERNAL_W / 2, INTERNAL_H - 14, { color: UI.dim, align: 'center' });
}
