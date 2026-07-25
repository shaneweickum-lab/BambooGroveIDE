// The BambooGrove canvas runtime: a small p5.js-style wrapper around the
// HTML5 Canvas 2D API plus turtle-style movement, input, and timing state.
// Transpiled BambooScript code only ever talks to the outside world through
// an instance of this class (see transpiler.js) — it never touches
// `window`/`document` directly.
//
// Two API styles coexist by design (spec 3.6): the original snake_case
// turtle-graphics set (forward, turn, pen_up, no_fill, ...) and a p5.js
// name-compatible layer (ellipse, translate, map, mousePressed, ...) added
// alongside it. Mode-setter functions (ellipseMode, rectMode, colorMode,
// textAlign) take lowercase strings ("center", "corner", "hsb", ...)
// instead of named constants, to avoid inventing a large constants surface
// beyond the handful (PI, TWO_PI, ...) the spec actually calls for.
import { RuntimeBase } from "./runtime-base.js";
import { BambooRuntimeError } from "./errors.js";

const CURSOR_ALIASES = {
  ARROW: "default", CROSS: "crosshair", HAND: "pointer",
  MOVE: "move", TEXT: "text", WAIT: "wait",
};

const STYLE_KEYS = [
  "strokeColor", "fillColor", "strokeOn", "fillOn",
  "strokeWeightVal", "strokeCapVal", "strokeJoinVal",
  "ellipseModeVal", "rectModeVal",
  "colorModeVal", "_max",
  "textSizeVal", "textAlignH", "textAlignV", "textFontVal",
];

function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

// Standard HSB(HSV) -> RGB conversion. h, s, v are normalized to [0, 1].
function hsbToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

export class BambooRuntime extends RuntimeBase {
  constructor(canvas) {
    super();
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = canvas.width;
    this.height = canvas.height;

    this.strokeColor = "rgb(0, 0, 0)";
    this.fillColor = "rgb(255, 255, 255)";
    this.strokeOn = true;
    this.fillOn = true;
    this.strokeWeightVal = 1;
    this.strokeCapVal = "round";
    this.strokeJoinVal = "miter";
    this.ellipseModeVal = "center";
    this.rectModeVal = "corner";
    this.colorModeVal = "rgb";
    this._max = [255, 255, 255, 255];
    this._styleStack = [];
    this._shapeVertices = null;

    this.textSizeVal = 16;
    this.textAlignH = "left";
    this.textAlignV = "alphabetic";
    this.textFontVal = "sans-serif";

    this.turtleX = this.width / 2;
    this.turtleY = this.height / 2;
    this.heading = 0; // 0 = up (north), clockwise-positive, like a compass
    this.penDown = true;

    this.mouseX = 0;
    this.mouseY = 0;
    this.pmouseX = 0;
    this.pmouseY = 0;
    this._mousePressed = false;
    this.keyPressed = null;
    this._keyIsPressed = false;

    this.frameCount = 0;
    this.looping = true;
    this.onLoopResume = null;
    this.onRedrawRequest = null;
    this.frameRateTarget = null;

    this._onMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      this.pmouseX = this.mouseX;
      this.pmouseY = this.mouseY;
      this.mouseX = Math.round(e.clientX - rect.left);
      this.mouseY = Math.round(e.clientY - rect.top);
    };
    this._onMouseDown = () => { this._mousePressed = true; };
    this._onMouseUp = () => { this._mousePressed = false; };
    this._onKeyDown = (e) => { this.keyPressed = e.key; this._keyIsPressed = true; };
    this._onKeyUp = () => { this.keyPressed = null; this._keyIsPressed = false; };

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

  // --- Environment (spec 3.6) ---

  get windowWidth() { return typeof window !== "undefined" ? window.innerWidth : this.width; }
  get windowHeight() { return typeof window !== "undefined" ? window.innerHeight : this.height; }
  get mouseIsPressed() { return this._mousePressed; }
  get keyIsPressed() { return this._keyIsPressed; }

  // --- Constants (spec 3.6) ---

  get PI() { return Math.PI; }
  get TWO_PI() { return Math.PI * 2; }
  get HALF_PI() { return Math.PI / 2; }
  get QUARTER_PI() { return Math.PI / 4; }
  get DEGREES() { return "degrees"; }
  get RADIANS() { return "radians"; }

