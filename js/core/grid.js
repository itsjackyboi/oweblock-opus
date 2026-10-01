// Uniform spatial hash over a fixed world rectangle. Rebuilt (clear + insert)
// every update. Objects are inserted into every cell their bounding circle touches;
// queries dedupe with a per-query stamp so nothing is allocated.

export class SpatialGrid {
  constructor(worldW, worldH, cell) {
    this.cell = cell;
    this.cols = Math.max(1, Math.ceil(worldW / cell));
    this.rows = Math.max(1, Math.ceil(worldH / cell));
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
    this.used = []; // indices of non-empty cells, for fast clear
    this.stamp = 1;
  }

  clear() {
    for (let i = 0; i < this.used.length; i++) this.cells[this.used[i]].length = 0;
    this.used.length = 0;
  }

  insert(obj, x, y, r = 0) {
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r) / c));
    const y0 = Math.max(0, Math.floor((y - r) / c));
    const x1 = Math.min(this.cols - 1, Math.floor((x + r) / c));
    const y1 = Math.min(this.rows - 1, Math.floor((y + r) / c));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const i = cy * this.cols + cx;
        const bucket = this.cells[i];
        if (bucket.length === 0) this.used.push(i);
        bucket.push(obj);
      }
    }
  }

  /**
   * Collect objects whose cells overlap the circle (x, y, r) into `out` (cleared first).
   * Callers do their own exact distance test.
   */
  query(x, y, r, out) {
    out.length = 0;
    const stamp = ++this.stamp;
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r) / c));
    const y0 = Math.max(0, Math.floor((y - r) / c));
    const x1 = Math.min(this.cols - 1, Math.floor((x + r) / c));
    const y1 = Math.min(this.rows - 1, Math.floor((y + r) / c));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const bucket = this.cells[cy * this.cols + cx];
        for (let k = 0; k < bucket.length; k++) {
          const o = bucket[k];
          if (o._gridStamp === stamp) continue;
          o._gridStamp = stamp;
          out.push(o);
        }
      }
    }
    return out;
  }

  get usedCells() { return this.used.length; }
}
