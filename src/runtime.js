// The BambooGrove canvas runtime: a small p5.js-style wrapper around the
// HTML5 Canvas 2D API plus turtle-style movement, input, and timing state.
// Transpiled BambooScript code only ever talks to the outside world through
// an instance of this class (see transpiler.js) — it never touches
// `window`/`document` directly.
import { BambooRuntimeError } from "./errors.js";

const MAX_ITERATIONS_PER_CALL = 300000;
const MAX_MS_PER_CALL = 3000;
const MAX_RANGE_LENGTH = 1000000;

function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export class BambooRuntime {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = canvas.width;
    this.height = canvas.height;

    this.strokeColor = "rgb(0, 0, 0)";
    this.fillColor = "rgb(255, 255, 255)";
    this.strokeOn = true;
    this.fillOn = true;

    this.turtleX = this.width / 2;
    this.turtleY = this.height / 2;
    this.heading = 0; // 0 = up (north), clockwise-positive, like a compass
    this.penDown = true;

    this.mouseX = 0;
    this.mouseY = 0;
    this._mousePressed = false;
    this.keyPressed = null;

    this.frameCount = 0;
    this.looping = true;
    this.onLoopResume = null;

    this.__line = 0;
    this.__iterCount = 0;
    this.__guardStart = 0;

    this._onMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouseX = Math.round(e.clientX - rect.left);
      this.mouseY = Math.round(e.clientY - rect.top);
    };
    this._onMouseDown = () => { this._mousePressed = true; };
    this._onMouseUp = () => { this._mousePressed = false; };
    this._onKeyDown = (e) => { this.keyPressed = e.key; };
    this._onKeyUp = () => { this.keyPressed = null; };

    canvas.addEventListener("mousemove", this._onMouseMove);
    canvas.addEventListener("mousedown", this._onMouseDown);
    canvas.addEventListener("mouseup", this._onMouseUp);
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", this._onKeyDown);
      window.addEventListener("keyup", this._onKeyUp);
    }
  }

  dispose() {
    this.canvas.removeEventListener("mousemove", this._onMouseMove);
    this.canvas.removeEventListener("mousedown", this._onMouseDown);
    this.canvas.removeEventListener("mouseup", this._onMouseUp);
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", this._onKeyDown);
      window.removeEventListener("keyup", this._onKeyUp);
    }
  }

  resetGuard() {
    this.__iterCount = 0;
    this.__guardStart = performance.now();
  }

  // --- Internal helpers used by generated code (see transpiler.js) ---

  __truthy(v) {
    if (Array.isArray(v)) return v.length > 0;
    return Boolean(v) && !(typeof v === "number" && Number.isNaN(v));
  }

  __not(v) {
    return !this.__truthy(v);
  }

  __and(left, right) {
    const v = left();
    return this.__truthy(v) ? right() : v;
  }

  __or(left, right) {
    const v = left();
    return this.__truthy(v) ? v : right();
  }

  __tick(line) {
    this.__iterCount++;
    if (this.__iterCount > MAX_ITERATIONS_PER_CALL) {
      throw new BambooRuntimeError(
        "This loop ran too many times without finishing. Check for an infinite loop.",
        line
      );
    }
    if (this.__iterCount % 5000 === 0 && performance.now() - this.__guardStart > MAX_MS_PER_CALL) {
      throw new BambooRuntimeError(
        "This took too long to run. Check for an infinite loop.",
        line
      );
    }
  }

  __iter(value, line) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") return Array.from(value);
    throw new BambooRuntimeError(
      `Expected a list or range(...) after 'in', but got ${describeType(value)}.`,
      line
    );
  }

  __index(obj, idx, line) {
    if (!Array.isArray(obj) && typeof obj !== "string") {
      throw new BambooRuntimeError(`Can't index into ${describeType(obj)} — expected a list.`, line);
    }
    if (typeof idx !== "number" || !Number.isInteger(idx)) {
      throw new BambooRuntimeError("A list index must be a whole number.", line);
    }
    const i = idx < 0 ? obj.length + idx : idx;
    if (i < 0 || i >= obj.length) {
      throw new BambooRuntimeError(`List index ${idx} is out of range (list has ${obj.length} item(s)).`, line);
    }
    return obj[i];
  }

  __setIndex(obj, idx, value, line) {
    if (!Array.isArray(obj)) {
      throw new BambooRuntimeError(`Can't assign into ${describeType(obj)} — expected a list.`, line);
    }
    if (typeof idx !== "number" || !Number.isInteger(idx)) {
      throw new BambooRuntimeError("A list index must be a whole number.", line);
    }
    const i = idx < 0 ? obj.length + idx : idx;
    if (i < 0 || i >= obj.length) {
      throw new BambooRuntimeError(`List index ${idx} is out of range (list has ${obj.length} item(s)).`, line);
    }
    obj[i] = value;
    return value;
  }

  range(a, b, c) {
    let start, stop, step;
    if (b === undefined) { start = 0; stop = a; step = 1; }
    else if (c === undefined) { start = a; stop = b; step = 1; }
    else { start = a; stop = b; step = c; }

    if (step === 0) {
      throw new BambooRuntimeError("range() step can't be 0.", this.__line);
    }
    const length = Math.max(0, Math.ceil((stop - start) / step));
    if (length > MAX_RANGE_LENGTH) {
      throw new BambooRuntimeError(`range(...) would produce ${length} items, which is too many.`, this.__line);
    }
    const out = new Array(length);
    for (let i = 0, v = start; i < length; i++, v += step) out[i] = v;
    return out;
  }

  // --- Drawing primitives (spec 3.3) ---

  background(r, g, b) {
    this.ctx.fillStyle = `rgb(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)})`;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  stroke(r, g, b) {
    this.strokeColor = `rgb(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)})`;
    this.strokeOn = true;
  }

  fill(r, g, b) {
    this.fillColor = `rgb(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)})`;
    this.fillOn = true;
  }

  no_fill() { this.fillOn = false; }
  no_stroke() { this.strokeOn = false; }

  line(x1, y1, x2, y2) {
    if (!this.strokeOn) return;
    const ctx = this.ctx;
    ctx.strokeStyle = this.strokeColor;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  rect(x, y, w, h) {
    const ctx = this.ctx;
    if (this.fillOn) { ctx.fillStyle = this.fillColor; ctx.fillRect(x, y, w, h); }
    if (this.strokeOn) { ctx.strokeStyle = this.strokeColor; ctx.strokeRect(x, y, w, h); }
  }

  circle(x, y, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, Math.abs(r), 0, Math.PI * 2);
    if (this.fillOn) { ctx.fillStyle = this.fillColor; ctx.fill(); }
    if (this.strokeOn) { ctx.strokeStyle = this.strokeColor; ctx.stroke(); }
  }

  point(x, y) {
    if (!this.strokeOn) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = this.strokeColor;
    ctx.fill();
  }

  text(str, x, y) {
    const ctx = this.ctx;
    ctx.fillStyle = this.fillColor;
    ctx.font = "16px sans-serif";
    ctx.fillText(String(str), x, y);
  }

  // --- Turtle-style movement (spec 3.3) ---

  forward(distance) {
    const rad = (this.heading * Math.PI) / 180;
    const nx = this.turtleX + Math.sin(rad) * distance;
    const ny = this.turtleY - Math.cos(rad) * distance;
    if (this.penDown) this.line(this.turtleX, this.turtleY, nx, ny);
    this.turtleX = nx;
    this.turtleY = ny;
  }

  turn(degrees) {
    this.heading = ((this.heading + degrees) % 360 + 360) % 360;
  }

  right(degrees) { this.turn(degrees); }
  left(degrees) { this.turn(-degrees); }

  pen_up() { this.penDown = false; }
  pen_down() { this.penDown = true; }

  go_to(x, y) {
    if (this.penDown) this.line(this.turtleX, this.turtleY, x, y);
    this.turtleX = x;
    this.turtleY = y;
  }

  home() {
    this.go_to(this.width / 2, this.height / 2);
    this.heading = 0;
  }

  // --- Input (spec 3.3) ---

  is_pressed() { return this._mousePressed; }

  // --- Timing/state (spec 3.3) ---

  no_loop() { this.looping = false; }

  loop() {
    const wasStopped = !this.looping;
    this.looping = true;
    if (wasStopped && typeof this.onLoopResume === "function") this.onLoopResume();
  }
}

function describeType(v) {
  if (v === null || v === undefined) return "nothing";
  if (Array.isArray(v)) return "a list";
  if (typeof v === "number") return "a number";
  if (typeof v === "string") return "a string";
  if (typeof v === "boolean") return "a boolean";
  return typeof v;
}
