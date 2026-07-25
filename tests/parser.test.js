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

// --- Modules (spec section 6) ---

test("parses 'import name'", () => {
  const ast = parse("import panda\n");
  assert.equal(ast.body[0].type, "Import");
  assert.equal(ast.body[0].module, "panda");
});

test("parses 'from name import a, b as c'", () => {
  const ast = parse("from panda import draw_panda, panda_walk as walk\n");
  const node = ast.body[0];
  assert.equal(node.type, "FromImport");
  assert.equal(node.module, "panda");
  assert.deepEqual(node.names, [
    { name: "draw_panda", alias: null },
    { name: "panda_walk", alias: "walk" },
  ]);
});

test("parses module_name.function_name() as a Call with a module field", () => {
  const ast = parse("import panda\n\ndef draw():\n    panda.draw_panda(1, 2)\n");
  const call = ast.body[1].body[0].value;
  assert.equal(call.type, "Call");
  assert.equal(call.module, "panda");
  assert.equal(call.callee, "draw_panda");
  assert.equal(call.args.length, 2);
});

test("rejects import/from inside a function body", () => {
  assert.throws(() => parse("def f():\n    import panda\n"), (err) => {
    assert.ok(err instanceof BambooSyntaxError);
    assert.match(err.message, /top of the file/);
    return true;
  });
});

test("rejects '.' after anything other than a plain name", () => {
  assert.throws(() => parse("import panda\n\ndef draw():\n    panda.draw_panda(1, 2).oops\n"), BambooSyntaxError);
});

// --- Terminal/script mode enabler: top-level control flow ---

test("allows if/for/while at the top level (needed for Terminal mode scripts)", () => {
  const ast = parse("for i in range(3):\n    print(i)\n");
  assert.equal(ast.body[0].type, "For");
});

test("still rejects bare 'return' at the top level", () => {
  assert.throws(() => parse("return 1\n"), (err) => {
    assert.ok(err instanceof BambooSyntaxError);
    assert.match(err.message, /inside a function/);
    return true;
  });
});
