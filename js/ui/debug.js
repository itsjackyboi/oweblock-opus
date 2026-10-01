// F3 debug overlay: FPS, update/render ms, entity counts, grid usage.

import { drawText } from './font.js';

export function drawDebug(ctx, game) {
  const p = game.loop.perf;
  const m = game.match;
  const lines = [
    `FPS ${p.fps}   STEPS ${p.steps}`,
    `UPDATE ${p.updateMs.toFixed(2)} MS`,
    `RENDER ${p.renderMs.toFixed(2)} MS`,
  ];
  if (m) {
    const alive = m.fighters.filter((f) => f.alive).length;
    lines.push(
      `FIGHTERS ${alive} (DRAWN ${m.fightersDrawn ?? 0})`,
      `GRID CELLS ${m.grid.usedCells}`,
      `CHUNKS ${m.map.chunksDrawn}`,
      `SEED ${m.seed}  MAP ${m.map.w}X${m.map.h}`,
      `GEN ${m.genMs.toFixed(0)} MS`,
      `POS ${m.player.x.toFixed(0)},${m.player.y.toFixed(0)}`,
    );
  }
  if (game.assets.forcePlaceholders) lines.push('PLACEHOLDERS ON');
  else if (game.assets.missing.length) lines.push(`MISSING ART ${game.assets.missing.length}`);
  const w = 150;
  const h = lines.length * 9 + 6;
  const x = 480 - w - 4;
  const y = 30;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(x, y, w, h);
  lines.forEach((l, i) => drawText(ctx, l, x + 4, y + 4 + i * 9, { color: '#a7f070' }));
}
