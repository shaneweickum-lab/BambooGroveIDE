// Shared logic between BambooRuntime (Canvas tab) and TerminalRuntime
// (Terminal tab, spec 3.6): Python-ish truthiness/boolean-ops, the loop
// guard, list/range helpers, print()'s value formatting, the seedable
// random generator, Perlin noise, vectors, and data conversion (spec 3.6
// Phase 2). Everything here is mode-agnostic — it never touches a canvas
// or the DOM, so all of it works the same in both Canvas and Terminal mode.
import { BambooRuntimeError } from "./errors.js";
import { BambooVector } from "./vector.js";
import { PYTHON_STRING_METHODS_IMPL } from "./pystrings.js";
import { buildStdlib } from "./stdlib/index.js";
import { PyFloat, unboxNum, formatPyFloat } from "./pynum.js";

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
  if (v instanceof PyFloat) return "a number";
  if (typeof v === "number") return "a number";
  if (typeof v === "string") return "a string";
  if (typeof v === "boolean") return "a boolean";
  return typeof v;
}

// Python's `==` compares by VALUE, not by reference/type-strictness: a
// PyFloat unboxes before comparing (so `2.0 == 2` is True, matching
// Python), and lists compare element-by-element recursively (so
// `[1, 2] == [1, 2]` is True, and `[1, 2] in [[1, 2], [3, 4]]` — spec
// 3.2's `in` — works too). Backs both `__eq` (the `==`/`!=` dispatcher,
// spec 6.8) and `__contains`.
function pyEquals(a, b) {
  const av = unboxNum(a);
  const bv = unboxNum(b);
  if (Array.isArray(av) && Array.isArray(bv)) {
    return av.length === bv.length && av.every((el, i) => pyEquals(el, bv[i]));
  }
  return av === bv;
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

    // try/except (spec 3.2): stack of currently-being-handled exceptions,
    // pushed/popped around a handler's own body — backs bare `raise`
    // (re-raise) inside an except block. Reset fresh every Run along with
    // everything else above.
    this.__excStack = [];

    // Backs `import math`/`import random`/etc. (spec 3.2) — built once per
    // runtime instance, same lifecycle as _prngState/_perlin above, so any
    // stateful stdlib mock (a future virtual filesystem for `os`, etc.)
    // resets automatically every Run along with everything else.
    this.__stdlib = buildStdlib(this);
  }

  resetGuard() {
    this.__iterCount = 0;
    this.__guardStart = performance.now();
  }

  // --- Booleans / control-flow helpers used by generated code ---

  __truthy(v) {
    if (Array.isArray(v)) return v.length > 0;
    // Unbox a PyFloat first — plain JS `Boolean(...)` on any object is
    // always true regardless of its value, so a boxed 0.0 would otherwise
    // (wrongly) come out truthy.
    const raw = unboxNum(v);
    return Boolean(raw) && !(typeof raw === "number" && Number.isNaN(raw));
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
      throw new BambooRuntimeError(`Can't index into ${describeType(obj)} — expected a list.`, line, "TypeError");
    }
    if (typeof idx !== "number" || !Number.isInteger(idx)) {
      throw new BambooRuntimeError("A list index must be a whole number.", line, "TypeError");
    }
    const i = idx < 0 ? obj.length + idx : idx;
    if (i < 0 || i >= obj.length) {
      throw new BambooRuntimeError(
        `List index ${idx} is out of range (list has ${obj.length} item(s)).`,
        line,
        "IndexError"
      );
    }
    return obj[i];
  }

  __setIndex(obj, idx, value, line) {
    if (!Array.isArray(obj)) {
      throw new BambooRuntimeError(`Can't assign into ${describeType(obj)} — expected a list.`, line, "TypeError");
    }
    if (typeof idx !== "number" || !Number.isInteger(idx)) {
      throw new BambooRuntimeError("A list index must be a whole number.", line, "TypeError");
    }
    const i = idx < 0 ? obj.length + idx : idx;
    if (i < 0 || i >= obj.length) {
      throw new BambooRuntimeError(
        `List index ${idx} is out of range (list has ${obj.length} item(s)).`,
        line,
        "IndexError"
      );
    }
    obj[i] = value;
    return value;
  }

  len(value) {
    if (Array.isArray(value) || typeof value === "string") return value.length;
    throw new BambooRuntimeError(`len() needs a list or string, but got ${describeType(value)}.`, this.__line);
  }

  __append(list, value, line) {
    if (!Array.isArray(list)) {
      throw new BambooRuntimeError(`.append() needs a list, but got ${describeType(list)}.`, line);
    }
    list.push(value);
  }

  // Dispatches a curated set of Python str methods (spec 3.2-adjacent,
  // working toward Terminal-tab copy-paste compatibility with real
  // Python) — but only when the receiver is actually a string. Anything
  // else falls through to its own `.method(...)` unchanged, so this can
  // never break a Vector method or an imported module's own function that
  // happens to share one of these names.
  __strmethod(obj, name, args, line) {
    if (typeof obj === "string") {
      return PYTHON_STRING_METHODS_IMPL[name](obj, args, line);
    }
    if (obj == null || typeof obj[name] !== "function") {
      throw new BambooRuntimeError(`Can't call '.${name}(...)' on ${describeType(obj)}.`, line);
    }
    return obj[name](...args);
  }

  // Python's `*`: number*number is ordinary multiplication (float if
  // either side is a PyFloat, else plain int), but a string or list times
  // a plain int REPEATS it ("ab" * 3 -> "ababab") — plain JS *
  // would silently coerce to NaN instead. Repeat only accepts a plain
  // int multiplier, matching Python's own "can't multiply sequence by
  // non-int" rule.
  __mul(a, b, line) {
    const aNum = a instanceof PyFloat || typeof a === "number";
    const bNum = b instanceof PyFloat || typeof b === "number";
    if (aNum && bNum) {
      const result = unboxNum(a) * unboxNum(b);
      return (a instanceof PyFloat || b instanceof PyFloat) ? new PyFloat(result) : result;
    }
    if (typeof a === "string" && typeof b === "number") return a.repeat(Math.max(0, Math.trunc(b)));
    if (typeof a === "number" && typeof b === "string") return b.repeat(Math.max(0, Math.trunc(a)));
    if (Array.isArray(a) && typeof b === "number") return Array(Math.max(0, Math.trunc(b))).fill(a).flat();
    if (typeof a === "number" && Array.isArray(b)) return Array(Math.max(0, Math.trunc(a))).fill(b).flat();
    throw new BambooRuntimeError(`Can't multiply ${describeType(a)} and ${describeType(b)}.`, line);
  }

  // Constructs a boxed Python float (spec 3.2/6.8) — used for float
  // literals (`3.5`) and anywhere else a real `float` value needs to
  // exist as opposed to a plain int.
  __mkfloat(v) {
    return new PyFloat(v);
  }

  // Unary '-': keeps a PyFloat a PyFloat. Plain JS '-' would silently
  // unbox it via valueOf(), losing the trailing ".0" on print.
  __neg(v, line) {
    if (v instanceof PyFloat) return new PyFloat(-v.value);
    if (typeof v === "number") return -v;
    throw new BambooRuntimeError(`Can't negate ${describeType(v)}.`, line);
  }

  // Python's '/' (true division, spec 3.2/6.8): ALWAYS returns a float,
  // even for two ints that divide evenly (4/2 -> 2.0, not 2) — this is
  // Python 3's own behavior (distinct from Python 2's `/`).
  __truediv(a, b, line) {
    const av = unboxNum(a);
    const bv = unboxNum(b);
    if (typeof av !== "number" || typeof bv !== "number") {
      throw new BambooRuntimeError(`Can't divide ${describeType(a)} and ${describeType(b)}.`, line);
    }
    if (bv === 0) {
      const isFloat = a instanceof PyFloat || b instanceof PyFloat;
      throw new BambooRuntimeError(isFloat ? "float division by zero" : "division by zero", line, "ZeroDivisionError");
    }
    return new PyFloat(av / bv);
  }

  // Python's '//' (floor division, spec 3.2/6.8): floors toward negative
  // infinity (-7 // 2 -> -4, not JS's -3), staying a plain int if both
  // operands were ints and promoting to float if either was a float.
  __floordiv(a, b, line) {
    const av = unboxNum(a);
    const bv = unboxNum(b);
    if (typeof av !== "number" || typeof bv !== "number") {
      throw new BambooRuntimeError(`Can't divide ${describeType(a)} and ${describeType(b)}.`, line);
    }
    const isFloat = a instanceof PyFloat || b instanceof PyFloat;
    if (bv === 0) {
      throw new BambooRuntimeError(
        isFloat ? "float floor division by zero" : "integer division or modulo by zero",
        line,
        "ZeroDivisionError"
      );
    }
    const result = Math.floor(av / bv);
    return isFloat ? new PyFloat(result) : result;
  }

  // Python's '%' (floored modulo, spec 3.2/6.8): the result's sign
  // follows the DIVISOR (-7 % 3 -> 2, not JS's -1), staying a plain int
  // if both operands were ints.
  __mod(a, b, line) {
    const av = unboxNum(a);
    const bv = unboxNum(b);
    if (typeof av !== "number" || typeof bv !== "number") {
      throw new BambooRuntimeError(`Can't compute ${describeType(a)} % ${describeType(b)}.`, line);
    }
    const isFloat = a instanceof PyFloat || b instanceof PyFloat;
    if (bv === 0) {
      throw new BambooRuntimeError(isFloat ? "float modulo" : "integer modulo by zero", line, "ZeroDivisionError");
    }
    const result = ((av % bv) + bv) % bv;
    return isFloat ? new PyFloat(result) : result;
  }

  // Python's '==' / '!=' (spec 6.8): compares by VALUE — a PyFloat
  // against a plain number, or two lists element-by-element — never by
  // JS reference/strict-type identity. See pyEquals above.
  __eq(a, b) {
    return pyEquals(a, b);
  }

  // Python's `in` / `not in` (spec 3.2): substring test on a string,
  // element-membership scan on a list. dict/set branches land in Phase A6
  // once those types exist. Note the argument order matches how it reads
  // in generated code: `X in Y` -> __contains(Y, X, line).
  __contains(container, item, line) {
    if (typeof container === "string") {
      if (typeof item !== "string") {
        throw new BambooRuntimeError(
          `'in <string>' requires string as left operand, not ${describeType(item)}.`,
          line
        );
      }
      return container.includes(item);
    }
    if (Array.isArray(container)) {
      return container.some((el) => pyEquals(el, item));
    }
    throw new BambooRuntimeError(`Argument of type '${describeType(container)}' is not iterable.`, line);
  }

  // Python's exception model (spec 3.2/6.8's fixed taxonomy): `ValueError(
  // "bad")` CONSTRUCTS a tagged, catchable error value — a real
  // BambooRuntimeError, so existing `instanceof BambooRuntimeError` checks
  // keep working uniformly — without throwing it. It's `raise` (below)
  // that actually throws, exactly like real Python's own "exceptions are
  // just instances until raised" model. Message formatting matches
  // CPython's own str(exception) rule: no args -> "", one arg -> that
  // arg's str(), 2+ args -> a tuple repr, verified against a real
  // interpreter.
  __makeException(pythonType, args, line) {
    let message;
    if (args.length === 0) message = "";
    else if (args.length === 1) message = this._stringify(args[0]);
    else message = `(${args.map((a) => this._stringifyRepr(a)).join(", ")})`;
    return new BambooRuntimeError(message, line, pythonType);
  }

  // `raise <expr>`: throws a real, tagged exception value. Raising
  // anything that isn't one of our tagged exception types is itself a
  // TypeError, matching CPython's own "exceptions must derive from
  // BaseException" rule.
  __raise(value, line) {
    if (value instanceof BambooRuntimeError) {
      value.line = line;
      throw value;
    }
    throw new BambooRuntimeError(
      `exceptions must derive from BaseException (got ${describeType(value)}).`,
      line,
      "TypeError"
    );
  }

  // Bare `raise` — re-raises whatever exception is currently being
  // handled (backed by __excStack, pushed/popped around a handler body).
  __reraise(line) {
    if (this.__excStack.length === 0) {
      throw new BambooRuntimeError("No active exception to re-raise.", line, "RuntimeError");
    }
    throw this.__excStack[this.__excStack.length - 1];
  }

  // Whether `err` is catchable by an `except <exceptionName>:` clause
  // (exceptionName is null for a bare `except:`; "Exception" is the
  // generic catch-all name, matching anything tagged). Only errors
  // explicitly tagged with a real pythonType are ever catchable — this is
  // what keeps internal guardrail errors (the infinite-loop guard, etc. —
  // pythonType stays its default null) uncatchable even by the broadest
  // `except:`, by design, not by accident.
  __excMatches(err, exceptionName) {
    if (!(err instanceof BambooRuntimeError) || err.pythonType == null) return false;
    if (exceptionName === null || exceptionName === "Exception") return true;
    return err.pythonType === exceptionName;
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
      // Matches Python's actual int(str) grammar (verified against a real
      // interpreter): surrounding whitespace and an optional sign are
      // fine, and single underscores between digits are allowed too
      // (Python 3.6+'s numeric-literal digit separator, e.g. "1_000") —
      // anything else (a decimal point, empty string, non-digit text)
      // raises ValueError instead of silently returning 0.
      const trimmed = v.trim();
      if (!/^[+-]?\d+(_\d+)*$/.test(trimmed)) {
        throw new BambooRuntimeError(
          `invalid literal for int() with base 10: ${this._stringifyRepr(v)}`,
          this.__line,
          "ValueError"
        );
      }
      return parseInt(trimmed.replace(/_/g, ""), 10);
    }
    // Math.trunc coerces a PyFloat operand via its own valueOf() for
    // free, so `int(3.9)` (a boxed float) already truncates correctly
    // here without any PyFloat-specific branch.
    return Math.trunc(v);
  }

  // Always returns a boxed PyFloat (spec 3.2/6.8) — matching Python 3's
  // own float() constructor, which never returns a plain int. The
  // string path validates against Python's actual float() grammar
  // (verified against a real interpreter): optional surrounding
  // whitespace, an optional sign, digit-separator underscores, "inf"/
  // "infinity"/"nan" (case-insensitive) — anything else raises
  // ValueError instead of silently returning 0.
  float(v) {
    if (typeof v === "boolean") return new PyFloat(v ? 1 : 0);
    if (v instanceof PyFloat) return v;
    if (typeof v === "string") {
      const trimmed = v.trim();
      const specialMatch = /^([+-]?)(inf|infinity|nan)$/i.exec(trimmed);
      if (specialMatch) {
        const isNeg = specialMatch[1] === "-";
        const magnitude = specialMatch[2].toLowerCase() === "nan" ? NaN : Infinity;
        return new PyFloat(isNeg ? -magnitude : magnitude);
      }
      if (!/^[+-]?(\d+(_\d+)*(\.(\d+(_\d+)*)?)?|\.\d+(_\d+)*)([eE][+-]?\d+(_\d+)*)?$/.test(trimmed)) {
        throw new BambooRuntimeError(
          `could not convert string to float: ${this._stringifyRepr(v)}`,
          this.__line,
          "ValueError"
        );
      }
      return new PyFloat(parseFloat(trimmed.replace(/_/g, "")));
    }
    return new PyFloat(unboxNum(v));
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
    // A tagged exception value (spec 3.2/6.8, e.g. from `except X as e:`):
    // str(e) is just its message in real Python, not "ValueError: msg".
    if (v instanceof BambooRuntimeError) return v.message;
    // A boxed float (spec 3.2/6.8's numeric model) — CPython's own float
    // repr, NOT JS's Number.prototype.toString() (see src/pynum.js).
    if (v instanceof PyFloat) return formatPyFloat(v.value);
    return String(v);
  }

  _stringifyRepr(v) {
    if (typeof v === "string") return `'${v}'`;
    return this._stringify(v);
  }

  // f-string formatting (spec 3.6-adjacent): no format spec just falls back
  // to the same stringification print()/str() use; ':.Nf' fixes a number
  // to N decimal places, matching Python's f"{x:.2f}".
  __fstr(value, spec, line) {
    if (spec == null) return this._stringify(value);
    const fixed = /^\.(\d+)f$/.exec(spec);
    if (fixed) {
      const num = unboxNum(value);
      if (typeof num !== "number") {
        throw new BambooRuntimeError(
          `f-string format ':${spec}' needs a number, but got ${describeType(value)}.`,
          line
        );
      }
      return num.toFixed(Number(fixed[1]));
    }
    throw new BambooRuntimeError(
      `Unsupported f-string format ':${spec}' — only ':.Nf' (fixed decimal places) is supported.`,
      line
    );
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
