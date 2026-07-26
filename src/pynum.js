// Python's int/float distinction (spec 3.2/6.8's numeric model). Plain JS
// numbers keep representing Python `int` — the overwhelming majority of
// numeric values in a teaching script (loop counters, indices, range(),
// len()) stay exactly as fast and unboxed as before this existed. Only
// values Python would treat as `float` get boxed in PyFloat.
//
// `valueOf()` returning the raw number means `<`/`>`/`<=`/`>=`/arithmetic
// against a plain number already coerce correctly for free via JS's own
// ToPrimitive — only `===`-style comparisons need an explicit unwrap (see
// pyEquals in runtime-base.js).
export class PyFloat {
  constructor(value) {
    this.value = value;
  }
  valueOf() {
    return this.value;
  }
}

export function unboxNum(v) {
  return v instanceof PyFloat ? v.value : v;
}

// Formats a float exactly the way real Python's repr()/str() does — this
// is NOT the same as JS's Number.prototype.toString(), which disagrees at
// the edges: JS drops the trailing ".0" Python always keeps, and switches
// to exponential notation at a different threshold. Every branch below is
// table-tested against a real `python3` interpreter (see tests/pynum.test.js).
//
// Strategy: JS's `toExponential()` (no argument) already gives the same
// shortest-round-trip significant digits Python's own dtoa-based repr
// uses — it's only the FORMATTING (fixed vs. scientific, trailing zeros,
// exponent padding) that differs, so parse that canonical form and
// re-render it using Python's own threshold (fixed notation for -4 <=
// exponent <= 15, scientific otherwise — CPython's float_repr rule).
export function formatPyFloat(v) {
  if (Number.isNaN(v)) return "nan";
  if (v === Infinity) return "inf";
  if (v === -Infinity) return "-inf";
  if (Object.is(v, -0)) return "-0.0";
  if (v === 0) return "0.0";

  const neg = v < 0;
  const abs = Math.abs(v);

  const match = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(abs.toExponential());
  const digits = match[1] + (match[2] || "");
  const exp = Number(match[3]); // value == digits[0].digits[1:] * 10^exp
  const decpt = exp + 1; // number of digits of `digits` left of the decimal point

  let body;
  if (exp >= -4 && exp <= 15) {
    if (decpt <= 0) {
      body = `0.${"0".repeat(-decpt)}${digits}`;
    } else if (decpt >= digits.length) {
      body = `${digits}${"0".repeat(decpt - digits.length)}.0`;
    } else {
      body = `${digits.slice(0, decpt)}.${digits.slice(decpt)}`;
    }
  } else {
    const mantissa = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    const expSign = exp < 0 ? "-" : "+";
    const expDigits = String(Math.abs(exp)).padStart(2, "0");
    body = `${mantissa}e${expSign}${expDigits}`;
  }
  return neg ? `-${body}` : body;
}
