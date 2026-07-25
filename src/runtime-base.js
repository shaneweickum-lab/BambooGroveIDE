// Shared logic between BambooRuntime (Canvas tab) and TerminalRuntime
// (Terminal tab, spec 3.6): Python-ish truthiness/boolean-ops, the loop
// guard, list/range helpers, and print()'s value formatting. Everything
// here is mode-agnostic — it never touches a canvas or the DOM.
import { BambooRuntimeError } from "./errors.js";

const MAX_ITERATIONS_PER_CALL = 300000;
const MAX_MS_PER_CALL = 3000;
const MAX_RANGE_LENGTH = 1000000;

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
