// Player input -> intents. AI controllers produce the same intents.

const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const SLOT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];

export class PlayerController {
  constructor(input, camera) {
    this.input = input;
    this.camera = camera;
    this.blockUse = false; // set after a menu click so the held button doesn't fire
  }

  think(f) {
    const inp = this.input;
    const it = f.intents;
    const any = (codes) => codes.some((c) => inp.isDown(c));
    it.moveX = (any(RIGHT) ? 1 : 0) - (any(LEFT) ? 1 : 0);
    it.moveY = (any(DOWN) ? 1 : 0) - (any(UP) ? 1 : 0);
    it.aimX = this.camera.toWorldX(inp.mouse.x);
    it.aimY = this.camera.toWorldY(inp.mouse.y);
    if (this.blockUse && !inp.buttons[0]) this.blockUse = false;
    it.use = inp.buttons[0] && !this.blockUse;
    it.usePressed = inp.btnPressed[0] && !this.blockUse;
    it.useReleased = inp.btnReleased[0];
    it.stance = inp.buttons[2];
    it.special = inp.isDown('KeyQ');
    it.specialPressed = inp.wasPressed('KeyQ');
    it.dash = inp.wasPressed('Space');
    it.pickup = inp.wasPressed('KeyE');
    it.swapTo = -1;
    for (let i = 0; i < f.slots.length && i < SLOT_KEYS.length; i++) {
      if (inp.wasPressed(SLOT_KEYS[i])) it.swapTo = i;
    }
    it.swapStep = inp.wheel;
  }
}
