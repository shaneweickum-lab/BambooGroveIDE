// Every case here was cross-checked against a real Python 3 interpreter
// (see the session's manual verification) — the goal isn't "a reasonable
// string method," it's byte-identical behavior to CPython, since the
// point is that a Terminal-tab script using only these can be copy-pasted
// into Python and run the same.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PYTHON_STRING_METHODS_IMPL as M } from "../src/pystrings.js";
import { BambooRuntimeError } from "../src/errors.js";

function call(name, s, args = []) {
  return M[name](s, args, 1);
}

test("upper/lower", () => {
  assert.equal(call("upper", "Hello"), "HELLO");
  assert.equal(call("lower", "Hello"), "hello");
});

test("strip/lstrip/rstrip with no argument trim whitespace from both/one end", () => {
  assert.equal(call("strip", "  hi  "), "hi");
  assert.equal(call("lstrip", "  hi  "), "hi  ");
  assert.equal(call("rstrip", "  hi  "), "  hi");
  assert.equal(call("strip", "\t\nhi\n\t"), "hi");
});

test("strip with a chars argument strips any of those characters, not a substring", () => {
  assert.equal(call("strip", "xxhixx", ["x"]), "hi");
  assert.equal(call("strip", "xyhixy", ["xy"]), "hi");
});

test("split() with no args splits on whitespace runs and drops empty pieces", () => {
  assert.deepEqual(call("split", "a b  c"), ["a", "b", "c"]);
  assert.deepEqual(call("split", "  a b c  "), ["a", "b", "c"]);
  assert.deepEqual(call("split", ""), []);
  assert.deepEqual(call("split", "   "), []);
});

test("split(sep) keeps empty strings between consecutive separators", () => {
  assert.deepEqual(call("split", "a,b,,c", [","]), ["a", "b", "", "c"]);
  assert.deepEqual(call("split", "a,b,c", [","]), ["a", "b", "c"]);
});

test("split(sep, maxsplit) bounds the number of splits from the left", () => {
  assert.deepEqual(call("split", "a,b,c", [",", 1]), ["a", "b,c"]);
  assert.deepEqual(call("split", "a,b,c,d", [",", 2]), ["a", "b", "c,d"]);
});

test("split(None, maxsplit) bounds whitespace splitting and preserves the remainder's whitespace", () => {
  assert.deepEqual(call("split", "a b c", [null, 1]), ["a", "b c"]);
  assert.deepEqual(call("split", "a b   c   d  ", [null, 2]), ["a", "b", "c   d  "]);
});

test("split(None, maxsplit) drops the tail if maxsplit runs out before the string does", () => {
  assert.deepEqual(call("split", "a b   c   d  ", [null, 100]), ["a", "b", "c", "d"]);
  assert.deepEqual(call("split", "a  ", [null, 5]), ["a"]);
});

test("split(None, 0) performs zero splits, keeping only the leading strip", () => {
  assert.deepEqual(call("split", "a  ", [null, 0]), ["a  "]);
  assert.deepEqual(call("split", "a b c", [null, 0]), ["a b c"]);
});

test("split(None, maxsplit) never keeps an empty trailing piece", () => {
  assert.deepEqual(call("split", "a ", [null, 1]), ["a"]);
});

test("split('') throws a friendly error (Python raises ValueError)", () => {
  assert.throws(() => call("split", "abc", [""]), BambooRuntimeError);
});

test("replace(old, new) replaces every non-overlapping occurrence", () => {
  assert.equal(call("replace", "abcabc", ["a", "X"]), "XbcXbc");
  assert.equal(call("replace", "aaa", ["aa", "b"]), "ba");
});

test("replace(old, new, count) bounds the number of replacements", () => {
  assert.equal(call("replace", "abcabc", ["a", "X", 1]), "Xbcabc");
  assert.equal(call("replace", "abcabc", ["a", "X", 0]), "abcabc");
});

test("replace('', new) inserts between every character and at both ends", () => {
  assert.equal(call("replace", "ab", ["", "-"]), "-a-b-");
  assert.equal(call("replace", "ab", ["", "-", 1]), "-ab");
  assert.equal(call("replace", "ab", ["", "-", 2]), "-a-b");
});

test("join(iterable) joins with the receiver as separator", () => {
  assert.equal(call("join", "-", [["a", "b", "c"]]), "a-b-c");
  assert.equal(call("join", "", [["a", "b", "c"]]), "abc");
});

test("join() rejects a non-list or a list with non-string items", () => {
  assert.throws(() => call("join", "-", ["not a list"]), BambooRuntimeError);
  assert.throws(() => call("join", "-", [["a", 1]]), BambooRuntimeError);
});

test("startswith/endswith", () => {
  assert.equal(call("startswith", "hello", ["he"]), true);
  assert.equal(call("startswith", "hello", ["lo"]), false);
  assert.equal(call("endswith", "hello", ["lo"]), true);
});

test("find/rfind return -1 when not found (never throw)", () => {
  assert.equal(call("find", "hello", ["l"]), 2);
  assert.equal(call("rfind", "hello", ["l"]), 3);
  assert.equal(call("find", "hello", ["z"]), -1);
});

test("index() returns the same as find() but throws when not found", () => {
  assert.equal(call("index", "hello", ["l"]), 2);
  assert.throws(() => call("index", "hello", ["z"]), BambooRuntimeError);
});

test("count() counts non-overlapping occurrences", () => {
  assert.equal(call("count", "aaa", ["aa"]), 1);
  assert.equal(call("count", "aaaa", ["aa"]), 2);
  assert.equal(call("count", "abc", ["z"]), 0);
  assert.equal(call("count", "abc", [""]), 4);
});

test("title() capitalizes each alphabetic run, including the apostrophe quirk", () => {
  assert.equal(call("title", "hello world"), "Hello World");
  assert.equal(call("title", "they're great"), "They'Re Great");
});

test("capitalize() only uppercases the first character, lowercasing the rest", () => {
  assert.equal(call("capitalize", "hELLO world"), "Hello world");
  assert.equal(call("capitalize", ""), "");
});

test("swapcase()", () => {
  assert.equal(call("swapcase", "Hello World"), "hELLO wORLD");
});

test("isdigit/isalpha/isalnum/isspace/isupper/islower", () => {
  assert.equal(call("isdigit", "123"), true);
  assert.equal(call("isdigit", "12a"), false);
  assert.equal(call("isdigit", ""), false);
  assert.equal(call("isalpha", "abc"), true);
  assert.equal(call("isalpha", "abc1"), false);
  assert.equal(call("isalnum", "abc123"), true);
  assert.equal(call("isalnum", "abc 123"), false);
  assert.equal(call("isspace", "   "), true);
  assert.equal(call("isspace", ""), false);
  assert.equal(call("isupper", "ABC"), true);
  assert.equal(call("isupper", "ABc"), false);
  assert.equal(call("islower", "abc"), true);
});

test("zfill() pads with leading zeros, keeping a sign in front", () => {
  assert.equal(call("zfill", "42", [5]), "00042");
  assert.equal(call("zfill", "-42", [5]), "-0042");
  assert.equal(call("zfill", "+42", [5]), "+0042");
  assert.equal(call("zfill", "123456", [3]), "123456"); // already longer than width
});
