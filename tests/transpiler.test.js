import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/parser.js";
import { transpile, transpileLibrary } from "../src/transpiler.js";
import { BambooSyntaxError } from "../src/errors.js";
import { PYTHON_STRING_METHODS_IMPL } from "../src/pystrings.js";

function makeFakeRuntime() {
  const calls = [];
  const rt = {
    mouseX: 5, mouseY: 6, frameCount: 2, keyPressed: "a",
    __line: 0,
    __truthy(v) { return Array.isArray(v) ? v.length > 0 : Boolean(v); },
    __not(v) { return !this.__truthy(v); },
    __and(l, r) { const v = l(); return this.__truthy(v) ? r() : v; },
    __or(l, r) { const v = l(); return this.__truthy(v) ? v : r(); },
    __tick() {},
    __iter(v) { return v; },
    __index(obj, i) { return obj[i < 0 ? obj.length + i : i]; },
    __setIndex(obj, i, v) { obj[i] = v; return v; },
    __append(list, v) { list.push(v); },
    len(v) { return v.length; },
    __mul(a, b) {
      if (typeof a === "string" && typeof b === "number") return a.repeat(b);
      if (typeof a === "number" && typeof b === "string") return b.repeat(a);
      return a * b;
    },
    __strmethod(obj, name, args, line) {
      if (typeof obj === "string") return PYTHON_STRING_METHODS_IMPL[name](obj, args, line);
      return obj[name](...args);
    },
    __fstr(v, spec) {
      if (spec == null) {
        if (v === null || v === undefined) return "None";
        if (typeof v === "boolean") return v ? "True" : "False";
        return String(v);
      }
      const m = /^\.(\d+)f$/.exec(spec);
      if (m) return v.toFixed(Number(m[1]));
      throw new Error(`bad f-string spec ${spec}`);
    },
    range(a, b, c) {
      let start, stop, step;
      if (b === undefined) { start = 0; stop = a; step = 1; }
      else if (c === undefined) { start = a; stop = b; step = 1; }
      else { start = a; stop = b; step = c; }
      const out = [];
      for (let v = start; step > 0 ? v < stop : v > stop; v += step) out.push(v);
      return out;
    },
  };
  for (const name of ["background", "stroke", "forward", "turn"]) {
    rt[name] = (...args) => calls.push([name, ...args]);
  }
  return { rt, calls };
}

function run(src) {
  const ast = parse(src);
  const code = transpile(ast);
  const factory = new Function("__rt", code);
  const { rt, calls } = makeFakeRuntime();
  const program = factory(rt);
  return { program, rt, calls };
}

test("runs setup and draw against the runtime", () => {
  const { program, calls } = run(
    "def setup():\n    background(1, 2, 3)\n\ndef draw():\n    forward(10)\n    turn(90)\n"
  );
  program.setup();
  program.draw();
  assert.deepEqual(calls, [["background", 1, 2, 3], ["forward", 10], ["turn", 90]]);
});

test("for-in-range loop runs the right number of times", () => {
  const { program, calls } = run("def draw():\n    for i in range(3):\n        forward(i)\n");
  program.draw();
  assert.deepEqual(calls, [["forward", 0], ["forward", 1], ["forward", 2]]);
});

test("while loop and reassignment work like plain variables", () => {
  const { program, calls } = run(
    "def draw():\n    i = 0\n    while i < 3:\n        forward(i)\n        i = i + 1\n"
  );
  program.draw();
  assert.deepEqual(calls, [["forward", 0], ["forward", 1], ["forward", 2]]);
});

test("if/elif/else picks the right branch, and user functions are callable from draw", () => {
  const src = [
    "def draw():",
    "    check(-5)",
    "",
    "def check(x):",
    "    if x > 0:",
    "        forward(1)",
    "    elif x < 0:",
    "        forward(2)",
    "    else:",
    "        forward(3)",
    "",
  ].join("\n");
  const { program, calls } = run(src);
  program.draw();
  assert.deepEqual(calls, [["forward", 2]]);
});

test("list literals and indexing round-trip through the runtime helpers", () => {
  const { program, calls } = run(
    "def draw():\n    xs = [10, 20, 30]\n    xs[1] = 99\n    forward(xs[1])\n"
  );
  program.draw();
  assert.deepEqual(calls, [["forward", 99]]);
});

