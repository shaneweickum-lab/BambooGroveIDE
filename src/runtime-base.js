// Shared logic between BambooRuntime (Canvas tab) and TerminalRuntime
// (Terminal tab, spec 3.6): Python-ish truthiness/boolean-ops, the loop
// guard, list/range helpers, print()'s value formatting, the seedable
// random generator, Perlin noise, vectors, and data conversion (spec 3.6
// Phase 2). Everything here is mode-agnostic — it never touches a canvas
// or the DOM, so all of it works the same in both Canvas and Terminal mode.
import { BambooRuntimeError } from "./errors.js";
import { BambooVector } from "./vector.js";

const MAX_ITERATIONS_PER_CALL = 300000;
const MAX_MS_PER_CALL = 3000;
const MAX_RANGE_LENGTH = 1000000;

const PERLIN_YWRAPB = 4;
const PERLIN_YWRAP = 1 << PERLIN_YWRAPB;
const PERLIN_ZWRAPB = 8;
const PERLIN_ZWRAP = 1 << PERLIN_ZWRAPB;
const PERLIN_SIZE = 4095;

function scaledCosine(i) {
  return 0.5 * (1.0 - Math.cos(i * Math.PI));
}

function describeType(v) {
  if (v === null || v === undefined) return "nothing";
  if (Array.isArray(v)) return "a list";
  if (typeof v === "number") return "a number";
  if (typeof v === "string") return "a string";
  if (typeof v === "boolean") return "a boolean";
  return typeof v;
}

export class RuntimeBase {
  constructor() {
    this.__line = 0;
    this.__iterCount = 0;
    this.__guardStart = 0;
    this.onPrint = null;

    this._prngState = null; // null = unseeded (use Math.random())
    this._perlin = null;
    this._perlinOctaves = 4;
    this._perlinAmpFalloff = 0.5;
  }

  resetGuard() {
    this.__iterCount = 0;
    this.__guardStart = performance.now();
  }

  // --- Booleans / control-flow helpers used by generated code ---

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

  // Terminal mode (spec 3.6) generates every function as async so input()
  // can genuinely pause execution — 'and'/'or' need an async-aware variant
  // so a lazily-evaluated operand containing an awaited call still
  // short-circuits correctly instead of comparing a pending Promise.
  async __andAsync(left, right) {
    const v = await left();
    return this.__truthy(v) ? await right() : v;
  }

  async __orAsync(left, right) {
    const v = await left();
    return this.__truthy(v) ? v : await right();
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

  // --- Random + Perlin noise (spec 3.6 Math > Random / Noise) ---

  randomSeed(seed) {
    this._prngState = (seed >>> 0) || 1;
  }

  _nextRandom() {
    if (this._prngState === null) return Math.random();
    let t = (this._prngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  random(a, b) {
    if (Array.isArray(a)) return a[Math.floor(this._nextRandom() * a.length)];
    if (a === undefined) return this._nextRandom();
    if (b === undefined) return this._nextRandom() * a;
    return a + this._nextRandom() * (b - a);
  }

  // Classic Perlin noise, ported from p5.js's own implementation (itself
  // ported from Processing): a lazily-built table of random values sampled
  // with cosine interpolation across `_perlinOctaves` octaves. Reuses the
  // same seedable PRNG as random(), so noiseSeed() makes it repeatable too.
  noise(x, y = 0, z = 0) {
    if (!this._perlin) {
      this._perlin = new Array(PERLIN_SIZE + 1);
      for (let i = 0; i < PERLIN_SIZE + 1; i++) this._perlin[i] = this._nextRandom();
    }
    if (x < 0) x = -x;
    if (y < 0) y = -y;
    if (z < 0) z = -z;

    let xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let xf = x - xi, yf = y - yi, zf = z - zi;
    let r = 0;
    let ampl = 0.5;

    for (let o = 0; o < this._perlinOctaves; o++) {
      let of_ = xi + (yi << PERLIN_YWRAPB) + (zi << PERLIN_ZWRAPB);

      const rxf = scaledCosine(xf);
      const ryf = scaledCosine(yf);

      let n1 = this._perlin[of_ & PERLIN_SIZE];
      n1 += rxf * (this._perlin[(of_ + 1) & PERLIN_SIZE] - n1);
      let n2 = this._perlin[(of_ + PERLIN_YWRAP) & PERLIN_SIZE];
      n2 += rxf * (this._perlin[(of_ + PERLIN_YWRAP + 1) & PERLIN_SIZE] - n2);
      n1 += ryf * (n2 - n1);

      of_ += PERLIN_ZWRAP;
      n2 = this._perlin[of_ & PERLIN_SIZE];
      n2 += rxf * (this._perlin[(of_ + 1) & PERLIN_SIZE] - n2);
      let n3 = this._perlin[(of_ + PERLIN_YWRAP) & PERLIN_SIZE];
      n3 += rxf * (this._perlin[(of_ + PERLIN_YWRAP + 1) & PERLIN_SIZE] - n3);
      n2 += ryf * (n3 - n2);

      n1 += scaledCosine(zf) * (n2 - n1);

      r += n1 * ampl;
      ampl *= this._perlinAmpFalloff;
      xi <<= 1; xf *= 2;
      yi <<= 1; yf *= 2;
      zi <<= 1; zf *= 2;

      if (xf >= 1.0) { xi++; xf--; }
      if (yf >= 1.0) { yi++; yf--; }
      if (zf >= 1.0) { zi++; zf--; }
    }
    return r;
  }

  noiseDetail(lod, falloff) {
    if (lod > 0) this._perlinOctaves = lod;
    if (falloff !== undefined && falloff > 0) this._perlinAmpFalloff = falloff;
  }

  noiseSeed(seed) {
    this.randomSeed(seed);
    this._perlin = null; // rebuilt lazily from the newly-seeded PRNG
  }

  // --- Vector (spec 3.6 Math > p5.Vector) ---

  createVector(x = 0, y = 0, z = 0) {
    return new BambooVector(x, y, z);
  }

  // --- Data conversion (spec 3.6 Data > Conversion) ---

  int(v) {
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string") {
      const n = parseInt(v, 10);
      return Number.isNaN(n) ? 0 : n;
    }
    return Math.trunc(v);
  }

  float(v) {
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string") {
      const n = parseFloat(v);
      return Number.isNaN(n) ? 0 : n;
    }
    return Number(v);
  }

  str(v) {
    return this._stringify(v);
  }

  boolean(v) {
    return this.__truthy(v);
  }

  // --- print() (spec 3.6 Terminal tab; also usable from Canvas mode as a
  // debug console — see docs/SPEC.md) ---

  _stringify(v) {
    if (v === null || v === undefined) return "None";
    if (typeof v === "boolean") return v ? "True" : "False";
    if (Array.isArray(v)) return `[${v.map((x) => this._stringifyRepr(x)).join(", ")}]`;
    return String(v);
  }

  _stringifyRepr(v) {
    if (typeof v === "string") return `'${v}'`;
    return this._stringify(v);
  }

  print(...args) {
    const line = args.map((a) => this._stringify(a)).join(" ");
    if (typeof this.onPrint === "function") this.onPrint(line);
  }

  // Default: only TerminalRuntime overrides this with a real
  // pause-and-wait implementation. Canvas-mode scripts get this friendly
  // redirect instead of a confusing crash.
  input() {
    throw new BambooRuntimeError(
      "input() only works in Terminal mode. Switch to the Terminal tab to use it.",
      this.__line
    );
  }
}
