import { test } from "node:test";
import assert from "node:assert/strict";
import { BambooRuntime } from "../src/runtime.js";
import { BambooRuntimeError } from "../src/errors.js";

function fakeCanvas() {
  const ctx = {
    fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() {}, fill() {}, arc() {}, fillText() {},
  };
  return {
    width: 400, height: 400,
    getContext: () => ctx,
    addEventListener: () => {},
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
}

test("range() covers the 1, 2, and 3-argument forms like Python", () => {
  const rt = new BambooRuntime(fakeCanvas());
  assert.deepEqual(rt.range(3), [0, 1, 2]);
  assert.deepEqual(rt.range(2, 5), [2, 3, 4]);
  assert.deepEqual(rt.range(10, 4, -2), [10, 8, 6]);
});

test("range() rejects a zero step", () => {
  const rt = new BambooRuntime(fakeCanvas());
  assert.throws(() => rt.range(0, 10, 0), BambooRuntimeError);
});

test("__truthy matches Python-ish truthiness, including empty lists", () => {
  const rt = new BambooRuntime(fakeCanvas());
  assert.equal(rt.__truthy(0), false);
  assert.equal(rt.__truthy(""), false);
  assert.equal(rt.__truthy([]), false);
  assert.equal(rt.__truthy([0]), true);
  assert.equal(rt.__truthy("x"), true);
  assert.equal(rt.__truthy(NaN), false);
});

test("__and / __or short-circuit and return Python-style operand values", () => {
  const rt = new BambooRuntime(fakeCanvas());
  let rightCalled = false;
  const right = () => { rightCalled = true; return 5; };
  assert.equal(rt.__and(() => false, right), false);
  assert.equal(rightCalled, false);
  assert.equal(rt.__or(() => "hi", right), "hi");
  assert.equal(rightCalled, false);
  assert.equal(rt.__and(() => 1, right), 5);
  assert.equal(rt.__or(() => 0, right), 5);
});

test("__index supports negative indices and rejects out-of-range access", () => {
  const rt = new BambooRuntime(fakeCanvas());
  const list = [10, 20, 30];
  assert.equal(rt.__index(list, -1, 1), 30);
  assert.throws(() => rt.__index(list, 5, 1), BambooRuntimeError);
  assert.throws(() => rt.__index(42, 0, 1), BambooRuntimeError);
});

test("__setIndex mutates the list in place", () => {
  const rt = new BambooRuntime(fakeCanvas());
  const list = [1, 2, 3];
  rt.__setIndex(list, 1, 99, 1);
  assert.deepEqual(list, [1, 99, 3]);
});

test("__iter accepts lists and rejects non-iterables with a friendly message", () => {
  const rt = new BambooRuntime(fakeCanvas());
  assert.deepEqual(rt.__iter([1, 2], 1), [1, 2]);
  assert.throws(() => rt.__iter(42, 1), (err) => {
    assert.ok(err instanceof BambooRuntimeError);
    assert.match(err.message, /list or range/);
    return true;
  });
});

test("__tick throws once the per-call iteration guard is exceeded", () => {
  const rt = new BambooRuntime(fakeCanvas());
  rt.resetGuard();
  assert.throws(() => {
    for (let i = 0; i < 400000; i++) rt.__tick(1);
  }, BambooRuntimeError);
});

test("turtle forward/turn move using a compass heading (0 = up, clockwise-positive)", () => {
  const rt = new BambooRuntime(fakeCanvas());
  const [startX, startY] = [rt.turtleX, rt.turtleY];
  rt.forward(100);
  assert.ok(Math.abs(rt.turtleX - startX) < 1e-9);
  assert.ok(rt.turtleY < startY); // "up" decreases y on a canvas
  rt.turn(90);
  assert.equal(rt.heading, 90);
  rt.turn(-100);
  assert.equal(rt.heading, 350);
});

test("a closed polygon (for i in range(4): forward/turn(90)) returns to start", () => {
  const rt = new BambooRuntime(fakeCanvas());
  const [startX, startY] = [rt.turtleX, rt.turtleY];
  for (let i = 0; i < 4; i++) {
    rt.forward(50);
    rt.turn(90);
  }
  assert.ok(Math.abs(rt.turtleX - startX) < 1e-9);
  assert.ok(Math.abs(rt.turtleY - startY) < 1e-9);
  assert.equal(rt.heading, 0);
});

test("pen_up suppresses drawing but still moves the turtle", () => {
  const rt = new BambooRuntime(fakeCanvas());
  let lineCalls = 0;
  rt.line = () => { lineCalls++; };
  rt.pen_up();
  rt.forward(10);
  assert.equal(lineCalls, 0);
  rt.pen_down();
  rt.forward(10);
  assert.equal(lineCalls, 1);
});

test("no_loop/loop toggle the looping flag and loop() notifies onLoopResume only when resuming", () => {
  const rt = new BambooRuntime(fakeCanvas());
  let resumed = 0;
  rt.onLoopResume = () => resumed++;
  rt.loop(); // already looping — should not fire
  assert.equal(resumed, 0);
  rt.no_loop();
  assert.equal(rt.looping, false);
  rt.loop();
  assert.equal(rt.looping, true);
  assert.equal(resumed, 1);
});
