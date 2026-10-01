// Item icons: the manifest icon if it has one, else the entry's pixel glyph,
// else a colored placeholder box with the item's initial.

import { drawText } from './font.js';

const glyphCache = new Map();
/** Glyph palette: '#' outline, 'c' the item's color, plus a few fixed colors. */
const GLYPH_COLORS = { '#': '#1a1c2c', w: '#ffffff', g: '#8b93af', l: '#c0cbdc', b: '#8f563b', o: '#fe8b3a', p: '#b55088', r: '#e43b44', u: '#41a6f6' };

function glyphCanvas(def) {
  let c = glyphCache.get(def.id);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const g = c.getContext('2d');
  def.glyph.forEach((row, y) => {
    for (let x = 0; x < row.length && x < 16; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      g.fillStyle = ch === 'c' ? def.color || '#ffffff' : GLYPH_COLORS[ch] || '#ff00ff';
      g.fillRect(x, y, 1, 1);
    }
  });
  glyphCache.set(def.id, c);
  return c;
}

export function drawItemIcon(ctx, assets, def, x, y, size = 16) {
  if (!def) return;
  const ic = assets.icon(def.id);
  if (ic && assets.has(ic.sheet, ic.frame)) {
    assets.draw(ctx, ic.sheet, ic.frame, x, y, null, size, size);
    return;
  }
  if (def.glyph) {
    ctx.drawImage(glyphCanvas(def), x, y, size, size);
    return;
  }
  const pad = Math.max(1, Math.round(size / 8));
  ctx.fillStyle = '#1a1c2c';
  ctx.fillRect(x + pad - 1, y + pad - 1, size - pad * 2 + 2, size - pad * 2 + 2);
  ctx.fillStyle = def.color || '#8b93af';
  ctx.fillRect(x + pad, y + pad, size - pad * 2, size - pad * 2);
  if (size >= 10) drawText(ctx, def.name[0], x + size / 2, y + size / 2 - 3, { color: '#1a1c2c', align: 'center' });
}
