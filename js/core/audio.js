// WebAudio chiptune: two pulse voices (PeriodicWave duty cycles), a triangle and a
// noise buffer. SFX are data (js/data/sfx.js): frequency sweep, envelope, wave and
// duty. Music (js/data/music.js) runs on a lookahead sequencer (25 ms timer, 100 ms
// ahead). The context is created on the first user gesture; at most MAX_VOICES SFX
// play at once, attenuated by distance from the camera and culled offscreen.

import { SFX } from '../data/sfx.js';
import { TRACKS } from '../data/music.js';

const MAX_VOICES = 12;
const LOOKAHEAD = 0.1;
const TIMER_MS = 25;
const HEAR_RADIUS = 520; // px from the camera center

const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

/** 'C#4' -> Hz. */
export function noteHz(n) {
  const m = /^([A-G]#?)(-?\d)$/.exec(n);
  if (!m) return 0;
  const midi = (+m[2] + 1) * 12 + NOTE[m[1]];
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function pulseWave(ctx, duty) {
  const n = 64;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let k = 1; k < n; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  return ctx.createPeriodicWave(re, im);
}

export class Audio {
  constructor(settings) {
    this.ctx = null;
    this.settings = settings;
    this.voices = 0;
    this.track = null;
    this.wantTrack = null;
  }

  /** Create the context (must be called from a user gesture). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.connect(c.destination);
    this.musicBus = c.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus = c.createGain();
    this.sfxBus.connect(this.master);
    this.waves = { 0.125: pulseWave(c, 0.125), 0.25: pulseWave(c, 0.25), 0.5: pulseWave(c, 0.5) };
    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = (seed / 0x3fffffff) - 1; }
    this.applyVolumes();
    this.timer = setInterval(() => this._schedule(), TIMER_MS);
    if (this.wantTrack) this.playMusic(this.wantTrack, true);
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    this.master.gain.value = s.master;
    this.musicBus.gain.value = s.music * 0.5;
    this.sfxBus.gain.value = s.sfx;
  }

  /** One oscillator/noise voice with an envelope; returns the end time. */
  _voice(bus, t, wave, duty, f0, f1, dur, vol, attack = 0.005, sweep = 'exp') {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(bus);
    let src;
    if (wave === 'noise') {
      src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.setValueAtTime(Math.max(0.05, f0 / 1000), t);
      if (f1 && f1 !== f0) src.playbackRate.linearRampToValueAtTime(Math.max(0.05, f1 / 1000), t + dur);
    } else {
      src = c.createOscillator();
      if (wave === 'pulse') src.setPeriodicWave(this.waves[duty] || this.waves[0.5]);
      else src.type = wave;
      src.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) {
        if (sweep === 'exp') src.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
        else src.frequency.linearRampToValueAtTime(f1, t + dur);
      }
    }
    src.connect(g);
    src.start(t);
    src.stop(t + dur + 0.02);
    return src;
  }

  /**
   * Play an SFX by name. (x, y) world position with `cam` for distance attenuation;
   * omit for UI sounds.
   */
  play(name, x, y, cam) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const def = SFX[name];
    if (!def) return;
    let vol = def.vol ?? 0.3;
    if (cam && x !== undefined) {
      const d = Math.hypot(x - (cam.ox + cam.w / 2), y - (cam.oy + cam.h / 2));
      if (d > HEAR_RADIUS) return;
      vol *= 1 - d / HEAR_RADIUS;
    }
    if (vol < 0.01 || this.voices >= MAX_VOICES) return;
    const t0 = this.ctx.currentTime;
    const parts = def.parts || [def];
    for (let k = 0; k < parts.length; k++) {
      const p = parts[k];
      const reps = p.repeat || 1;
      for (let r = 0; r < reps; r++) {
        if (this.voices >= MAX_VOICES) return;
        const t = t0 + (p.delay || 0) + r * (p.gap || 0.06);
        const src = this._voice(this.sfxBus, t, p.wave || def.wave, p.duty || def.duty, p.f0, p.f1, p.dur, vol * (p.vol ?? 1), p.attack, p.sweep);
        this.voices++;
        src.onended = () => { this.voices--; };
      }
    }
  }

  // ---------------------------------------------------------------- music

  playMusic(id, force = false) {
    this.wantTrack = id;
    if (!this.ctx) return;
    if (!force && this.track && this.track.id === id) return;
    const def = TRACKS[id];
    if (!def) { this.track = null; return; }
    this.track = { id, def, step: 0, next: this.ctx.currentTime + 0.05, len: def.steps };
  }

  stopMusic() {
    this.track = null;
    this.wantTrack = null;
  }

  _schedule() {
    const tr = this.track;
    if (!tr || !this.ctx) return;
    const stepDur = 60 / tr.def.bpm / 4; // 16th notes
    while (tr.next < this.ctx.currentTime + LOOKAHEAD) {
      for (const ch of tr.def.channels) {
        const ev = ch.steps[tr.step % ch.steps.length];
        if (!ev) continue;
        const dur = stepDur * (ev.len || 1) * 0.95;
        if (ch.wave === 'noise') {
          this._voice(this.musicBus, tr.next, 'noise', 0, ev.f, ev.f * 0.5, Math.min(dur, ev.short ? 0.05 : 0.18), ch.vol * (ev.vol ?? 1), 0.002, 'lin');
        } else {
          this._voice(this.musicBus, tr.next, ch.wave, ch.duty, ev.f, ev.f, Math.max(0.05, dur), ch.vol, 0.005, 'lin');
        }
      }
      tr.step = (tr.step + 1) % tr.len;
      tr.next += stepDur;
    }
  }
}
