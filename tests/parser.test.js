import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, BambooSyntaxError } from "../src/parser.js";

test("parses two function defs with statements", () => {
  const src = "def setup():\n    background(255, 255, 255)\n\ndef draw():\n    forward(100)\n    turn(45)\n";
  const ast = parse(src);
  assert.equal(ast.type, "Program");
  assert.equal(ast.body.length, 2);
  assert.equal(ast.body[0].name, "setup");
  assert.equal(ast.body[1].name, "draw");
  assert.equal(ast.body[1].body.length, 2);
});

test("parses if/elif/else chains", () => {
  const src = "def f():\n    if x > 0:\n        forward(1)\n    elif x < 0:\n        forward(2)\n    else:\n        forward(3)\n";
  const ast = parse(src);
  const ifNode = ast.body[0].body[0];
  assert.equal(ifNode.type, "If");
  assert.equal(ifNode.cases.length, 2);
  assert.ok(ifNode.orelse);
});

test("parses for-in-range and while loops", () => {
  const src = "def f():\n    for i in range(8):\n        forward(1)\n    while i > 0:\n        i = i - 1\n";
  const ast = parse(src);
  const [forNode, whileNode] = ast.body[0].body;
  assert.equal(forNode.type, "For");
  assert.equal(forNode.varName, "i");
  assert.equal(whileNode.type, "While");
});

test("parses list literals and indexing", () => {
  const src = "def f():\n    colors = [1, 2, 3]\n    x = colors[0]\n";
  const ast = parse(src);
  const [assignList, assignIndex] = ast.body[0].body;
  assert.equal(assignList.value.type, "ListLiteral");
  assert.equal(assignList.value.elements.length, 3);
  assert.equal(assignIndex.value.type, "Index");
});

test("parses boolean/comparison/arithmetic precedence", () => {
  const src = "def f():\n    y = 1 + 2 * 3 == 7 and not False\n";
  const ast = parse(src);
  const assign = ast.body[0].body[0];
  assert.equal(assign.value.type, "BoolOp");
  assert.equal(assign.value.op, "and");
  assert.equal(assign.value.left.type, "Compare");
  assert.equal(assign.value.left.left.type, "BinOp");
  assert.equal(assign.value.left.left.op, "+");
});

test("supports single-line block bodies", () => {
  const ast = parse("def f():\n    if x: forward(1)\n");
  assert.equal(ast.body[0].body[0].cases[0].body[0].type, "ExprStmt");
});

test("throws a friendly error for a missing colon", () => {
  assert.throws(() => parse("def f()\n    forward(1)\n"), (err) => {
    assert.ok(err instanceof BambooSyntaxError);
    assert.match(err.message, /:/);
    return true;
  });
});

test("throws when assigning to something that isn't a name or index", () => {
  assert.throws(() => parse("def f():\n    1 + 1 = 2\n"), BambooSyntaxError);
});
