import { test } from "node:test";
import assert from "node:assert/strict";
import { TerminalRuntime, StoppedError } from "../src/terminal-runtime.js";
import { BambooRuntimeError } from "../src/errors.js";

test("print() formats values Python-style (True/False/None, quoted list items)", () => {
  const rt = new TerminalRuntime();
  const lines = [];
  rt.onPrint = (line) => lines.push(line);
  rt.print(true, false, null, undefined, [1, "a", [2, "b"]]);
  assert.deepEqual(lines, ["True False None None [1, 'a', [2, 'b']]"]);
});

test("print() is a no-op with no onPrint handler attached", () => {
  const rt = new TerminalRuntime();
  assert.doesNotThrow(() => rt.print("hello"));
});

test("input() resolves with what onInputRequest hands back", async () => {
  const rt = new TerminalRuntime();
  rt.onInputRequest = (prompt, resolve) => resolve(`echo:${prompt}`);
  const value = await rt.input("name? ");
  assert.equal(value, "echo:name? ");
});

test("input() with no onInputRequest handler resolves to an empty string", async () => {
  const rt = new TerminalRuntime();
  const value = await rt.input("anything");
  assert.equal(value, "");
});

test("cancelPendingInput() rejects a pending input() with StoppedError", async () => {
  const rt = new TerminalRuntime();
  rt.onInputRequest = () => {}; // never resolves on its own
  const pending = rt.input("wait");
  rt.cancelPendingInput();
  await assert.rejects(pending, StoppedError);
});

test("cancelPendingInput() is a harmless no-op when nothing is pending", () => {
  const rt = new TerminalRuntime();
  assert.doesNotThrow(() => rt.cancelPendingInput());
});

test("dispose() cancels any pending input", async () => {
  const rt = new TerminalRuntime();
  rt.onInputRequest = () => {};
  const pending = rt.input("wait");
  rt.dispose();
  await assert.rejects(pending, StoppedError);
});

test("canvas-only builtins are stubbed with a friendly redirect error", () => {
  const rt = new TerminalRuntime();
  for (const name of ["background", "forward", "ellipse", "push", "createCanvas"]) {
    assert.throws(() => rt[name](), (err) => {
      assert.ok(err instanceof BambooRuntimeError);
      assert.match(err.message, /Terminal mode/);
      assert.match(err.message, new RegExp(`^${name}\\(\\)`));
      return true;
    });
  }
});

test("range() and print()/input() are NOT stubbed out", () => {
  const rt = new TerminalRuntime();
  assert.deepEqual(rt.range(3), [0, 1, 2]);
  assert.equal(typeof rt.print, "function");
  assert.equal(typeof rt.input, "function");
});

test("inherits the shared guard/truthiness logic from RuntimeBase", () => {
  const rt = new TerminalRuntime();
  assert.equal(rt.__truthy(0), false);
  assert.equal(rt.__truthy([1]), true);
  rt.resetGuard();
  assert.throws(() => {
    for (let i = 0; i < 400000; i++) rt.__tick(1);
  }, BambooRuntimeError);
});
