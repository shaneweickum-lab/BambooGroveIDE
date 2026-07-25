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

// --- f-strings ---

test("tokenizes an f-string into text/expr parts", () => {
  const tokens = tokenize('x = f"hi {name}, score {a + b}!"\n');
  const fstr = tokens.find((t) => t.type === "FSTRING");
  assert.deepEqual(fstr.value, [
    { type: "text", value: "hi " },
    { type: "expr", source: "name", spec: null, line: 1 },
    { type: "text", value: ", score " },
    { type: "expr", source: "a + b", spec: null, line: 1 },
    { type: "text", value: "!" },
  ]);
});

test("tokenizes an f-string format spec after ':'", () => {
  const tokens = tokenize('f"{x:.2f}"\n');
  const fstr = tokens.find((t) => t.type === "FSTRING");
  assert.deepEqual(fstr.value, [{ type: "expr", source: "x", spec: ".2f", line: 1 }]);
});

test("f-string supports {{ and }} as literal braces", () => {
  const tokens = tokenize('f"{{literal}} {x}"\n');
  const fstr = tokens.find((t) => t.type === "FSTRING");
  assert.deepEqual(fstr.value, [
    { type: "text", value: "{literal} " },
    { type: "expr", source: "x", spec: null, line: 1 },
  ]);
});

test("f-string expression can contain nested strings/brackets without ending early", () => {
  const tokens = tokenize('f"{greet(\'a}b\', [1, 2])}"\n');
  const fstr = tokens.find((t) => t.type === "FSTRING");
  assert.deepEqual(fstr.value, [{ type: "expr", source: "greet('a}b', [1, 2])", spec: null, line: 1 }]);
});

test("an f-string with no interpolation still tokenizes (empty parts allowed)", () => {
  const tokens = tokenize('f"just text"\n');
  const fstr = tokens.find((t) => t.type === "FSTRING");
  assert.deepEqual(fstr.value, [{ type: "text", value: "just text" }]);
});

test("throws on an empty {} expression in an f-string", () => {
  assert.throws(() => tokenize('f"{}"\n'), BambooSyntaxError);
});

test("throws on a stray '}' in an f-string", () => {
  assert.throws(() => tokenize('f"oops }"\n'), BambooSyntaxError);
});

test("throws on an f-string missing its closing '}'", () => {
  assert.throws(() => tokenize('f"{x"\n'), BambooSyntaxError);
});
