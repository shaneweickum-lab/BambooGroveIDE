import { test } from "node:test";
import assert from "node:assert/strict";
import { BambooRuntime } from "../src/runtime.js";
import { BambooRuntimeError } from "../src/errors.js";

function fakeCanvas() {
  const ctx = {
    fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() {}, fill() {}, arc() {}, fillText() {}, ellipse() {}, save() {},
    restore() {}, setTransform() {}, clearRect() {}, translate() {}, rotate() {},
    scale() {}, closePath() {}, bezierCurveTo() {},
  };
  return {
    width: 400, height: 400, style: {},
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

// --- p5.js-compatible layer (spec 3.6) ---

test("fill/stroke accept grayscale, rgb, rgba, and a color() array", () => {
  const rt = new BambooRuntime(fakeCanvas());
  rt.fill(200);
  assert.equal(rt.fillColor, "rgba(200, 200, 200, 1)");
  rt.fill(10, 20, 30);
  assert.equal(rt.fillColor, "rgba(10, 20, 30, 1)");
  rt.fill(10, 20, 30, 128);
  assert.equal(rt.fillColor, `rgba(10, 20, 30, ${128 / 255})`);
  const c = rt.color(1, 2, 3);
  rt.fill(c);
  assert.equal(rt.fillColor, "rgba(1, 2, 3, 1)");
});

test("color()/red()/green()/blue()/alpha() round-trip channel values", () => {
  const rt = new BambooRuntime(fakeCanvas());
  const c = rt.color(10, 20, 30, 40);
  assert.equal(rt.red(c), 10);
  assert.equal(rt.green(c), 20);
  assert.equal(rt.blue(c), 30);
  assert.equal(rt.alpha(c), 40);
});

test("lerpColor interpolates each channel", () => {
  const rt = new BambooRuntime(fakeCanvas());
  const a = rt.color(0, 0, 0, 0);
  const b = rt.color(100, 200, 50, 255);
  assert.deepEqual(rt.lerpColor(a, b, 0.5), [50, 100, 25, 127.5]);
});

test("colorMode('hsb') converts hue/saturation/brightness to the right rgb", () => {
  const rt = new BambooRuntime(fakeCanvas());
  rt.colorMode("hsb");
  rt.fill(0, 100, 100); // pure red at full saturation/brightness
  assert.equal(rt.fillColor, "rgba(255, 0, 0, 1)");
});

test("math helpers: constrain, dist, lerp, map, max, min", () => {
  const rt = new BambooRuntime(fakeCanvas());
  assert.equal(rt.constrain(15, 0, 10), 10);
  assert.equal(rt.constrain(-5, 0, 10), 0);
  assert.equal(rt.dist(0, 0, 3, 4), 5);
  assert.equal(rt.lerp(0, 10, 0.5), 5);
  assert.equal(rt.map(5, 0, 10, 0, 100), 50);
  assert.equal(rt.map(15, 0, 10, 0, 100, true), 100);
  assert.equal(rt.max(1, 5, 3), 5);
  assert.equal(rt.min(1, 5, 3), 1);
  assert.equal(rt.max([1, 5, 3]), 5);
});

test("randomSeed() makes random() deterministic and repeatable", () => {
  const rt = new BambooRuntime(fakeCanvas());
  rt.randomSeed(42);
  const first = [rt.random(), rt.random(), rt.random()];
  rt.randomSeed(42);
  const second = [rt.random(), rt.random(), rt.random()];
  assert.deepEqual(first, second);
  for (const v of first) assert.ok(v >= 0 && v < 1);
});

test("random(max) and random(min, max) stay within bounds", () => {
  const rt = new BambooRuntime(fakeCanvas());
  rt.randomSeed(1);
  for (let i = 0; i < 20; i++) {
    const v = rt.random(10);
    assert.ok(v >= 0 && v < 10);
  }
  for (let i = 0; i < 20; i++) {
    const v = rt.random(5, 8);
    assert.ok(v >= 5 && v < 8);
  }
});

test("random(array) returns one of the array's own elements", () => {
  const rt = new BambooRuntime(fakeCanvas());
  rt.randomSeed(7);
  const options = ["a", "b", "c"];
  for (let i = 0; i < 10; i++) assert.ok(options.includes(rt.random(options)));
});

test("push/pop save and restore style state (not just the transform)", () => {
  const rt = new BambooRuntime(fakeCanvas());
  rt.fill(1, 2, 3);
  rt.push();
  rt.fill(9, 9, 9);
  assert.equal(rt.fillColor, "rgba(9, 9, 9, 1)");
  rt.pop();
  assert.equal(rt.fillColor, "rgba(1, 2, 3, 1)");
});

test("ellipseMode/rectMode change how the four shape params are interpreted", () => {
  const rt = new BambooRuntime(fakeCanvas());
  rt.ellipseMode("corner");
  assert.deepEqual(rt._ellipseRect(10, 10, 20, 30), { cx: 20, cy: 25, rx: 10, ry: 15 });
  rt.ellipseMode("center");
  assert.deepEqual(rt._ellipseRect(10, 10, 20, 30), { cx: 10, cy: 10, rx: 10, ry: 15 });

  rt.rectMode("center");
  assert.deepEqual(rt._rectBounds(100, 100, 20, 10), { x: 90, y: 95, w: 20, h: 10 });
  rt.rectMode("corner");
  assert.deepEqual(rt._rectBounds(100, 100, 20, 10), { x: 100, y: 100, w: 20, h: 10 });
});

test("shape primitives (ellipse, arc, quad, triangle, square) don't throw", () => {
  const rt = new BambooRuntime(fakeCanvas());
  assert.doesNotThrow(() => {
    rt.ellipse(50, 50, 20, 20);
    rt.arc(50, 50, 40, 40, 0, Math.PI);
    rt.triangle(0, 0, 10, 0, 5, 10);
    rt.quad(0, 0, 10, 0, 10, 10, 0, 10);
    rt.square(5, 5, 10);
  });
});

test("createCanvas resizes and recenters the turtle; resizeCanvas does not", () => {
  const rt = new BambooRuntime(fakeCanvas());
  rt.createCanvas(200, 150);
  assert.equal(rt.width, 200);
  assert.equal(rt.height, 150);
  assert.equal(rt.turtleX, 100);
  assert.equal(rt.turtleY, 75);

  rt.turtleX = 5;
  rt.resizeCanvas(300, 300);
  assert.equal(rt.width, 300);
  assert.equal(rt.turtleX, 5); // unchanged
});

test("degrees()/radians() convert consistently", () => {
  const rt = new BambooRuntime(fakeCanvas());
  assert.ok(Math.abs(rt.radians(180) - Math.PI) < 1e-9);
  assert.ok(Math.abs(rt.degrees(Math.PI) - 180) < 1e-9);
});

test("frameRate() stores and returns the target fps", () => {
  const rt = new BambooRuntime(fakeCanvas());
  assert.equal(rt.frameRate(), 60);
  rt.frameRate(30);
  assert.equal(rt.frameRateTarget, 30);
});

test("PI/TWO_PI/HALF_PI/QUARTER_PI constants match Math.PI multiples", () => {
  const rt = new BambooRuntime(fakeCanvas());
  assert.equal(rt.PI, Math.PI);
  assert.equal(rt.TWO_PI, Math.PI * 2);
  assert.equal(rt.HALF_PI, Math.PI / 2);
  assert.equal(rt.QUARTER_PI, Math.PI / 4);
});

test("mouseIsPressed/keyIsPressed track button/key state", () => {
  const rt = new BambooRuntime(fakeCanvas());
  assert.equal(rt.mouseIsPressed, false);
  rt._mousePressed = true;
  assert.equal(rt.mouseIsPressed, true);
  assert.equal(rt.keyIsPressed, false);
  rt._keyIsPressed = true;
  assert.equal(rt.keyIsPressed, true);
});

test("pmouseX/pmouseY hold the mouse position from before the latest move", () => {
  const rt = new BambooRuntime(fakeCanvas());
  const move = rt._onMouseMove;
  move({ clientX: 10, clientY: 20 });
  assert.equal(rt.mouseX, 10);
  assert.equal(rt.pmouseX, 0);
  move({ clientX: 30, clientY: 40 });
  assert.equal(rt.mouseX, 30);
  assert.equal(rt.pmouseX, 10);
});

// --- p5.js-compatible layer Phase 2 (spec 3.6) ---

test("createVector returns a usable BambooVector", () => {
  const rt = new BambooRuntime(fakeCanvas());
  const v = rt.createVector(3, 4);
  assert.equal(v.mag(), 5);
});

test("noiseSeed() makes noise() deterministic and repeatable", () => {
  const rt = new BambooRuntime(fakeCanvas());
  rt.noiseSeed(7);
  const first = [rt.noise(0.1), rt.noise(0.2, 0.3), rt.noise(1, 2, 3)];
  rt.noiseSeed(7);
  const second = [rt.noise(0.1), rt.noise(0.2, 0.3), rt.noise(1, 2, 3)];
  assert.deepEqual(first, second);
});

test("noise() output stays within [0, 1] for typical inputs", () => {
  const rt = new BambooRuntime(fakeCanvas());
  rt.noiseSeed(1);
  for (let i = 0; i < 50; i++) {
    const n = rt.noise(i * 0.1, i * 0.05);
    assert.ok(n >= 0 && n <= 1, `noise(${i * 0.1}) = ${n} out of range`);
  }
});

test("noiseDetail() changes the octave count used", () => {
  const rt = new BambooRuntime(fakeCanvas());
  assert.equal(rt._perlinOctaves, 4);
  rt.noiseDetail(2, 0.25);
  assert.equal(rt._perlinOctaves, 2);
  assert.equal(rt._perlinAmpFalloff, 0.25);
});

test("data conversion: int/float/str/boolean", () => {
  const rt = new BambooRuntime(fakeCanvas());
  assert.equal(rt.int("42"), 42);
  assert.equal(rt.int(3.9), 3);
  assert.equal(rt.int(true), 1);
  assert.equal(rt.int("not a number"), 0);
  assert.equal(rt.float("3.14"), 3.14);
  assert.equal(rt.str(true), "True");
  assert.equal(rt.str([1, "a"]), "[1, 'a']");
  assert.equal(rt.boolean(0), false);
  assert.equal(rt.boolean([1]), true);
});

test("len() reports list length and string length; rejects anything else", () => {
  const rt = new BambooRuntime(fakeCanvas());
  assert.equal(rt.len([1, 2, 3]), 3);
  assert.equal(rt.len("hello"), 5);
  assert.equal(rt.len([]), 0);
  assert.throws(() => rt.len(42), BambooRuntimeError);
});

test("__append() grows a list in place; rejects a non-list", () => {
  const rt = new BambooRuntime(fakeCanvas());
  const xs = [1, 2];
  rt.__append(xs, 3, 1);
  assert.deepEqual(xs, [1, 2, 3]);
  assert.throws(() => rt.__append("nope", 1, 1), BambooRuntimeError);
});

test("__fstr(): no spec falls back to the same stringification as str()/print()", () => {
  const rt = new BambooRuntime(fakeCanvas());
  assert.equal(rt.__fstr("hi", null), "hi");
  assert.equal(rt.__fstr(42, null), "42");
  assert.equal(rt.__fstr(true, null), "True");
  assert.equal(rt.__fstr(null, null), "None");
  assert.equal(rt.__fstr([1, "a"], null), "[1, 'a']");
});

test("__fstr(): ':.Nf' formats a number to fixed decimal places", () => {
  const rt = new BambooRuntime(fakeCanvas());
  assert.equal(rt.__fstr(3.14159, ".2f"), "3.14");
  assert.equal(rt.__fstr(3, ".0f"), "3");
});

test("__fstr(): ':.Nf' on a non-number throws a friendly runtime error", () => {
  const rt = new BambooRuntime(fakeCanvas());
  assert.throws(() => rt.__fstr("nope", ".2f"), BambooRuntimeError);
});

test("__fstr(): an unsupported format spec throws a friendly runtime error", () => {
  const rt = new BambooRuntime(fakeCanvas());
  assert.throws(() => rt.__fstr(3, "d"), BambooRuntimeError);
});

test("bezier() strokes without throwing, and respects no_stroke()", () => {
  const rt = new BambooRuntime(fakeCanvas());
  assert.doesNotThrow(() => rt.bezier(0, 0, 10, 10, 20, 10, 30, 0));
  rt.no_stroke();
  assert.doesNotThrow(() => rt.bezier(0, 0, 10, 10, 20, 10, 30, 0));
});

test("beginShape/vertex/endShape build and draw a custom polygon", () => {
  const rt = new BambooRuntime(fakeCanvas());
  rt.beginShape();
  rt.vertex(0, 0);
  rt.vertex(10, 0);
  rt.vertex(10, 10);
  assert.doesNotThrow(() => rt.endShape("close"));
});

test("vertex() outside beginShape()/endShape() throws a friendly error", () => {
  const rt = new BambooRuntime(fakeCanvas());
  assert.throws(() => rt.vertex(0, 0), BambooRuntimeError);
  assert.throws(() => rt.endShape(), BambooRuntimeError);
});
