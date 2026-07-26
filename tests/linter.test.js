import { test } from "node:test";
import assert from "node:assert/strict";
import { lint } from "../src/linter.js";

function rules(result) {
  return result.issues.map((i) => i.rule);
}

test("a script with no issues returns an empty issue list", () => {
  const result = lint("def setup():\n    background(0)\n\ndef draw():\n    forward(1)\n    turn(90)\n");
  assert.equal(result.syntaxError, null);
  assert.deepEqual(result.issues, []);
});

test("a script that doesn't parse reports syntaxError instead of running AST checks", () => {
  const result = lint("def draw()\n    forward(1)\n");
  assert.ok(result.syntaxError);
  assert.equal(result.syntaxError.line, 1);
  assert.match(result.syntaxError.message, /:/);
  assert.deepEqual(result.issues, []);
});

test("lint() never throws, even on garbage input", () => {
  assert.doesNotThrow(() => lint(""));
  assert.doesNotThrow(() => lint("   \n\n"));
  assert.doesNotThrow(() => lint("@#$%^&*"));
});

// --- boolean-comparison ---

test("flags == True/False and != True/False with a simplification suggestion", () => {
  const src = "def draw():\n    if a == True:\n        forward(1)\n    if a == False:\n        forward(2)\n    if a != True:\n        forward(3)\n    if a != False:\n        forward(4)\n";
  const result = lint(src);
  const boolIssues = result.issues.filter((i) => i.rule === "boolean-comparison");
  assert.equal(boolIssues.length, 4);
  assert.match(boolIssues[0].message, /if x:/);
  assert.match(boolIssues[1].message, /if not x:/);
  assert.match(boolIssues[2].message, /if not x:/);
  assert.match(boolIssues[3].message, /if x:/);
});

test("does not flag an ordinary comparison with no boolean literal", () => {
  const result = lint("def draw():\n    if a == b:\n        forward(1)\n");
  assert.deepEqual(rules(result), []);
});

// --- shadowed-builtin ---

test("flags a top-level variable that shadows a builtin function name", () => {
  const result = lint("circle = 5\n\ndef draw():\n    forward(circle)\n");
  const issue = result.issues.find((i) => i.rule === "shadowed-builtin");
  assert.ok(issue);
  assert.equal(issue.line, 1);
  assert.match(issue.message, /'circle'/);
});

test("flags a function parameter that shadows a builtin", () => {
  const result = lint("def draw(range):\n    forward(range)\n");
  const issue = result.issues.find((i) => i.rule === "shadowed-builtin");
  assert.ok(issue);
});

test("flags a variable that shadows a read-only global (e.g. mouseX)", () => {
  const result = lint("def draw():\n    mouseX = 5\n    forward(mouseX)\n");
  const issue = result.issues.find((i) => i.rule === "shadowed-builtin");
  assert.ok(issue);
});

test("only reports a shadowed name once even if reassigned repeatedly", () => {
  const result = lint("circle = 1\ncircle = 2\ncircle = 3\n");
  assert.equal(result.issues.filter((i) => i.rule === "shadowed-builtin").length, 1);
});

test("does not flag ordinary user names", () => {
  const result = lint("player_score = 5\n\ndef draw():\n    forward(player_score)\n");
  assert.deepEqual(rules(result).filter((r) => r === "shadowed-builtin"), []);
});

// --- inconsistent-naming ---

test("flags a file that mixes snake_case and camelCase user variables", () => {
  const result = lint("totalScore = 0\nplayer_name = \"Bo\"\n\ndef draw():\n    forward(totalScore)\n    forward(player_name)\n");
  const issue = result.issues.find((i) => i.rule === "inconsistent-naming");
  assert.ok(issue);
  assert.match(issue.message, /totalScore/);
  assert.match(issue.message, /player_name/);
});

test("does not flag a file that consistently uses snake_case", () => {
  const result = lint("player_score = 0\nplayer_name = \"Bo\"\n\ndef draw():\n    forward(player_score)\n    forward(player_name)\n");
  assert.deepEqual(rules(result).filter((r) => r === "inconsistent-naming"), []);
});

test("does not flag single-word lowercase names (no signal either way) or ALL_CAPS constants", () => {
  const result = lint("POP_SIZE = 20\nscore = 0\ni = 0\n\ndef draw():\n    forward(POP_SIZE)\n    forward(score)\n    forward(i)\n");
  assert.deepEqual(rules(result).filter((r) => r === "inconsistent-naming"), []);
});

