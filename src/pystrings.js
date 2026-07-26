// Python's str methods (spec 3.2-adjacent: working toward Terminal-tab
// scripts being copy-paste compatible with real Python), matching CPython's
// documented behavior — including its quirks, like title()'s apostrophe
// handling — rather than the closest-sounding JS method. Pure functions,
// no runtime/class state; src/runtime-base.js's __strmethod() dispatches
// into these only when the receiver is actually a string.
import { BambooRuntimeError } from "./errors.js";

function isWhitespace(ch) {
  return /\s/.test(ch);
}

function pyStrip(s, chars, left, right) {
  const isStripChar = chars === undefined || chars === null
    ? isWhitespace
    : (ch) => chars.includes(ch);
  let start = 0;
  let end = s.length;
  if (left) while (start < end && isStripChar(s[start])) start++;
  if (right) while (end > start && isStripChar(s[end - 1])) end--;
  return s.slice(start, end);
}

// No-argument split() collapses any run of whitespace and drops leading/
// trailing empty pieces (Python's own special case); split(sep) keeps
// empty strings between consecutive separators.
function pySplit(s, sep, maxsplit, line) {
  const bounded = maxsplit !== undefined && maxsplit !== null && maxsplit >= 0;

  if (sep === undefined || sep === null) {
    if (s.trim() === "") return [];
    if (!bounded) return s.trim().split(/\s+/);

    // Only the leading run is stripped up front — Python preserves
    // whatever trailing whitespace lands in the final piece verbatim,
    // *unless* maxsplit runs out before the string does, in which case
    // the tail is trimmed the same way an unbounded split would. Either
    // way, a final piece that comes out empty is dropped, never kept.
    let remaining = s.replace(/^\s+/, "");
    const parts = [];
    let splitCount = 0;
    for (let i = 0; i < maxsplit; i++) {
      const m = /\s+/.exec(remaining);
      if (!m) break;
      parts.push(remaining.slice(0, m.index));
      remaining = remaining.slice(m.index + m[0].length);
      splitCount++;
    }
    if (splitCount < maxsplit) remaining = remaining.replace(/\s+$/, "");
    if (remaining !== "") parts.push(remaining);
    return parts;
  }

  if (sep === "") {
    throw new BambooRuntimeError("split() separator can't be an empty string.", line);
  }
  if (!bounded) return s.split(sep);

  const parts = [];
  let rest = s;
  for (let i = 0; i < maxsplit; i++) {
    const idx = rest.indexOf(sep);
    if (idx === -1) break;
    parts.push(rest.slice(0, idx));
    rest = rest.slice(idx + sep.length);
  }
  parts.push(rest);
  return parts;
}

function pyReplace(s, oldVal, newVal, count) {
  const unbounded = count === undefined || count === null || count < 0;

  if (oldVal === "") {
    // Python inserts newVal between every character, and at both ends:
    // "ab".replace("", "-") -> "-a-b-".
    const positions = unbounded ? s.length + 1 : Math.min(count, s.length + 1);
    let out = "";
    for (let i = 0; i < s.length; i++) {
      if (i < positions) out += newVal;
      out += s[i];
    }
    if (s.length < positions) out += newVal;
    return out;
  }

  if (unbounded) return s.split(oldVal).join(newVal);

  let result = "";
  let rest = s;
  let n = 0;
  while (n < count) {
    const idx = rest.indexOf(oldVal);
    if (idx === -1) break;
    result += rest.slice(0, idx) + newVal;
    rest = rest.slice(idx + oldVal.length);
    n++;
  }
  return result + rest;
}

function pyJoin(sep, iterable, line) {
  if (!Array.isArray(iterable)) {
    throw new BambooRuntimeError(`join() needs a list, but got ${typeof iterable}.`, line);
  }
  for (const item of iterable) {
    if (typeof item !== "string") {
      throw new BambooRuntimeError("join() needs a list of strings.", line);
    }
  }
  return iterable.join(sep);
}

function pyCount(s, sub) {
  if (sub === "") return s.length + 1;
  let count = 0;
  let i = 0;
  for (;;) {
    const idx = s.indexOf(sub, i);
    if (idx === -1) break;
    count++;
    i = idx + sub.length;
  }
  return count;
}

// Capitalizes the first letter of each run of alphabetic characters and
// lowercases the rest — including CPython's well-known apostrophe quirk
// ("they're".title() -> "They'Re"), since matching real Python (warts and
// all) is the point.
function pyTitle(s) {
  let out = "";
  let prevWasAlpha = false;
  for (const ch of s) {
    const isAlpha = /[A-Za-z]/.test(ch);
    out += isAlpha ? (prevWasAlpha ? ch.toLowerCase() : ch.toUpperCase()) : ch;
    prevWasAlpha = isAlpha;
  }
  return out;
}

function pyZfill(s, width) {
  if (s.length >= width) return s;
  const hasSign = s[0] === "+" || s[0] === "-";
  const sign = hasSign ? s[0] : "";
  const digits = hasSign ? s.slice(1) : s;
  return sign + "0".repeat(width - s.length) + digits;
}

// Every entry has the same shape — (s, args, line) — with `args` the raw
// array of whatever the caller passed to the method, indexed explicitly
// rather than destructured positionally. That's deliberate: destructuring
// straight into named parameters (s, sep, maxsplit, line) would silently
// shift `line` into the wrong slot whenever an optional argument like
// split()'s sep/maxsplit was omitted.
export const PYTHON_STRING_METHODS_IMPL = {
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  strip: (s, args) => pyStrip(s, args[0], true, true),
  lstrip: (s, args) => pyStrip(s, args[0], true, false),
  rstrip: (s, args) => pyStrip(s, args[0], false, true),
  split: (s, args, line) => pySplit(s, args[0], args[1], line),
  replace: (s, args) => pyReplace(s, args[0], args[1], args[2]),
  join: (s, args, line) => pyJoin(s, args[0], line),
  startswith: (s, args) => s.startsWith(args[0]),
  endswith: (s, args) => s.endsWith(args[0]),
  find: (s, args) => s.indexOf(args[0]),
  rfind: (s, args) => s.lastIndexOf(args[0]),
  index: (s, args, line) => {
    const i = s.indexOf(args[0]);
    if (i === -1) throw new BambooRuntimeError(`'${args[0]}' was not found in '${s}'.`, line);
    return i;
  },
  count: (s, args) => pyCount(s, args[0]),
  title: (s) => pyTitle(s),
  capitalize: (s) => (s.length ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s),
  swapcase: (s) => [...s].map((ch) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase())).join(""),
  isdigit: (s) => s.length > 0 && /^[0-9]+$/.test(s),
  isalpha: (s) => s.length > 0 && /^[A-Za-z]+$/.test(s),
  isalnum: (s) => s.length > 0 && /^[A-Za-z0-9]+$/.test(s),
  isspace: (s) => s.length > 0 && /^\s+$/.test(s),
  isupper: (s) => /[A-Za-z]/.test(s) && s === s.toUpperCase(),
  islower: (s) => /[A-Za-z]/.test(s) && s === s.toLowerCase(),
  zfill: (s, args) => pyZfill(s, args[0]),
};
