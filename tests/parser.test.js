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

test("parses 'in' as a Compare node distinct from 'for x in y:'", () => {
  const ast = parse("def f():\n    ok = ch in word\n");
  const assign = ast.body[0].body[0];
  assert.equal(assign.value.type, "Compare");
  assert.equal(assign.value.op, "in");
  assert.equal(assign.value.left.type, "Name");
  assert.equal(assign.value.left.name, "ch");
  assert.equal(assign.value.right.type, "Name");
  assert.equal(assign.value.right.name, "word");
});

test("parses 'not in' as a single Compare node (not a separate 'not' unary)", () => {
  const ast = parse("def f():\n    ok = ch not in word\n");
  const assign = ast.body[0].body[0];
  assert.equal(assign.value.type, "Compare");
  assert.equal(assign.value.op, "not in");
  assert.equal(assign.value.left.name, "ch");
  assert.equal(assign.value.right.name, "word");
});

test("leading 'not' still binds outside an 'in' comparison ('not X in Y' == 'not (X in Y)')", () => {
  const ast = parse("def f():\n    ok = not ch in word\n");
  const assign = ast.body[0].body[0];
  assert.equal(assign.value.type, "UnaryOp");
  assert.equal(assign.value.op, "not");
  assert.equal(assign.value.operand.type, "Compare");
  assert.equal(assign.value.operand.op, "in");
});