test("global read-only names map to runtime properties", () => {
  const { program, calls } = run("def draw():\n    forward(mouse_x)\n    turn(frame_count)\n");
  program.draw();
  assert.deepEqual(calls, [["forward", 5], ["turn", 2]]);
});

test("string equality uses strict comparison semantics", () => {
  const { program, calls } = run(
    "def draw():\n    if 'a' == 'a':\n        forward(1)\n    if 1 == 2:\n        forward(2)\n"
  );
  program.draw();
  assert.deepEqual(calls, [["forward", 1]]);
});

test("rejects reserved JS words as identifiers", () => {
  assert.throws(() => transpile(parse("def f():\n    class = 1\n")), BambooSyntaxError);
});

test("rejects double-underscore names as reserved", () => {
  assert.throws(() => transpile(parse("def f():\n    __secret = 1\n")), BambooSyntaxError);
});

test("embeds __rt.__line markers for error mapping", () => {
  const code = transpile(parse("def draw():\n    forward(1)\n    turn(2)\n"));
  assert.match(code, /__rt\.__line = 2;/);
  assert.match(code, /__rt\.__line = 3;/);
});

// --- Top-level shared variables (spec 3.6 enabler) ---

test("top-level assignments become variables shared across every function", () => {
  const src = [
    "clicks = 0",
    "",
    "def draw():",
    "    clicks = clicks + 1",
    "",
    "def mousePressed():",
    "    clicks = clicks + 10",
    "    forward(clicks)",
    "",
  ].join("\n");
  const { program, calls } = run(src);
  program.draw();
  program.mousePressed();
  assert.deepEqual(calls, [["forward", 11]]); // 0 -> +1 (draw) -> +10 (mousePressed)
});

test("top-level control flow is allowed (needed for Terminal/script mode)", () => {
  const ast = parse("if True:\n    x = 1\n");
  assert.equal(ast.body[0].type, "If");
});

test("bare 'return' at the top level is still rejected with a friendly error", () => {
  assert.throws(() => parse("return 1\n"), (err) => {
    assert.ok(err instanceof BambooSyntaxError);
    assert.match(err.message, /inside a function/);
    return true;
  });
});

// --- p5.js-compatible layer (spec 3.6) ---

test("returns optional lifecycle callbacks (mousePressed, keyPressed, ...) alongside setup/draw", () => {
  const src = [
    "def setup():",
    "    background(0)",
    "",
    "def mousePressed():",
    "    forward(1)",
    "",
  ].join("\n");
  const { program } = run(src);
  assert.equal(typeof program.setup, "function");
  assert.equal(typeof program.mousePressed, "function");
  assert.equal(program.draw, null);
  assert.equal(program.keyPressed, null);
});

test("new p5.js-style builtins map to the matching __rt method", () => {
  const code = transpile(parse("def draw():\n    ellipse(1, 2, 3, 4)\n    push()\n    translate(5, 6)\n    pop()\n"));
  assert.match(code, /__rt\.ellipse\(1, 2, 3, 4\)/);
  assert.match(code, /__rt\.push\(\)/);
  assert.match(code, /__rt\.translate\(5, 6\)/);
  assert.match(code, /__rt\.pop\(\)/);
});

test("PI/TWO_PI and other p5.js globals resolve through __rt", () => {
  const code = transpile(parse("def draw():\n    rotate(PI)\n    forward(mouseX)\n    turn(width)\n"));
  assert.match(code, /__rt\.rotate\(__rt\.PI\)/);
  assert.match(code, /__rt\.forward\(__rt\.mouseX\)/);
  assert.match(code, /__rt\.turn\(__rt\.width\)/);
});

// --- Terminal mode (spec 3.6): async codegen ---

function makeTerminalRuntime() {
  const calls = [];
  const rt = {
    __line: 0,
    __truthy: (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)),
    __tick() {},
    __iter: (v) => v,
    __andAsync: async (l, r) => { const v = await l(); return rt.__truthy(v) ? await r() : v; },
    __orAsync: async (l, r) => { const v = await l(); return rt.__truthy(v) ? v : await r(); },
    range(a, b, c) {
      let s, e, st;
      if (b === undefined) { s = 0; e = a; st = 1; } else if (c === undefined) { s = a; e = b; st = 1; } else { s = a; e = b; st = c; }
      const out = [];
      for (let v = s; st > 0 ? v < e : v > e; v += st) out.push(v);
      return out;
    },
    print: (...a) => calls.push(["print", ...a]),
    input: async (p) => `answered:${p}`,
    __mul: (a, b) => a * b,
  };
  return { rt, calls };
}

