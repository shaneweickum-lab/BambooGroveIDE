import { test } from "node:test";
import assert from "node:assert/strict";
import { BambooVector } from "../src/vector.js";

test("add/sub mutate in place and return this for chaining", () => {
  const v = new BambooVector(1, 2);
  const result = v.add(3, 4);
  assert.equal(result, v);
  assert.equal(v.x, 4);
  assert.equal(v.y, 6);
  v.sub(1, 1);
  assert.equal(v.x, 3);
  assert.equal(v.y, 5);
});

test("add/sub accept another vector or a plain array", () => {
  const v = new BambooVector(1, 1);
  v.add(new BambooVector(2, 3));
  assert.deepEqual([v.x, v.y], [3, 4]);
  v.sub([1, 1]);
  assert.deepEqual([v.x, v.y], [2, 3]);
});

test("mult/div support both a scalar and per-component scaling", () => {
  const v = new BambooVector(2, 4);
  v.mult(2);
  assert.deepEqual([v.x, v.y], [4, 8]);
  v.div(new BambooVector(2, 4));
  assert.deepEqual([v.x, v.y], [2, 2]);
});

test("mag/magSq compute length correctly", () => {
  const v = new BambooVector(3, 4);
  assert.equal(v.mag(), 5);
  assert.equal(v.magSq(), 25);
});

test("normalize scales to length 1 without changing direction", () => {
  const v = new BambooVector(3, 4);
  v.normalize();
  assert.ok(Math.abs(v.mag() - 1) < 1e-9);
  assert.ok(Math.abs(v.x - 0.6) < 1e-9);
  assert.ok(Math.abs(v.y - 0.8) < 1e-9);
});

test("normalize on a zero vector doesn't divide by zero", () => {
  const v = new BambooVector(0, 0);
  assert.doesNotThrow(() => v.normalize());
  assert.equal(v.mag(), 0);
});

test("limit caps magnitude but leaves shorter vectors alone", () => {
  const long = new BambooVector(30, 40); // mag 50
  long.limit(10);
  assert.ok(Math.abs(long.mag() - 10) < 1e-9);

  const short = new BambooVector(1, 0);
  short.limit(10);
  assert.equal(short.mag(), 1);
});

test("heading/rotate work in radians", () => {
  const v = new BambooVector(1, 0);
  assert.equal(v.heading(), 0);
  v.rotate(Math.PI / 2);
  assert.ok(Math.abs(v.x - 0) < 1e-9);
  assert.ok(Math.abs(v.y - 1) < 1e-9);
});

test("dist/dot/cross compute correctly", () => {
  const a = new BambooVector(0, 0);
  const b = new BambooVector(3, 4);
  assert.equal(a.dist(b), 5);
  assert.equal(a.dot(b), 0);
  const cross = new BambooVector(1, 0, 0).cross(new BambooVector(0, 1, 0));
  assert.deepEqual([cross.x, cross.y, cross.z], [0, 0, 1]);
});

test("copy() is independent of the original", () => {
  const v = new BambooVector(1, 2);
  const c = v.copy();
  c.add(1, 1);
  assert.deepEqual([v.x, v.y], [1, 2]);
  assert.deepEqual([c.x, c.y], [2, 3]);
});

test("set()/array()/equals() work as expected", () => {
  const v = new BambooVector();
  v.set(5, 6, 7);
  assert.deepEqual(v.array(), [5, 6, 7]);
  assert.ok(v.equals(new BambooVector(5, 6, 7)));
  assert.ok(!v.equals(new BambooVector(5, 6, 8)));
});

test("toString() matches p5.js-style formatting", () => {
  assert.equal(new BambooVector(1, 2, 3).toString(), "Vector(1, 2, 3)");
});
