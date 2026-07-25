import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, BambooSyntaxError } from "../src/lexer.js";

function types(tokens) {
  return tokens.map((t) => t.type);
}

test("tokenizes a simple function with indentation", () => {
  const src = "def setup():\n    background(1, 2, 3)\n";
  const tokens = tokenize(src);
  assert.deepEqual(types(tokens), [
    "def", "NAME", "(", ")", ":", "NEWLINE",
    "INDENT", "NAME", "(", "NUMBER", ",", "NUMBER", ",", "NUMBER", ")", "NEWLINE",
    "DEDENT", "EOF",
  ]);
});

test("emits DEDENT tokens back to zero at EOF", () => {
  const src = "def a():\n    if True:\n        forward(1)\n";
  const tokens = tokenize(src);
  const dedents = tokens.filter((t) => t.type === "DEDENT").length;
  const indents = tokens.filter((t) => t.type === "INDENT").length;
  assert.equal(dedents, indents);
});

test("skips comments and blank lines without affecting indentation", () => {
  const src = "def a():\n    # a comment\n\n    forward(1)\n";
  const tokens = tokenize(src);
  assert.deepEqual(types(tokens).filter((t) => t === "INDENT" || t === "DEDENT"), ["INDENT", "DEDENT"]);
});

test("tokenizes strings with escapes", () => {
  const tokens = tokenize('text("hi\\n", 1, 2)\n');
  const str = tokens.find((t) => t.type === "STRING");
  assert.equal(str.value, "hi\n");
});

test("tokenizes floats and comparison operators", () => {
  const tokens = tokenize("x = 1.5\nif x >= 2 and x != 3:\n    forward(x)\n");
  const nums = tokens.filter((t) => t.type === "NUMBER").map((t) => t.value);
  assert.deepEqual(nums, [1.5, 2, 3]);
  assert.ok(types(tokens).includes(">="));
  assert.ok(types(tokens).includes("!="));
});

test("throws BambooSyntaxError with a line number on bad indentation", () => {
  const src = "def a():\n    forward(1)\n  turn(1)\n";
  assert.throws(() => tokenize(src), (err) => {
    assert.ok(err instanceof BambooSyntaxError);
    assert.equal(err.line, 3);
    return true;
  });
});

test("throws on an unterminated string", () => {
  assert.throws(() => tokenize('text("unterminated)\n'), BambooSyntaxError);
});