test("terminal mode emits async functions and awaits every call", () => {
  const code = transpile(parse("def draw():\n    forward(1)\n"), { mode: "terminal" });
  assert.match(code, /async function draw\(\)/);
  assert.match(code, /\(await __rt\.forward\(1\)\)/);
});

test("terminal mode: top-level script runs via __ready, print/input work", async () => {
  const src = "name = input('Name? ')\nprint('Hi ' + name)\n";
  const code = transpile(parse(src), { mode: "terminal" });
  const { rt, calls } = makeTerminalRuntime();
  const program = new Function("__rt", code)(rt);
  await program.__ready;
  assert.deepEqual(calls, [["print", "Hi answered:Name? "]]);
});

test("terminal mode: top-level for-loop declares its loop variable correctly", async () => {
  const src = "for i in range(3):\n    print(i)\n";
  const code = transpile(parse(src), { mode: "terminal" });
  const { rt, calls } = makeTerminalRuntime();
  const program = new Function("__rt", code)(rt);
  await program.__ready;
  assert.deepEqual(calls, [["print", 0], ["print", 1], ["print", 2]]);
});

test("terminal mode: 'and'/'or' with an awaited operand still short-circuits correctly", async () => {
  const src = "if 'Ada' == 'Ada' and input('really?') == 'yes':\n    print('special')\n";
  const code = transpile(parse(src), { mode: "terminal" });
  const { rt, calls } = makeTerminalRuntime();
  rt.input = async () => "yes";
  const program = new Function("__rt", code)(rt);
  await program.__ready;
  assert.deepEqual(calls, [["print", "special"]]);
});

test("canvas mode (default) is unaffected: no async/await anywhere in the output", () => {
  const code = transpile(parse("def draw():\n    forward(1)\n    if True and False:\n        turn(1)\n"));
  assert.doesNotMatch(code, /async/);
  assert.doesNotMatch(code, /await/);
});

// --- Library modules (spec section 6) ---

