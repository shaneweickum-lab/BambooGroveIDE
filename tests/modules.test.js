import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleProject, resolveProject, STDLIB_MODULE_NAMES } from "../src/modules.js";
import { parse } from "../src/parser.js";
import { BambooSyntaxError } from "../src/errors.js";

function run(mainSrc, files, rtExtra = {}) {
  const code = assembleProject(mainSrc, (name) => files[name] ?? null, "canvas");
  const calls = [];
  const rt = {
    __line: 0,
    __truthy: (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)),
    __mul: (a, b) => (typeof a === "number" && typeof b === "number" ? a * b : a.repeat(b)),
    forward: (...a) => calls.push(["forward", ...a]),
    circle: (...a) => calls.push(["circle", ...a]),
    ...rtExtra,
  };
  const program = new Function("__rt", code)(rt);
  return { program, calls };
}

test("plain 'import module' exposes dotted calls", () => {
  const files = { panda: "def draw_panda(x, y):\n    circle(x, y, 20)\n" };
  const { program, calls } = run("import panda\n\ndef draw():\n    panda.draw_panda(1, 2)\n", files);
  program.draw();
  assert.deepEqual(calls, [["circle", 1, 2, 20]]);
});

test("'from module import fn as alias' binds the alias directly", () => {
  const files = { panda: "def panda_walk():\n    forward(10)\n" };
  const { program, calls } = run("from panda import panda_walk as walk\n\ndef draw():\n    walk()\n", files);
  program.draw();
  assert.deepEqual(calls, [["forward", 10]]);
});

test("transitive imports resolve in dependency order", () => {
  const files = {
    panda: "def panda_walk():\n    forward(10)\n",
    bamboo: "import panda\n\ndef draw_stalk():\n    panda.panda_walk()\n    forward(60)\n",
  };
  const { program, calls } = run("from bamboo import draw_stalk\n\ndef draw():\n    draw_stalk()\n", files);
  program.draw();
  assert.deepEqual(calls, [["forward", 10], ["forward", 60]]);
});

test("a missing sibling file raises a friendly, line-numbered error", () => {
  assert.throws(() => assembleProject("import nope\n", () => null, "canvas"), (err) => {
    assert.ok(err instanceof BambooSyntaxError);
    assert.match(err.message, /nope\.bs/);
    assert.equal(err.line, 1);
    return true;
  });
});

test("a circular import is rejected, naming the full cycle", () => {
  const files = {
    a: "import b\n\ndef fa():\n    return 1\n",
    b: "import a\n\ndef fb():\n    return 2\n",
  };
  assert.throws(() => assembleProject("import a\n", (name) => files[name] ?? null, "canvas"), (err) => {
    assert.ok(err instanceof BambooSyntaxError);
    assert.match(err.message, /Circular import/);
    assert.match(err.message, /main -> a -> b -> a/);
    return true;
  });
});

test("a self-import is also detected as circular", () => {
  const files = { a: "import a\n\ndef fa():\n    return 1\n" };
  assert.throws(() => assembleProject("import a\n", (name) => files[name] ?? null, "canvas"), /Circular import/);
});

test("a syntax error inside an imported module is attributed to that file", () => {
  const files = { panda: "def draw_panda(\n" };
  assert.throws(() => assembleProject("import panda\n", (name) => files[name] ?? null, "canvas"), (err) => {
    assert.ok(err instanceof BambooSyntaxError);
    assert.match(err.message, /panda\.bs/);
    return true;
  });
});

test("no imports at all just compiles the main file alone", () => {
  const { program, calls } = run("def draw():\n    forward(5)\n", {});
  program.draw();
  assert.deepEqual(calls, [["forward", 5]]);
});

// --- Stdlib mocks (spec 3.2): import <name> resolves to __rt.__stdlib.<name> ---

test("STDLIB_MODULE_NAMES lists the prioritized teaching subset", () => {
  for (const name of ["math", "random", "time", "os", "sys", "json", "re", "string", "collections", "itertools", "datetime"]) {
    assert.ok(STDLIB_MODULE_NAMES.has(name), `expected ${name} in STDLIB_MODULE_NAMES`);
  }
});

test("'import <stdlib-name>' with no sibling file resolves to a stdlib mock, not an error", () => {
  const { program, calls } = run(
    "import math\n\ndef draw():\n    forward(math.double(4))\n",
    {},
    { __stdlib: { math: { double: (n) => n * 2 } } }
  );
  program.draw();
  assert.deepEqual(calls, [["forward", 8]]);
});

test("'from <stdlib-name> import x' binds correctly", () => {
  const { program, calls } = run(
    "from math import double\n\ndef draw():\n    forward(double(4))\n",
    {},
    { __stdlib: { math: { double: (n) => n * 2 } } }
  );
  program.draw();
  assert.deepEqual(calls, [["forward", 8]]);
});

test("a project's own sibling file takes precedence over a stdlib mock of the same name", () => {
  const files = { math: "def double(n):\n    return n * 100\n" };
  const { program, calls } = run(
    "import math\n\ndef draw():\n    forward(math.double(4))\n",
    files,
    { __stdlib: { math: { double: () => { throw new Error("stdlib mock should not have been used"); } } } }
  );
  program.draw();
  assert.deepEqual(calls, [["forward", 400]]);
});

test("resolveProject reports stdlib names separately from sibling-file order/resolved", () => {
  const mainAst = parse("import math\nimport panda\n");
  const files = { panda: "def draw_panda():\n    return 1\n" };
  const { order, resolved, stdlibNames } = resolveProject(mainAst, (name) => files[name] ?? null);
  assert.deepEqual(order, ["panda"]);
  assert.ok(resolved.has("panda"));
  assert.ok(!resolved.has("math"));
  assert.deepEqual([...stdlibNames], ["math"]);
});

test("an unknown module name (not a sibling file, not a stdlib name) still raises the friendly missing-file error", () => {
  assert.throws(() => assembleProject("import totally_not_real\n", () => null, "canvas"), (err) => {
    assert.ok(err instanceof BambooSyntaxError);
    assert.match(err.message, /totally_not_real\.bs/);
    return true;
  });
});
