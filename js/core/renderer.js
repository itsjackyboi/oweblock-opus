// The canvas is the 480x270 internal render target. It is scaled up with CSS
// (integer scale when it fits, image-rendering: pixelated) and letterboxed.
// Also owns the camera and its trauma-based shake.

import { CAMERA } from '../config.js';
import { clamp, damp } from './math.js';

export class Camera {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.x = 0; // world center
    this.y = 0;
    this.lookX = 0; // lean offset (aim stance)
    this.lookY = 0;
    this.trauma = 0;
    this.shakeEnabled = true;
    this.ox = 0; // final top-left, integer, set by update()
    this.oy = 0;
    this.bounds = null; // {w,h} world size for clamping
    this._t = 0;
  }

  snap(x, y) { this.x = x; this.y = y; this.update(0); }

  addTrauma(t) { this.trauma = Math.min(1, this.trauma + t); }

  follow(tx, ty, dt) {
    const k = damp(CAMERA.follow, dt);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
  }

  update(dt) {
    this._t += dt;
    this.trauma = Math.max(0, this.trauma - CAMERA.shakeDecay * dt);
    let sx = 0;
    let sy = 0;
    if (this.shakeEnabled && this.trauma > 0) {
      const s = this.trauma * this.trauma * CAMERA.maxShake;
      const t = this._t * 40;
      sx = s * (Math.sin(t * 1.3) * 0.6 + Math.sin(t * 2.9 + 1.7) * 0.4);
      sy = s * (Math.sin(t * 1.7 + 4.1) * 0.6 + Math.sin(t * 3.3 + 0.3) * 0.4);
    }
    let cx = this.x + this.lookX;
    let cy = this.y + this.lookY;
    if (this.bounds) {
      cx = clamp(cx, this.w / 2, Math.max(this.w / 2, this.bounds.w - this.w / 2));
      cy = clamp(cy, this.h / 2, Math.max(this.h / 2, this.bounds.h - this.h / 2));
    }
    this.ox = Math.round(cx - this.w / 2 + sx);
    this.oy = Math.round(cy - this.h / 2 + sy);
  }

  toWorldX(sx) { return sx + this.ox; }
  toWorldY(sy) { return sy + this.oy; }
}

export class Renderer {
  constructor(canvas, w, h) {
    this.canvas = canvas;
    this.w = w;
    this.h = h;
    canvas.width = w;
    canvas.height = h;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingEnabled = false;
    this.camera = new Camera(w, h);
    this.fit = this.fit.bind(this);
    addEventListener('resize', this.fit);
    this.fit();
  }

  fit() {
    const vw = innerWidth;
    const vh = innerHeight;
    let s = Math.min(vw / this.w, vh / this.h);
    if (s >= 1) s = Math.floor(s); // crisp integer scaling when possible
    const cw = Math.floor(this.w * s);
    const ch = Math.floor(this.h * s);
    const st = this.canvas.style;
    st.width = cw + 'px';
    st.height = ch + 'px';
    st.left = Math.floor((vw - cw) / 2) + 'px';
    st.top = Math.floor((vh - ch) / 2) + 'px';
    this.scale = s;
  }

  clear(color) {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = color;
    g.fillRect(0, 0, this.w, this.h);
  }
}
