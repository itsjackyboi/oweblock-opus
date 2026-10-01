// Playwright smoke test and screenshot runner.
//   node tools/smoke.mjs [--out dir] [--port 8080]
// Starts its own static server on the repo root, loads the game, fails on any
// console error or page error, and saves screenshots (default: tools/screens/).
// Uses the globally installed Playwright with the preinstalled Chromium.

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const outDir = path.resolve(arg('--out', path.join(root, 'tools/screens')));
const port = +arg('--port', 8090);

const require = createRequire(path.join(execSync('npm root -g').toString().trim(), '/'));
const { chromium } = require('playwright');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.txt': 'text/plain' };
const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // Serve under /oweblock-opus/ too, to prove relative paths work on a Pages subpath.
  const rel = p.replace(/^\/oweblock-opus\//, '/');
  const file = path.join(root, rel.endsWith('/') ? rel + 'index.html' : rel);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(port, r));
const base = `http://localhost:${port}/oweblock-opus/`;

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const failures = [];
const results = {};

async function page(name, query, { blockStorage = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  if (blockStorage) {
    await ctx.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
    });
  }
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') failures.push(`[${name}] console.error: ${m.text()}`); });
  p.on('pageerror', (e) => failures.push(`[${name}] pageerror: ${e.message}`));
  p.on('requestfailed', (r) => failures.push(`[${name}] request failed: ${r.url()}`));
  await p.goto(base + query);
  await p.waitForFunction(() => window.__oweblock && window.__oweblock.perf.frames > 5, null, { timeout: 15000 });
  return { p, ctx };
}

const shot = (p, n) => p.screenshot({ path: path.join(outDir, n) });

async function hold(p, keys, ms) {
  for (const k of keys) await p.keyboard.down(k);
  await p.waitForTimeout(ms);
  for (const k of keys) await p.keyboard.up(k);
}

try {
  // 1. Title screen.
  {
    const { p, ctx } = await page('title', 'index.html?debug=1&seed=3');
    await p.waitForTimeout(300);
    await shot(p, '01-title.png');
    await ctx.close();
  }

  // 2. Match with real art: move around, dash, debug overlay.
  {
    const { p, ctx } = await page('match', 'index.html?debug=1&seed=3&dummies=10');
    await p.mouse.click(480, 270);
    await p.waitForFunction(() => window.__oweblock.state === 'match');
    await p.keyboard.press('F3'); // ?debug=1 starts with the overlay on; hide it for the clean shot
    await p.waitForTimeout(400);
    await shot(p, '02-match.png');
    // Movement: hold each direction and sample the player's speed; walls may block some.
    const speeds = [];
    for (const k of ['KeyD', 'KeyS', 'KeyA', 'KeyW']) {
      await p.keyboard.down(k);
      await p.waitForTimeout(250);
      speeds.push(await p.evaluate(() => Math.hypot(window.__oweblock.match.player.vx, window.__oweblock.match.player.vy)));
      await p.keyboard.up(k);
      await p.waitForTimeout(150);
    }
    results.moveSpeeds = speeds.map((v) => +v.toFixed(1));
    if (speeds.filter((v) => v > 90).length < 2) failures.push(`[match] player did not reach run speed: ${results.moveSpeeds}`);
    await p.keyboard.press('Space');
    await p.waitForTimeout(50);
    const dashCd = await p.evaluate(() => window.__oweblock.match.player.dashCd);
    if (dashCd <= 0) failures.push('[match] dash did not trigger');
    await p.keyboard.press('F3');
    await p.waitForTimeout(1500);
    await shot(p, '03-match-debug.png');
    results.perf = await p.evaluate(() => {
      const pf = window.__oweblock.perf;
      return { fps: pf.fps, updateMs: +pf.updateMs.toFixed(3), renderMs: +pf.renderMs.toFixed(3) };
    });
    await p.keyboard.press('Escape');
    await p.waitForTimeout(200);
    await shot(p, '04-pause.png');
    await ctx.close();
  }

  // 3. Placeholders everywhere, localStorage blocked.
  {
    const { p, ctx } = await page('placeholders', 'index.html?debug=1&seed=3&dummies=10&placeholders=1', { blockStorage: true });
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => window.__oweblock.state === 'match');
    await hold(p, ['KeyD'], 300);
    await p.waitForTimeout(300);
    await shot(p, '05-placeholders.png');
    await ctx.close();
  }

  // 4. Map overview for a few seeds (whole map scaled into one image).
  {
    const { p, ctx } = await page('maps', 'index.html?debug=1');
    for (const seed of [1, 2, 3]) {
      const stats = await p.evaluate(async (s) => {
        const ob = window.__oweblock;
        ob.start({ seed: s });
        const m = ob.match;
        const assets = ob.game.assets;
        const c = document.createElement('canvas');
        c.width = m.map.pw; c.height = m.map.ph;
        const g = c.getContext('2d');
        m.map.draw(g, { ox: 0, oy: 0, w: m.map.pw, h: m.map.ph }, assets);
        const sp = m.map.meta.spawns;
        g.fillStyle = '#ff004d';
        for (const p of sp) g.fillRect(p.x - 4, p.y - 4, 8, 8);
        const d = m.map.meta.deepest;
        g.strokeStyle = '#ffec27'; g.lineWidth = 4;
        g.strokeRect(d.x * 16 - 40, d.y * 16 - 40, 80, 80);
        window.__mapShot = c.toDataURL('image/png');
        let floor = 0;
        for (const t of m.map.tiles) if (t === 0) floor++;
        return { seed: s, genMs: +m.genMs.toFixed(1), spawns: sp.length, chambers: m.map.meta.chambers.length, floorPct: +(100 * floor / m.map.tiles.length).toFixed(1) };
      }, seed);
      const data = await p.evaluate(() => window.__mapShot);
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path.join(outDir, `06-map-seed${seed}.png`), Buffer.from(data.split(',')[1], 'base64'));
      (results.maps ||= []).push(stats);
      if (stats.spawns < 41) failures.push(`[maps] seed ${seed}: only ${stats.spawns} spawn points (need 41)`);
    }
    await ctx.close();
  }
} catch (e) {
  failures.push('runner: ' + (e.stack || e.message));
} finally {
  await browser.close();
  server.close();
}

console.log(JSON.stringify(results, null, 2));
console.log(`screenshots: ${outDir}`);
if (failures.length) {
  console.log('\nFAILURES:\n' + failures.join('\n'));
  process.exit(1);
}
console.log('SMOKE OK');
