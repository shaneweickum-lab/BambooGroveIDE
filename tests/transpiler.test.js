import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/parser.js";
import { transpile } from "../src/transpiler.js";
import { BambooSyntaxError } from "../src/errors.js";

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
