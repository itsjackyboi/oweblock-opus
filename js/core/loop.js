// Fixed-step update (60 Hz, accumulator, capped steps) with rAF rendering.
// timeScale speeds up or slows the simulation (sim mode uses it), and hitStop
// freezes updates for a short time while rendering continues.

import { STEP, MAX_STEPS_PER_FRAME } from '../config.js';

export class Loop {
  /**
   * @param {(dt:number) => void} update called once per fixed step
   * @param {(alpha:number, frameDt:number) => void} render called once per animation frame
   * @param {() => void} [afterStep] called after each update step (input edge clearing)
   */
  constructor(update, render, afterStep) {
    this.update = update;
    this.render = render;
    this.afterStep = afterStep || (() => {});
    this.timeScale = 1;
    this.hitStop = 0;
    this.maxSteps = MAX_STEPS_PER_FRAME;
    this.acc = 0;
    this.last = 0;
    this.running = false;
    this.perf = { fps: 0, updateMs: 0, renderMs: 0, steps: 0, frames: 0 };
    this._fpsT = 0;
    this._fpsN = 0;
    this._frame = this._frame.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._frame);
  }

  stop() { this.running = false; }

  /** Freeze simulation for `seconds` (keeps the longest pending request). */
  addHitStop(seconds) { this.hitStop = Math.max(this.hitStop, seconds); }

  _frame(now) {
    if (!this.running) return;
    let real = (now - this.last) / 1000;
    this.last = now;
    if (real > 0.25) real = 0.25; // tab was hidden; don't spiral

    this._fpsT += real;
    this._fpsN++;
    if (this._fpsT >= 0.5) {
      this.perf.fps = Math.round(this._fpsN / this._fpsT);
      this._fpsT = 0;
      this._fpsN = 0;
    }

    if (this.hitStop > 0) {
      this.hitStop -= real;
    } else {
      this.acc += real * this.timeScale;
    }

    const maxSteps = this.maxSteps * Math.max(1, Math.ceil(this.timeScale));
    let steps = 0;
    const t0 = performance.now();
    while (this.acc >= STEP && steps < maxSteps) {
      this.update(STEP);
      this.afterStep();
      this.acc -= STEP;
      steps++;
      if (this.hitStop > 0) { this.acc = 0; break; }
    }
    if (steps >= maxSteps) this.acc = 0; // drop backlog rather than spiral
    const t1 = performance.now();
    this.render(this.acc / STEP, real);
    const t2 = performance.now();

    const p = this.perf;
    p.steps = steps;
    p.frames++;
    // Smoothed per-step update cost and per-frame render cost.
    if (steps > 0) p.updateMs += ((t1 - t0) / steps - p.updateMs) * 0.1;
    p.renderMs += (t2 - t1 - p.renderMs) * 0.1;
    requestAnimationFrame(this._frame);
  }
}