test("a 'for' loop header still parses correctly alongside the new 'in' comparison grammar", () => {
  const ast = parse("def f():\n    for i in range(8):\n        forward(1)\n");
  const forNode = ast.body[0].body[0];
  assert.equal(forNode.type, "For");
  assert.equal(forNode.varName, "i");
  assert.equal(forNode.iterable.type, "Call");
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

test("parses module_name.function_name() as a MethodCall", () => {
  const ast = parse("import panda\n\ndef draw():\n    panda.draw_panda(1, 2)\n");
  const call = ast.body[1].body[0].value;
  assert.equal(call.type, "MethodCall");
  assert.equal(call.object.type, "Name");
  assert.equal(call.object.name, "panda");
  assert.equal(call.method, "draw_panda");
  assert.equal(call.args.length, 2);
});

test("rejects import/from inside a function body", () => {
  assert.throws(() => parse("def f():\n    import panda\n"), (err) => {
    assert.ok(err instanceof BambooSyntaxError);
    assert.match(err.message, /top of the file/);
    return true;
  });
});

// --- General attribute access (spec 3.6 Phase 2 enabler, e.g. Vector's v.x) ---

test("parses .attribute reads and chained .attribute.method() calls", () => {
  const ast = parse("def draw():\n    x = v.x\n    v.copy().x\n");
  const readStmt = ast.body[0].body[0];
  assert.equal(readStmt.value.type, "Attribute");
  assert.equal(readStmt.value.object.name, "v");
  assert.equal(readStmt.value.name, "x");

  const chainStmt = ast.body[0].body[1];
  assert.equal(chainStmt.value.type, "Attribute");
  assert.equal(chainStmt.value.object.type, "MethodCall");
  assert.equal(chainStmt.value.object.method, "copy");
});

test("parses .attribute = value as an assignment target", () => {
  const ast = parse("def draw():\n    v.x = 5\n");
  const assign = ast.body[0].body[0];
  assert.equal(assign.type, "Assign");
  assert.equal(assign.target.type, "Attribute");
  assert.equal(assign.target.name, "x");
});

test("rejects calling the result of a call/method-call a second time", () => {
  assert.throws(() => parse("def f():\n    g()()\n"), BambooSyntaxError);
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

// --- f-strings ---

test("parses an f-string into an FString node with parsed sub-expressions", () => {
  const ast = parse('x = f"hi {name}!"\n');
  const value = ast.body[0].value;
  assert.equal(value.type, "FString");
  assert.equal(value.parts.length, 3);
  assert.deepEqual(value.parts[0], { type: "text", value: "hi " });
  assert.equal(value.parts[1].type, "expr");
  assert.equal(value.parts[1].expr.type, "Name");
  assert.equal(value.parts[1].expr.name, "name");
  assert.deepEqual(value.parts[2], { type: "text", value: "!" });
});

test("parses a full expression (not just a bare name) inside an f-string", () => {
  const ast = parse('x = f"{a + b * 2}"\n');
  const expr = ast.body[0].value.parts[0].expr;
  assert.equal(expr.type, "BinOp");
  assert.equal(expr.op, "+");
});

test("carries the format spec through onto the expr part", () => {
  const ast = parse('x = f"{y:.1f}"\n');
  assert.equal(ast.body[0].value.parts[0].spec, ".1f");
});

test("an f-string with no {} interpolation still works like a plain string", () => {
  const ast = parse('x = f"plain"\n');
  assert.deepEqual(ast.body[0].value.parts, [{ type: "text", value: "plain" }]);
});

test("rejects a malformed expression inside an f-string", () => {
  assert.throws(() => parse('x = f"{1 2}"\n'), (err) => {
    assert.ok(err instanceof BambooSyntaxError);
    assert.match(err.message, /Invalid expression inside f-string/);
    return true;
  });
});

// --- try / except / else / finally / raise (spec 3.2/6.8) ---

test("parses a basic try/except", () => {
  const ast = parse("def f():\n    try:\n        x = 1\n    except ValueError:\n        x = 2\n");
  const node = ast.body[0].body[0];
  assert.equal(node.type, "Try");
  assert.equal(node.body.length, 1);
  assert.equal(node.handlers.length, 1);
  assert.equal(node.handlers[0].exceptionName, "ValueError");
  assert.equal(node.handlers[0].bindName, null);
  assert.equal(node.orelse, null);
  assert.equal(node.finallyBody, null);
});

test("parses 'except X as name'", () => {
  const ast = parse("def f():\n    try:\n        x = 1\n    except ValueError as e:\n        print(e)\n");
  const handler = ast.body[0].body[0].handlers[0];
  assert.equal(handler.exceptionName, "ValueError");
  assert.equal(handler.bindName, "e");
});

test("parses a bare 'except:' as a catch-all handler (exceptionName null)", () => {
  const ast = parse("def f():\n    try:\n        x = 1\n    except:\n        x = 2\n");
  const handler = ast.body[0].body[0].handlers[0];
  assert.equal(handler.exceptionName, null);
  assert.equal(handler.bindName, null);
});

test("parses multiple except clauses in order", () => {
  const ast = parse(
    "def f():\n    try:\n        x = 1\n    except ValueError:\n        x = 2\n    except TypeError:\n        x = 3\n"
  );
  const handlers = ast.body[0].body[0].handlers;
  assert.equal(handlers.length, 2);
  assert.equal(handlers[0].exceptionName, "ValueError");
  assert.equal(handlers[1].exceptionName, "TypeError");
});

test("parses try/except/else/finally together", () => {
  const ast = parse(
    "def f():\n    try:\n        x = 1\n    except ValueError:\n        x = 2\n    else:\n        x = 3\n    finally:\n        x = 4\n"
  );
  const node = ast.body[0].body[0];
  assert.equal(node.orelse.length, 1);
  assert.equal(node.finallyBody.length, 1);
});

test("parses try/finally with no except clause at all", () => {
  const ast = parse("def f():\n    try:\n        x = 1\n    finally:\n        x = 2\n");
  const node = ast.body[0].body[0];
  assert.equal(node.handlers.length, 0);
  assert.equal(node.orelse, null);
  assert.equal(node.finallyBody.length, 1);
});

test("rejects a try with no except and no finally", () => {
  assert.throws(() => parse("def f():\n    try:\n        x = 1\n"), (err) => {
    assert.ok(err instanceof BambooSyntaxError);
    assert.match(err.message, /at least one 'except' clause or a 'finally'/);
    return true;
  });
});

test("rejects an 'else' clause on a try with no except clauses", () => {
  assert.throws(() => parse("def f():\n    try:\n        x = 1\n    finally:\n        x = 2\n    else:\n        x = 3\n"));
});

test("parses a bare 'raise' (re-raise) with a null value", () => {
  const ast = parse("def f():\n    try:\n        x = 1\n    except:\n        raise\n");
  const raiseNode = ast.body[0].body[0].handlers[0].body[0];
  assert.equal(raiseNode.type, "Raise");
  assert.equal(raiseNode.value, null);
});

test("parses 'raise ValueError(\"msg\")' as a Raise wrapping a Call", () => {
  const ast = parse('def f():\n    raise ValueError("bad")\n');
  const raiseNode = ast.body[0].body[0];
  assert.equal(raiseNode.type, "Raise");
  assert.equal(raiseNode.value.type, "Call");
  assert.equal(raiseNode.value.callee, "ValueError");
  assert.equal(raiseNode.value.args[0].value, "bad");
});

test("parses a bare 'raise ValueError' (no call) as a Raise wrapping a Name", () => {
  const ast = parse("def f():\n    raise ValueError\n");
  const raiseNode = ast.body[0].body[0];
  assert.equal(raiseNode.type, "Raise");
  assert.equal(raiseNode.value.type, "Name");
  assert.equal(raiseNode.value.name, "ValueError");
});