  // --- Color (spec 3.3 + 3.6) ---

  _colorToRgba(c0, c1, c2, c3) {
    const [m0, m1, m2, m3] = this._max;
    const a = c3 === undefined ? m3 : c3;
    let r, g, b;
    if (this.colorModeVal === "hsb") {
      let h = (c0 / m0) % 1;
      if (h < 0) h += 1;
      [r, g, b] = hsbToRgb(h, clamp01(c1 / m1), clamp01(c2 / m2));
      r *= 255; g *= 255; b *= 255;
    } else {
      r = (c0 / m0) * 255;
      g = (c1 / m1) * 255;
      b = (c2 / m2) * 255;
    }
    const alpha = clamp01(a / m3);
    return `rgba(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)}, ${alpha})`;
  }

  _normalizeColorArgs(args) {
    let c0, c1, c2, c3;
    if (args.length === 1 && Array.isArray(args[0])) {
      [c0, c1, c2, c3] = args[0];
    } else if (args.length === 1) {
      c0 = c1 = c2 = args[0];
    } else if (args.length === 2) {
      c0 = c1 = c2 = args[0];
      c3 = args[1];
    } else {
      [c0, c1, c2, c3] = args;
    }
    return this._colorToRgba(c0, c1, c2, c3);
  }

  colorMode(mode, max1, max2, max3, maxA) {
    this.colorModeVal = String(mode).toLowerCase();
    if (max1 === undefined) {
      this._max = this.colorModeVal === "hsb" ? [360, 100, 100, 255] : [255, 255, 255, 255];
    } else if (max2 === undefined) {
      this._max = [max1, max1, max1, max1];
    } else {
      this._max = [max1, max2, max3 ?? this._max[2], maxA ?? this._max[3]];
    }
  }

  blendMode(mode) {
    this.ctx.globalCompositeOperation = mode;
  }

  color(...args) {
    let c0, c1, c2, c3;
    if (args.length === 1 && Array.isArray(args[0])) {
      [c0, c1, c2, c3] = args[0];
    } else if (args.length === 1) {
      c0 = c1 = c2 = args[0];
    } else if (args.length === 2) {
      c0 = c1 = c2 = args[0];
      c3 = args[1];
    } else {
      [c0, c1, c2, c3] = args;
    }
    return [c0, c1, c2, c3 === undefined ? this._max[3] : c3];
  }

  red(c) { return c[0]; }
  green(c) { return c[1]; }
  blue(c) { return c[2]; }
  alpha(c) { return c[3]; }

  lerpColor(c1, c2, amt) {
    return [0, 1, 2, 3].map((i) => this.lerp(c1[i], c2[i], amt));
  }

  // --- Drawing primitives (spec 3.3) ---

