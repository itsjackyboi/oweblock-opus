// Paper-doll compositor. A fighter's look is a list of Roguelike Characters layers
// (body, legs, shoes, torso, hair, beard, hat) composited once into a cached 16x16
// canvas, plus a white silhouette used for the hit flash. Outfit layers can be
// recolored per palette (red / blue / police) with a hue remap from the manifest.

const SIZE = 16;
const LAYER_ORDER = ['body', 'legs', 'shoes', 'torso', 'hair', 'beard', 'hat'];
const RECOLORED = new Set(['legs', 'shoes', 'torso', 'hat']);

const FALLBACK_COLORS = {
  skin: '#e0b48a', hair: '#5a3a22', legs: '#3b3346',
  red: '#c8323c', blue: '#2f6fd0', grey: '#8a8796', police: '#23263a',
};

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  return [c, g];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** In-place hue remap: pixels whose hue is in [from0, from1] move to `to` (keeping their offset). */
function recolor(g, rc) {
  const img = g.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  const [h0, h1] = rc.hueFrom;
  const mid = (h0 + h1) / 2;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    if (s < (rc.minSat ?? 0.15) || h < h0 || h > h1) continue;
    const [r, gg, b] = hslToRgb(rc.hueTo + (h - mid) * 0.5, Math.min(1, s * (rc.sat ?? 1)), Math.min(1, l * (rc.light ?? 1)));
    d[i] = r; d[i + 1] = gg; d[i + 2] = b;
  }
  g.putImageData(img, 0, 0);
}

export class SpriteCache {
  constructor(assets) {
    this.assets = assets;
    this.cache = new Map();
    this.def = assets.manifest.characters || {};
    this.sheet = this.def.sheet || 'chars';
  }

  /** Random appearance for a palette ('red' | 'blue' | 'grey' | 'police'). */
  randomAppearance(rng, palette) {
    const d = this.def;
    const pick = (list) => (list && list.length ? rng.pick(list) : -1);
    const p = (k) => d[k]?.[palette] ?? d[k]?.grey;
    return {
      palette,
      body: pick(d.body),
      legs: pick(p('legs')),
      shoes: pick(p('shoes')),
      torso: pick(p('torso')),
      hair: pick(d.hair),
      beard: rng.chance(d.beardChance ?? 0.3) ? pick(d.beard) : -1,
      hat: pick(p('hat')),
    };
  }

  /** {normal, flash} 16x16 canvases for an appearance, composited once and cached. */
  get(app) {
    const key = LAYER_ORDER.map((k) => app[k] ?? -1).join(',') + '|' + app.palette;
    let entry = this.cache.get(key);
    if (!entry) {
      entry = this._build(app);
      this.cache.set(key, entry);
    }
    return entry;
  }

  _build(app) {
    const [c, g] = makeCanvas(SIZE, SIZE);
    const art = this.assets.has(this.sheet, app.body);
    if (art) {
      const rc = this.def.recolor?.[app.palette];
      const [lc, lg] = makeCanvas(SIZE, SIZE);
      for (const layer of LAYER_ORDER) {
        const f = app[layer];
        if (f == null || f < 0 || !this.assets.has(this.sheet, f)) continue;
        if (rc && RECOLORED.has(layer)) {
          lg.clearRect(0, 0, SIZE, SIZE);
          this.assets.draw(lg, this.sheet, f, 0, 0, null);
          recolor(lg, rc);
          g.drawImage(lc, 0, 0);
        } else {
          this.assets.draw(g, this.sheet, f, 0, 0, null);
        }
      }
    } else {
      this._placeholder(g, app);
    }
    const [fc, fg] = makeCanvas(SIZE, SIZE);
    fg.drawImage(c, 0, 0);
    fg.globalCompositeOperation = 'source-in';
    fg.fillStyle = '#ffffff';
    fg.fillRect(0, 0, SIZE, SIZE);
    return { normal: c, flash: fc };
  }

  /** Readable flat-color figure used when art is missing. */
  _placeholder(g, app) {
    const ph = { ...FALLBACK_COLORS, ...(this.def.placeholder || {}) };
    const outfit = ph[app.palette] || ph.grey;
    g.fillStyle = ph.legs;
    g.fillRect(5, 12, 2, 4);
    g.fillRect(9, 12, 2, 4);
    g.fillStyle = outfit;
    g.fillRect(4, 7, 8, 6);
    g.fillStyle = ph.skin;
    g.fillRect(5, 2, 6, 5);
    g.fillStyle = ph.hair;
    g.fillRect(5, 1, 6, 2);
    if (app.hat >= 0) {
      g.fillStyle = outfit;
      g.fillRect(4, 0, 8, 2);
    }
  }
}
