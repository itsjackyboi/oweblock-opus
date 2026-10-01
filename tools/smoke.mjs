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
const sims = +arg('--sims', 10); // number of ?sim seeds (0 to skip)
const simSpeed = +arg('--speed', 10);
const simParallel = +arg('--parallel', 3);
const only = arg('--only', null); // run a single section by name (e.g. 'sim')

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

async function clearAll(p) {
  // Dismiss level-up pickers that kills may have opened.
  for (let k = 0; k < 10 && await p.evaluate(() => !!window.__oweblock.game.picker); k++) {
    await p.keyboard.press('Digit1');
    await p.waitForTimeout(50);
  }
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

  // 3. Combat: items, aim at a dummy, melee / bow / pot / boomerang, level-up picker, win.
  {
    const { p, ctx } = await page('combat', 'index.html?debug=1&seed=5&dummies=6');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => window.__oweblock.state === 'match');
    await p.keyboard.press('F3');
    const ob = (fn, arg) => p.evaluate(fn, arg);
    // Screen position of the nearest dummy (canvas is CSS-scaled 2x at the top-left).
    const aimAtNearest = async () => {
      const t = await ob(() => {
        const m = window.__oweblock.match;
        const pl = m.player;
        const cam = window.__oweblock.game.renderer.camera;
        const rect = document.getElementById('game').getBoundingClientRect();
        const sc = rect.width / 480;
        let best = null;
        for (const f of m.fighters) {
          if (f === pl || !f.alive) continue;
          const d = Math.hypot(f.x - pl.x, f.y - pl.y);
          if (!best || d < best.d) best = { d, f };
        }
        if (!best) return null;
        return { d: best.d, id: best.f.id, sx: rect.left + (best.f.x - cam.ox) * sc, sy: rect.top + (best.f.y - cam.oy) * sc, hp: best.f.hp };
      });
      if (t) await p.mouse.move(t.sx, t.sy);
      return t;
    };
    const clearPickers = async () => {
      for (let k = 0; k < 10 && await ob(() => !!window.__oweblock.game.picker); k++) {
        await p.keyboard.press('Digit1');
        await p.waitForTimeout(60);
      }
    };
    const walkTo = async (maxMs) => {
      // Walk toward the nearest dummy until within ~18 px.
      const t0 = Date.now();
      while (Date.now() - t0 < maxMs) {
        const t = await ob(() => {
          const m = window.__oweblock.match; const pl = m.player;
          let best = null;
          for (const f of m.fighters) if (f !== pl && f.alive) { const d = Math.hypot(f.x - pl.x, f.y - pl.y); if (!best || d < best.d) best = { d, dx: f.x - pl.x, dy: f.y - pl.y }; }
          return best;
        });
        if (!t || t.d < 18) break;
        const keys = [];
        if (t.dx > 6) keys.push('KeyD'); else if (t.dx < -6) keys.push('KeyA');
        if (t.dy > 6) keys.push('KeyS'); else if (t.dy < -6) keys.push('KeyW');
        await hold(p, keys, 120);
      }
    };

    await ob(() => { const o = window.__oweblock; o.give('cutlass', 2); o.give('singing_bow'); o.give('ancient_pot'); });
    await p.keyboard.press('Digit1');
    await walkTo(4000);
    let t = await aimAtNearest();
    const hp0 = t.hp;
    await p.mouse.down();
    await p.waitForTimeout(700);
    await p.mouse.up();
    t = await ob((id) => window.__oweblock.match.fighters.find((f) => f.id === id).hp, t.id);
    results.cutlassDamage = Math.round(hp0 - t);
    if (!(hp0 - t > 0)) failures.push('[combat] cutlass did no damage');

    // Bow: back off a bit, full draw.
    await hold(p, ['KeyA'], 350);
    await p.keyboard.press('Digit2');
    await p.waitForTimeout(200);
    await aimAtNearest();
    await p.mouse.down({ button: 'right' });
    await p.mouse.down();
    await p.waitForTimeout(500);
    await shot(p, '06-bow-draw-stance.png');
    await p.waitForTimeout(400);
    await p.mouse.up();
    await p.mouse.up({ button: 'right' });
    await p.waitForTimeout(60);
    results.projectilesAfterBow = await ob(() => window.__oweblock.match.projectiles.count);

    // Pot: oil slick then a fire-pot onto it.
    await p.keyboard.press('Digit3');
    await p.waitForTimeout(200);
    await aimAtNearest();
    await p.keyboard.press('KeyQ');
    await p.waitForTimeout(900);
    await p.mouse.down(); await p.waitForTimeout(40); await p.mouse.up();
    await p.waitForTimeout(1100);
    results.areas = await ob(() => window.__oweblock.match.areas.pool.active.map((a) => a.style + ':' + Math.round(a.r)));
    await shot(p, '07-combat.png');
    if (!results.areas.length) failures.push('[combat] pot left no area');

    // Boomerang out and back.
    await clearPickers();
    await ob(() => { const pl = window.__oweblock.match.player; pl.slots[0] = null; window.__oweblock.give('drifters_call'); });
    await p.keyboard.press('Digit1');
    await p.waitForTimeout(200);
    await aimAtNearest();
    await p.mouse.down(); await p.waitForTimeout(40); await p.mouse.up();
    await p.waitForTimeout(300);
    results.boomerangOut = await ob(() => window.__oweblock.match.player.slots.find((s) => s && s.id === 'drifters_call')?.out);
    for (let k = 0; k < 30; k++) {
      await clearPickers();
      results.boomerangBack = await ob(() => window.__oweblock.match.player.slots.find((s) => s && s.id === 'drifters_call')?.out);
      if (results.boomerangBack === 0) break;
      await p.waitForTimeout(100);
    }
    if (results.boomerangOut !== 1 || results.boomerangBack !== 0) failures.push(`[combat] boomerang out/back ${results.boomerangOut}/${results.boomerangBack}`);

    // Full slots: walking onto a new item shows the swap prompt; E swaps it in.
    await clearPickers();
    const swap = await ob(async () => {
      const o = window.__oweblock; const m = o.match; const pl = m.player;
      pl.slots = [null, null, null];
      o.give('cutlass'); o.give('singing_bow'); o.give('ancient_pot');
      pl.held = 0;
      const { createItem } = await import('./js/data/registry.js');
      m.pickups.spawnItem(createItem('drifters_call', 1), pl.x, pl.y);
      m.pickups.spawnItem(createItem('cutlass', 1), pl.x + 2, pl.y);
      return true;
    });
    await p.waitForTimeout(150);
    const prompt = await ob(() => window.__oweblock.match.prompt?.text || null);
    results.swapPrompt = prompt;
    const cutLv = await ob(() => window.__oweblock.match.player.slots[0].level);
    if (cutLv !== 2) failures.push(`[swap] duplicate cutlass did not upgrade (level ${cutLv})`);
    await p.keyboard.press('KeyE');
    await p.waitForTimeout(150);
    const held = await ob(() => window.__oweblock.match.player.slots[0]?.id);
    if (!swap || !prompt || held !== 'drifters_call') failures.push(`[swap] prompt=${prompt} held=${held}`);

    // Level-up picker.
    await clearPickers();
    await ob(() => window.__oweblock.levelUp());
    await p.waitForTimeout(150);
    await shot(p, '08-levelup.png');
    const pickerOpen = await ob(() => !!window.__oweblock.game.picker);
    if (!pickerOpen) failures.push('[combat] level-up picker did not open');
    const pend0 = await ob(() => window.__oweblock.match.player.pendingLevelUps);
    await p.keyboard.press('Digit1');
    await p.waitForTimeout(100);
    const pend1 = await ob(() => window.__oweblock.match.player.pendingLevelUps);
    if (pend1 !== pend0 - 1) failures.push(`[combat] picking did not consume a level-up (${pend0} -> ${pend1})`);
    await clearPickers();
    results.level = await ob(() => window.__oweblock.match.player.level);

    // Kill every dummy: drops + XP, then the win screen.
    await ob(() => window.__oweblock.killAllAI());
    await p.waitForTimeout(400);
    results.pickupsAfterKills = await ob(() => window.__oweblock.match.pickups.count);
    await shot(p, '09-win.png');
    const res = await ob(() => window.__oweblock.match.result);
    if (!res || !res.win) failures.push('[combat] no win result after killAllAI');
    results.perfCombat = await ob(() => ({ updateMs: +window.__oweblock.perf.updateMs.toFixed(3), renderMs: +window.__oweblock.perf.renderMs.toFixed(3) }));
    await ctx.close();
  }

  // 3b. Full roster: every item fires its primary and special at a dummy.
  {
    const { p, ctx } = await page('roster', 'index.html?debug=1&seed=5&dummies=6');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => window.__oweblock.state === 'match');
    await p.keyboard.press('F3');
    const ids = await p.evaluate(() => window.__oweblock.items());
    results.roster = { items: ids.length, fired: [] };
    const shots = { old_staff: '15-staff-channel.png', sad_sermon: '16-sermon.png', veilwalker_net: '17-net.png', powder_keg: '18-keg.png', amethyst_shard: '19-crystal.png', keg_flail: '20-whirl.png', zaars_edges: '21-ring-of-fire.png' };
    for (const id of ids) {
      if (id === 'fists') continue;
      // Fresh dummy field each time: heal everyone, put the player back, give the item.
      const aim = await p.evaluate((itemId) => {
        const o = window.__oweblock;
        const m = o.match;
        const pl = m.player;
        pl.slots = [null, null, null];
        pl.held = 0;
        pl.hp = pl.maxHp;
        o.give(itemId, 3);
        for (const f of m.fighters) { if (f !== pl) { f.maxHp = 1e5; } f.hp = f.maxHp; for (const k in f.statuses) f.statuses[k].t = 0; }
        pl.pendingLevelUps = 0;
        let best = null;
        for (const f of m.fighters) if (f !== pl && f.alive && (!best || Math.hypot(f.x - pl.x, f.y - pl.y) < Math.hypot(best.x - pl.x, best.y - pl.y))) best = f;
        if (!best) return null;
        const cam = o.game.renderer.camera;
        const rect = document.getElementById('game').getBoundingClientRect();
        const sc = rect.width / 480;
        return { x: rect.left + (best.x - cam.ox) * sc, y: rect.top + (best.y - cam.oy) * sc };
      }, id);
      if (!aim) break;
      await p.mouse.move(aim.x, aim.y);
      await p.waitForTimeout(120);
      await p.mouse.down();
      await p.waitForTimeout(id === 'singing_bow' ? 800 : 150);
      await p.mouse.up();
      await p.waitForTimeout(id === 'old_staff' ? 300 : 500);
      if (shots[id] && id === 'old_staff') { await shot(p, shots[id]); await p.waitForTimeout(500); }
      await p.keyboard.down('KeyQ');
      await p.waitForTimeout(id === 'wagwans_whopper' ? 700 : 80);
      await p.keyboard.up('KeyQ');
      await p.waitForTimeout(id === 'old_staff' ? 900 : 450);
      if (shots[id] && id !== 'old_staff') await shot(p, shots[id]);
      const st = await p.evaluate(() => {
        const pl = window.__oweblock.match.player;
        const it = pl.slots[0];
        return it ? { cdP: +it.cdP.toFixed(2), cdS: +it.cdS.toFixed(2), charges: it.charges } : null;
      });
      results.roster.fired.push(`${id}:${st ? (st.cdP > 0 || st.charges !== undefined ? 'P' : '-') + (st.cdS > 0 ? 'Q' : '-') : 'x'}`);
      if (!st || st.cdS <= 0) failures.push(`[roster] ${id}: special did not fire (${JSON.stringify(st)})`);
      await clearAll(p);
    }
    await ctx.close();
  }

  // 4. Death screen.
  {
    const { p, ctx } = await page('death', 'index.html?debug=1&seed=6&dummies=3');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => window.__oweblock.state === 'match');
    await p.keyboard.press('F3');
    await p.evaluate(() => window.__oweblock.hurt(1000));
    await p.waitForTimeout(300);
    await shot(p, '10-death.png');
    const res = await p.evaluate(() => window.__oweblock.match.result);
    if (!res || res.win) failures.push('[death] no death result');
    await p.keyboard.press('KeyR');
    await p.waitForTimeout(200);
    if (await p.evaluate(() => !!window.__oweblock.match.result)) failures.push('[death] R did not restart');
    await ctx.close();
  }

  // 5. Placeholders everywhere, localStorage blocked.
  {
    const { p, ctx } = await page('placeholders', 'index.html?debug=1&seed=3&dummies=10&placeholders=1', { blockStorage: true });
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => window.__oweblock.state === 'match');
    await hold(p, ['KeyD'], 300);
    await p.waitForTimeout(300);
    await shot(p, '11-placeholders.png');
    await ctx.close();
  }

  // 6. Map overview for a few seeds (whole map scaled into one image).
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
      await writeFile(path.join(outDir, `12-map-seed${seed}.png`), Buffer.from(data.split(',')[1], 'base64'));
      (results.maps ||= []).push(stats);
      if (stats.spawns < 41) failures.push(`[maps] seed ${seed}: only ${stats.spawns} spawn points (need 41)`);
    }
    await ctx.close();
  }
  // 7. AI simulations: a high-tier AI plays; report match length, winner tier, frame cost.
  if (sims > 0) {
    const runSim = async (seed) => {
      const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
      const p = await ctx.newPage();
      p.on('console', (m) => { if (m.type() === 'error') failures.push(`[sim ${seed}] console.error: ${m.text()}`); });
      p.on('pageerror', (e) => failures.push(`[sim ${seed}] pageerror: ${e.message}\n${e.stack}`));
      await p.goto(base + `index.html?debug=1&sim=1&speed=${simSpeed}&seed=${seed}`);
      try {
        await p.waitForFunction(() => window.__oweblock && window.__oweblock.result, null, { timeout: (600 / simSpeed + 60) * 1000, polling: 500 });
      } catch {
        failures.push(`[sim ${seed}] did not finish`);
      }
      if (seed === 1) await shot(p, '13-sim-end.png');
      const r = await p.evaluate(() => window.__oweblock?.result);
      await ctx.close();
      return r;
    };
    // A mid-match screenshot at normal speed, with the full field.
    {
      const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => failures.push(`[sim-shot] pageerror: ${e.message}`));
      await p.goto(base + 'index.html?debug=1&sim=1&speed=4&seed=11');
      await p.waitForFunction(() => window.__oweblock?.match?.time > 75, null, { timeout: 60000 });
      await p.evaluate(() => { window.__oweblock.game.showDebug = false; });
      await p.waitForTimeout(100);
      await shot(p, '14-sim-zone.png');
      await ctx.close();
    }
    const seeds = Array.from({ length: sims }, (_, i) => i + 1);
    const out = [];
    for (let i = 0; i < seeds.length; i += simParallel) {
      out.push(...(await Promise.all(seeds.slice(i, i + simParallel).map(runSim))));
    }
    results.sims = out.filter(Boolean).map((r) => ({
      seed: r.seed, duration: r.duration, winner: r.winner, tier: r.winnerTier, kills: r.winnerKills,
      updAvg: r.perf.updateAvg, updP99: r.perf.updateP99, rndAvg: r.perf.renderAvg, rndP99: r.perf.renderP99,
    }));
    const d = results.sims.map((r) => r.duration);
    if (d.length) {
      results.simSummary = {
        minDuration: Math.min(...d), maxDuration: Math.max(...d), avgDuration: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(1),
        avgFrameMs: +(results.sims.reduce((a, r) => a + r.updAvg + r.rndAvg, 0) / d.length).toFixed(3),
        p99FrameMs: +Math.max(...results.sims.map((r) => r.updP99 + r.rndP99)).toFixed(3),
      };
    }
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
