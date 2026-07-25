import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleProject } from "../src/modules.js";
import { BambooSyntaxError } from "../src/errors.js";

function run(mainSrc, files, rtExtra = {}) {
  const code = assembleProject(mainSrc, (name) => files[name] ?? null, "canvas");
  const calls = [];
  const rt = {
    __line: 0,
    __truthy: (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)),
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