test("does not flag builtin-name casing differences (e.g. no_stroke vs noStroke) since those are never user definitions", () => {
  const result = lint("def setup():\n    no_stroke()\n\ndef draw():\n    noStroke()\n");
  assert.deepEqual(rules(result).filter((r) => r === "inconsistent-naming"), []);
});

// --- similar-names (typo-style near-duplicate) ---

test("flags two distinct assigned names that are the same word in different casing", () => {
  const result = lint("def draw():\n    total_score = 0\n    total_score = total_score + 1\n    totalScore = total_score + 5\n    forward(totalScore)\n");
  const issue = result.issues.find((i) => i.rule === "similar-names");
  assert.ok(issue);
  assert.match(issue.message, /total_score/);
  assert.match(issue.message, /totalScore/);
  assert.equal(issue.severity, "warning");
});

test("does not flag a name that only appears once (no collision)", () => {
  const result = lint("def draw():\n    total_score = 0\n    forward(total_score)\n");
  assert.deepEqual(rules(result).filter((r) => r === "similar-names"), []);
});

test("does not flag a name that's read but never assigned under a similar spelling", () => {
  // totalScore here is only ever read (never assigned) - that's a plain
  // "undefined name" case the runtime already reports clearly; the linter's
  // similar-names rule is specifically about two *bound* near-duplicates.
  const result = lint("def draw():\n    total_score = 0\n    forward(totalScore)\n");
  assert.deepEqual(rules(result).filter((r) => r === "similar-names"), []);
});

// --- unused-variable ---

test("flags a local variable assigned but never read in its function", () => {
  const result = lint("def draw():\n    unused = 5\n    forward(1)\n");
  const issue = result.issues.find((i) => i.rule === "unused-variable");
  assert.ok(issue);
  assert.match(issue.message, /'unused'/);
  assert.match(issue.message, /draw\(\)/);
});

test("flags a top-level variable assigned but never read anywhere", () => {
  const result = lint("leftover = 42\n\ndef draw():\n    forward(1)\n");
  const issue = result.issues.find((i) => i.rule === "unused-variable");
  assert.ok(issue);
  assert.equal(issue.line, 1);
});

test("does not flag a shared top-level variable read in a different function", () => {
  const src = "clicked = False\n\ndef draw():\n    if clicked:\n        forward(1)\n\ndef mousePressed():\n    clicked = True\n";
  const result = lint(src);
  assert.deepEqual(rules(result).filter((r) => r === "unused-variable"), []);
});

test("does not flag a local variable that's read after being reassigned", () => {
  const result = lint("def draw():\n    x = 1\n    x = x + 1\n    forward(x)\n");
  assert.deepEqual(rules(result).filter((r) => r === "unused-variable"), []);
});

test("does not flag an unused for-loop variable (idiomatic: for i in range(n))", () => {
  const result = lint("def draw():\n    for i in range(6):\n        forward(1)\n");
  assert.deepEqual(rules(result).filter((r) => r === "unused-variable"), []);
});

test("does not flag unused function parameters", () => {
  const result = lint("def draw():\n    helper(5)\n\ndef helper(unused_param):\n    forward(1)\n");
  assert.deepEqual(rules(result).filter((r) => r === "unused-variable"), []);
});

test("a variable used only inside a nested if/for/while body still counts as used", () => {
  const result = lint("def draw():\n    x = 5\n    for i in range(3):\n        if i > 0:\n            forward(x)\n");
  assert.deepEqual(rules(result).filter((r) => r === "unused-variable"), []);
});

test("only reports a given unused local once even if assigned multiple times", () => {
  const result = lint("def draw():\n    x = 1\n    x = 2\n    x = 3\n    forward(1)\n");
  assert.equal(result.issues.filter((i) => i.rule === "unused-variable").length, 1);
});

// --- line-too-long ---

test("flags a line over 100 characters", () => {
  const longLine = "forward(" + "1".repeat(100) + ")";
  const result = lint(`def draw():\n    ${longLine}\n`);
  const issue = result.issues.find((i) => i.rule === "line-too-long");
  assert.ok(issue);
  assert.equal(issue.line, 2);
});

test("does not flag a normal-length line", () => {
  const result = lint("def draw():\n    forward(1)\n");
  assert.deepEqual(rules(result).filter((r) => r === "line-too-long"), []);
});

// --- issues are sorted by line ---

test("issues are sorted by line number", () => {
  const src = "leftover = 1\n\ndef draw():\n    if a == True:\n        forward(1)\n";
  const result = lint(src);
  const lines = result.issues.map((i) => i.line);
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
});
