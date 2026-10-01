// Loads assets/manifest.json and its sheet images. Every draw call has a fallback:
// if an image failed to load, a key is missing, or ?placeholders=1 is set, a flat
// rectangle in the role's placeholder color is drawn instead, so the game always runs.

const DEFAULT_PLACEHOLDER = '#ff00ff';

export class Assets {
  constructor({ forcePlaceholders = false } = {}) {
    this.forcePlaceholders = forcePlaceholders;
    this.manifest = { sheets: {}, tilesets: {}, characters: {}, icons: {}, anims: {} };
    this.images = new Map(); // sheetId -> HTMLImageElement (only successfully loaded ones)
    this.missing = [];
  }

  async load(url) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.manifest = { ...this.manifest, ...(await res.json()) };
    } catch (e) {
      console.warn(`[assets] manifest failed to load (${e.message}); using placeholders`);
    }
    if (this.forcePlaceholders) return this;
    const base = new URL('.', new URL(url, location.href));
    await Promise.all(Object.entries(this.manifest.sheets).map(([id, def]) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { this.images.set(id, img); resolve(); };
      img.onerror = () => {
        this.missing.push(def.src);
        console.warn(`[assets] sheet "${id}" failed to load (${def.src}); using placeholders`);
        resolve();
      };
      img.src = new URL(def.src, base).href;
    })));
    return this;
  }

  /** True when the frame can be drawn from a real image. */
  has(sheetId, frame) {
    const def = this.manifest.sheets[sheetId];
    return !!def && this.images.has(sheetId) && frame >= 0 && frame < def.columns * def.rows;
  }

  /** Source x/y of a frame within its sheet. */
  src(sheetId, frame) {
    const d = this.manifest.sheets[sheetId];
    const col = frame % d.columns;
    const row = (frame / d.columns) | 0;
    const [fw, fh] = d.frame;
    return [d.margin + col * (fw + d.spacing), d.margin + row * (fh + d.spacing), fw, fh];
  }

  /**
   * Draw a frame at (dx, dy) and size (dw, dh). Falls back to a flat rectangle.
   * Returns true if real art was drawn.
   */
  draw(ctx, sheetId, frame, dx, dy, fallback = DEFAULT_PLACEHOLDER, dw = 16, dh = 16) {
    if (this.has(sheetId, frame)) {
      const [sx, sy, fw, fh] = this.src(sheetId, frame);
      ctx.drawImage(this.images.get(sheetId), sx, sy, fw, fh, dx, dy, dw, dh);
      return true;
    }
    if (fallback) {
      ctx.fillStyle = fallback;
      ctx.fillRect(dx, dy, dw, dh);
    }
    return false;
  }

  tileset(id) { return this.manifest.tilesets[id] || null; }

  /** Sheet id for a tileset, or null. */
  tilesetSheet(id) { return this.tileset(id)?.sheet ?? null; }

  /** Pick one frame for a role using a position hash; -1 if the role is not mapped. */
  pickRole(tilesetId, role, hash) {
    const list = this.tileset(tilesetId)?.roles?.[role];
    if (!list || list.length === 0) return -1;
    return list[hash % list.length];
  }

  roleColor(tilesetId, role) {
    return this.tileset(tilesetId)?.placeholder?.[role] ?? DEFAULT_PLACEHOLDER;
  }

  icon(itemId) { return this.manifest.icons?.[itemId] ?? null; }
}