  background(...args) {
    const rgba = this._normalizeColorArgs(args);
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = rgba;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  clear() {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  stroke(...args) {
    this.strokeColor = this._normalizeColorArgs(args);
    this.strokeOn = true;
  }

  fill(...args) {
    this.fillColor = this._normalizeColorArgs(args);
    this.fillOn = true;
  }

  no_fill() { this.fillOn = false; }
  no_stroke() { this.strokeOn = false; }
  noFill() { this.fillOn = false; }
  noStroke() { this.strokeOn = false; }

  strokeWeight(w) { this.strokeWeightVal = w; }
  strokeCap(cap) { this.strokeCapVal = cap; }
  strokeJoin(join) { this.strokeJoinVal = join; }
  noSmooth() { this.ctx.imageSmoothingEnabled = false; }
  smooth() { this.ctx.imageSmoothingEnabled = true; }

  _applyStroke() {
    const ctx = this.ctx;
    ctx.strokeStyle = this.strokeColor;
    ctx.lineWidth = this.strokeWeightVal;
    ctx.lineCap = this.strokeCapVal;
    ctx.lineJoin = this.strokeJoinVal;
  }

  line(x1, y1, x2, y2) {
    if (!this.strokeOn) return;
    const ctx = this.ctx;
    this._applyStroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  _rectBounds(a, b, c, d) {
    switch (this.rectModeVal) {
      case "center": return { x: a - c / 2, y: b - d / 2, w: c, h: d };
      case "corners": return { x: Math.min(a, c), y: Math.min(b, d), w: Math.abs(c - a), h: Math.abs(d - b) };
      case "radius": return { x: a - c, y: b - d, w: c * 2, h: d * 2 };
      case "corner":
      default: return { x: a, y: b, w: c, h: d };
    }
  }

  rectMode(mode) { this.rectModeVal = String(mode).toLowerCase(); }

  rect(a, b, c, d) {
    const { x, y, w, h } = this._rectBounds(a, b, c, d);
    const ctx = this.ctx;
    if (this.fillOn) { ctx.fillStyle = this.fillColor; ctx.fillRect(x, y, w, h); }
    if (this.strokeOn) { this._applyStroke(); ctx.strokeRect(x, y, w, h); }
  }

  square(x, y, s) { this.rect(x, y, s, s); }

  circle(x, y, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, Math.abs(r), 0, Math.PI * 2);
    if (this.fillOn) { ctx.fillStyle = this.fillColor; ctx.fill(); }
    if (this.strokeOn) { this._applyStroke(); ctx.stroke(); }
  }

  ellipseMode(mode) { this.ellipseModeVal = String(mode).toLowerCase(); }

  _ellipseRect(a, b, c, d) {
    switch (this.ellipseModeVal) {
      case "corner": return { cx: a + c / 2, cy: b + d / 2, rx: c / 2, ry: d / 2 };
      case "corners": return { cx: (a + c) / 2, cy: (b + d) / 2, rx: Math.abs(c - a) / 2, ry: Math.abs(d - b) / 2 };
      case "radius": return { cx: a, cy: b, rx: c, ry: d };
      case "center":
      default: return { cx: a, cy: b, rx: c / 2, ry: d / 2 };
    }
  }

  ellipse(a, b, c, d) {
    const { cx, cy, rx, ry } = this._ellipseRect(a, b, c, d);
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
    if (this.fillOn) { ctx.fillStyle = this.fillColor; ctx.fill(); }
    if (this.strokeOn) { this._applyStroke(); ctx.stroke(); }
  }

  arc(a, b, c, d, start, stop) {
    const { cx, cy, rx, ry } = this._ellipseRect(a, b, c, d);
    const ctx = this.ctx;
    if (this.fillOn) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, start, stop);
      ctx.closePath();
      ctx.fillStyle = this.fillColor;
      ctx.fill();
    }
    if (this.strokeOn) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, start, stop);
      this._applyStroke();
      ctx.stroke();
    }
  }

  _polygon(coords) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(coords[0], coords[1]);
    for (let i = 2; i < coords.length; i += 2) ctx.lineTo(coords[i], coords[i + 1]);
    ctx.closePath();
    if (this.fillOn) { ctx.fillStyle = this.fillColor; ctx.fill(); }
    if (this.strokeOn) { this._applyStroke(); ctx.stroke(); }
  }

  triangle(x1, y1, x2, y2, x3, y3) { this._polygon([x1, y1, x2, y2, x3, y3]); }
  quad(x1, y1, x2, y2, x3, y3, x4, y4) { this._polygon([x1, y1, x2, y2, x3, y3, x4, y4]); }

  // --- Curves and custom shapes (spec 3.6 Phase 2) ---

  bezier(x1, y1, x2, y2, x3, y3, x4, y4) {
    if (!this.strokeOn) return;
    const ctx = this.ctx;
    this._applyStroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(x2, y2, x3, y3, x4, y4);
    ctx.stroke();
  }

  beginShape() {
    this._shapeVertices = [];
  }

  vertex(x, y) {
    if (!this._shapeVertices) {
      throw new BambooRuntimeError("vertex() can only be called between beginShape() and endShape().", this.__line);
    }
    this._shapeVertices.push([x, y]);
  }

  // mode: "close" closes the shape back to its first vertex (a filled
  // polygon); anything else (the default) leaves it open, like a polyline.
  endShape(mode) {
    const verts = this._shapeVertices;
    if (!verts) {
      throw new BambooRuntimeError("endShape() needs a matching beginShape() first.", this.__line);
    }
    this._shapeVertices = null;
    if (verts.length === 0) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(verts[0][0], verts[0][1]);
    for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i][0], verts[i][1]);
    if (mode === "close") ctx.closePath();
    if (this.fillOn) { ctx.fillStyle = this.fillColor; ctx.fill(); }
    if (this.strokeOn) { this._applyStroke(); ctx.stroke(); }
  }

  point(x, y) {
    if (!this.strokeOn) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, this.strokeWeightVal / 2), 0, Math.PI * 2);
    ctx.fillStyle = this.strokeColor;
    ctx.fill();
  }

  // --- Typography (spec 3.3 + 3.6) ---

  textSize(size) { this.textSizeVal = size; }
  textAlign(h, v) {
    this.textAlignH = h;
    if (v !== undefined) this.textAlignV = v;
  }
  textFont(font) { this.textFontVal = font; }

  text(str, x, y) {
    const ctx = this.ctx;
    ctx.fillStyle = this.fillColor;
    ctx.font = `${this.textSizeVal}px ${this.textFontVal}`;
    ctx.textAlign = this.textAlignH;
    ctx.textBaseline = this.textAlignV;
    ctx.fillText(String(str), x, y);
  }

  // --- Transform (spec 3.6) ---

  push() {
    this.ctx.save();
    this._styleStack.push(STYLE_KEYS.map((k) => this[k]));
  }

  pop() {
    const snap = this._styleStack.pop();
    if (snap) STYLE_KEYS.forEach((k, i) => { this[k] = snap[i]; });
    this.ctx.restore();
  }

  translate(x, y) { this.ctx.translate(x, y); }
  rotate(angle) { this.ctx.rotate(angle); }
  scale(x, y) { this.ctx.scale(x, y === undefined ? x : y); }
  resetMatrix() { this.ctx.setTransform(1, 0, 0, 1, 0, 0); }

  // --- Rendering (spec 3.6) ---

  createCanvas(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.width = w;
    this.height = h;
    this.turtleX = w / 2;
    this.turtleY = h / 2;
    this.heading = 0;
  }

  resizeCanvas(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.width = w;
    this.height = h;
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

  cursor(type) {
    if (!this.canvas.style) return;
    this.canvas.style.cursor = CURSOR_ALIASES[type] || type;
  }

  noCursor() {
    if (!this.canvas.style) return;
    this.canvas.style.cursor = "none";
  }

  // --- Timing/state (spec 3.3 + 3.6) ---

  no_loop() { this.looping = false; }
  noLoop() { this.no_loop(); }

  loop() {
    const wasStopped = !this.looping;
    this.looping = true;
    if (wasStopped && typeof this.onLoopResume === "function") this.onLoopResume();
  }

  isLooping() { return this.looping; }

  redraw() {
    if (typeof this.onRedrawRequest === "function") this.onRedrawRequest();
  }

  frameRate(fps) {
    if (fps === undefined) return this.frameRateTarget ?? 60;
    this.frameRateTarget = fps;
    return undefined;
  }

  // --- Math (spec 3.6) ---

  abs(n) { return Math.abs(n); }
  ceil(n) { return Math.ceil(n); }
  floor(n) { return Math.floor(n); }
  round(n) { return Math.round(n); }
  sq(n) { return n * n; }
  sqrt(n) { return Math.sqrt(n); }
  pow(n, e) { return Math.pow(n, e); }
  sin(a) { return Math.sin(a); }
  cos(a) { return Math.cos(a); }
  tan(a) { return Math.tan(a); }
  radians(deg) { return (deg * Math.PI) / 180; }
  degrees(rad) { return (rad * 180) / Math.PI; }

  constrain(n, low, high) { return Math.min(Math.max(n, low), high); }
  dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }
  lerp(start, stop, amt) { return start + (stop - start) * amt; }

  map(value, start1, stop1, start2, stop2, withinBounds) {
    const result = start2 + ((value - start1) / (stop1 - start1)) * (stop2 - start2);
    if (!withinBounds) return result;
    return start2 < stop2 ? this.constrain(result, start2, stop2) : this.constrain(result, stop2, start2);
  }

  max(...args) {
    const values = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    return Math.max(...values);
  }

  min(...args) {
    const values = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    return Math.min(...values);
  }
}
