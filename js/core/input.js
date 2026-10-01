// Keyboard + mouse state. Edge flags (pressed/released, wheel) accumulate between
// update steps and are cleared after the first step that sees them, so a quick tap
// is never lost even when a frame runs zero update steps.

const BLOCK_DEFAULT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3']);

export class Input {
  constructor(canvas, internalW, internalH) {
    this.canvas = canvas;
    this.iw = internalW;
    this.ih = internalH;
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { x: internalW / 2, y: internalH / 2, inside: false };
    this.buttons = [false, false, false];
    this.btnPressed = [false, false, false];
    this.btnReleased = [false, false, false];
    this.wheel = 0;
    this.anyPressed = false;

    addEventListener('keydown', (e) => {
      if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
      this.anyPressed = true;
    });
    addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    addEventListener('blur', () => this.reset());

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => this._move(e));
    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this._move(e);
      if (e.button > 2) return;
      this.buttons[e.button] = true;
      this.btnPressed[e.button] = true;
      this.anyPressed = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button > 2) return;
      this.buttons[e.button] = false;
      this.btnReleased[e.button] = true;
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });
  }

  _move(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - r.left) / r.width) * this.iw;
    this.mouse.y = ((e.clientY - r.top) / r.height) * this.ih;
    this.mouse.inside = this.mouse.x >= 0 && this.mouse.y >= 0 && this.mouse.x < this.iw && this.mouse.y < this.ih;
  }

  isDown(code) { return this.down.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  wasReleased(code) { return this.released.has(code); }

  /** Clear edge state. Called by the loop after each update step. */
  clearEdges() {
    this.pressed.clear();
    this.released.clear();
    this.btnPressed[0] = this.btnPressed[1] = this.btnPressed[2] = false;
    this.btnReleased[0] = this.btnReleased[1] = this.btnReleased[2] = false;
    this.wheel = 0;
    this.anyPressed = false;
  }

  reset() {
    this.down.clear();
    this.buttons[0] = this.buttons[1] = this.buttons[2] = false;
    this.clearEdges();
  }
}