test("transpileLibrary wraps every top-level function into an IIFE namespace object", () => {
  const code = transpileLibrary(parse("def draw_panda(x, y):\n    circle(x, y, 20)\n\ndef helper():\n    return 1\n"));
  assert.match(code, /^\(\(\) => \{/);
  assert.match(code, /return \{ draw_panda: .*, helper: .* \};/);
  const rt = { circle: () => {} };
  const ns = new Function("__rt", `return ${code};`)(rt);
  assert.equal(typeof ns.draw_panda, "function");
  assert.equal(typeof ns.helper, "function");
});

test("transpileLibrary does not restrict exports to the lifecycle name list", () => {
  const code = transpileLibrary(parse("def totally_custom_name():\n    return 1\n"));
  const ns = new Function("__rt", `return ${code};`)({});
  assert.equal(ns.totally_custom_name(), 1);
});

// --- General attribute access / method calls (spec 3.6 Phase 2 enabler) ---

test("attribute reads, .attribute = assignment, and method calls compile to plain JS", () => {
  const code = transpile(parse("def draw():\n    v = createVector(1, 2)\n    x = v.x\n    v.x = 5\n    v.add(v)\n"));
  assert.match(code, /x = v\.x;/);
  assert.match(code, /v\.x = 5;/);
  assert.match(code, /v\.add\(v\);/);
});

test("method calls are awaited in terminal mode like any other call", () => {
  const code = transpile(parse("def draw():\n    v.add(w)\n"), { mode: "terminal" });
  assert.match(code, /\(await v\.add\(w\)\)/);
});

test("rejects 'constructor'/'prototype' as an attribute or method name", () => {
  assert.throws(() => transpile(parse("def draw():\n    x = v.constructor\n")), BambooSyntaxError);
  assert.throws(() => transpile(parse("def draw():\n    v.constructor()\n")), BambooSyntaxError);
  assert.throws(() => transpile(parse("def draw():\n    v.prototype = 1\n")), BambooSyntaxError);
});

test("end-to-end: MethodCall codegen works on real JS values (e.g. list methods)", () => {
  const code = transpile(parse("def draw():\n    xs = [1, 2, 3]\n    xs.reverse()\n    forward(xs[0])\n"));
  const calls = [];
  const rt = {
    forward: (n) => calls.push(n),
    __index: (obj, i) => obj[i],
  };
  const program = new Function("__rt", code)(rt);
  program.draw();
  assert.deepEqual(calls, [3]);
});

// --- f-strings ---

test("f-string parts concatenate through __rt.__fstr", () => {
  const code = transpile(parse('def draw():\n    forward(f"hi {name}!")\n'));
  assert.match(code, /__rt\.__fstr\(name, null, \d+\)/);
});

test("f-strings interpolate expressions using the runtime's __fstr", () => {
  const { program, calls } = run('def draw():\n    n = "Bo"\n    forward(f"hi {n}, total {1 + 2}")\n');
  program.draw();
  assert.deepEqual(calls, [["forward", "hi Bo, total 3"]]);
});

test("f-string format spec formats a number to fixed decimals", () => {
  const { program, calls } = run('def draw():\n    forward(f"{3.14159:.2f}")\n');
  program.draw();
  assert.deepEqual(calls, [["forward", "3.14"]]);
});

test("a call inside an f-string expression is still awaited in terminal mode", () => {
  const code = transpile(parse('def draw():\n    x = f"{g()}"\n'), { mode: "terminal" });
  assert.match(code, /__rt\.__fstr\(\(await g\(\)\), null, \d+\)/);
});

// --- len() / list.append() ---

test("len() maps to __rt.len", () => {
  const code = transpile(parse("def draw():\n    n = len(xs)\n"));
  assert.match(code, /__rt\.len\(xs\)/);
});

test("list.append(x) compiles to __rt.__append(list, x, line)", () => {
  const code = transpile(parse("def draw():\n    xs.append(1)\n"));
  assert.match(code, /__rt\.__append\(xs, 1, \d+\)/);
});

test("list.append(x) is awaited in terminal mode", () => {
  const code = transpile(parse("def draw():\n    xs.append(1)\n"), { mode: "terminal" });
  assert.match(code, /\(await __rt\.__append\(xs, 1, \d+\)\)/);
});

test("end-to-end: building a list with append() and reading it back with len()", () => {
  const { program, calls } = run(
    "def draw():\n    xs = []\n    for i in range(3):\n        xs.append(i * 2)\n    forward(len(xs))\n    forward(xs[2])\n"
  );
  program.draw();
  assert.deepEqual(calls, [["forward", 3], ["forward", 4]]);
});

// --- Python string methods ---

test("a Python string method compiles to __rt.__strmethod(obj, name, [args], line)", () => {
  const code = transpile(parse('def draw():\n    forward(name.upper())\n'));
  assert.match(code, /__rt\.__strmethod\(name, "upper", \[\], \d+\)/);
});

test("a Python string method with arguments passes them as an array literal", () => {
  const code = transpile(parse('def draw():\n    forward(name.replace("a", "b"))\n'));
  assert.match(code, /__rt\.__strmethod\(name, "replace", \["a", "b"\], \d+\)/);
});

test("a Python string method call is awaited in terminal mode", () => {
  const code = transpile(parse('def draw():\n    name.upper()\n'), { mode: "terminal" });
  assert.match(code, /\(await __rt\.__strmethod\(name, "upper", \[\], \d+\)\)/);
});

test("a method name NOT in the Python-string-method set still passes straight through (Vector/module calls unaffected)", () => {
  const code = transpile(parse("def draw():\n    v.add(1, 2)\n    panda.draw_panda(3, 4)\n"));
  assert.match(code, /v\.add\(1, 2\)/);
  assert.match(code, /panda\.draw_panda\(3, 4\)/);
  assert.doesNotMatch(code, /__strmethod/);
});

test("end-to-end: .upper()/.split()/.join() work through the real codegen path", () => {
  const { program, calls } = run(
    'def draw():\n    forward("hi".upper())\n    forward(",".join(["a", "b"]))\n'
  );
  program.draw();
  assert.deepEqual(calls, [["forward", "HI"], ["forward", "a,b"]]);
});

// --- Python's * (multiplication + string/list repeat) ---

test("* compiles to __rt.__mul(left, right, line)", () => {
  const code = transpile(parse("def draw():\n    forward(a * b)\n"));
  assert.match(code, /__rt\.__mul\(a, b, \d+\)/);
});

test("end-to-end: string/list repeat via *", () => {
  const { program, calls } = run('def draw():\n    forward("ab" * 3)\n    forward(4 * 5)\n');
  program.draw();
  assert.deepEqual(calls, [["forward", "ababab"], ["forward", 20]]);
});
