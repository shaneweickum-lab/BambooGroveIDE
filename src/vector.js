// A p5.Vector-style 2D/3D vector (spec 3.6 Phase 2). Instance methods
// mutate in place and return `this` for chaining, matching p5.Vector's own
// behavior — JS has no operator overloading, so `v1 + v2` isn't available;
// use `v1.add(v2)` instead, the same way real p5 sketches do.
export class BambooVector {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  static _components(a, b, c) {
    if (a instanceof BambooVector) return [a.x, a.y, a.z];
    if (Array.isArray(a)) return [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
    return [a ?? 0, b ?? 0, c ?? 0];
  }

  add(a, b, c) {
    const [dx, dy, dz] = BambooVector._components(a, b, c);
    this.x += dx; this.y += dy; this.z += dz;
    return this;
  }

  sub(a, b, c) {
    const [dx, dy, dz] = BambooVector._components(a, b, c);
    this.x -= dx; this.y -= dy; this.z -= dz;
    return this;
  }

  mult(a, b, c) {
    if (b === undefined && c === undefined) {
      const [dx, dy, dz] = BambooVector._components(a, a, a);
      this.x *= dx; this.y *= dy; this.z *= dz;
      return this;
    }
    const [dx, dy, dz] = BambooVector._components(a, b, c);
    this.x *= dx; this.y *= dy; this.z *= dz;
    return this;
  }

  div(a, b, c) {
    if (b === undefined && c === undefined) {
      const [dx, dy, dz] = BambooVector._components(a, a, a);
      this.x /= dx; this.y /= dy; this.z /= dz;
      return this;
    }
    const [dx, dy, dz] = BambooVector._components(a, b, c);
    this.x /= dx; this.y /= dy; this.z /= dz;
    return this;
  }

  mag() { return Math.sqrt(this.magSq()); }
  magSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }

  normalize() {
    const m = this.mag();
    if (m !== 0) this.div(m);
    return this;
  }

  limit(max) {
    if (this.magSq() > max * max) {
      this.normalize();
      this.mult(max);
    }
    return this;
  }

  setMag(n) {
    this.normalize();
    this.mult(n);
    return this;
  }

  heading() { return Math.atan2(this.y, this.x); }

  rotate(angle) {
    const newHeading = this.heading() + angle;
    const m = this.mag();
    this.x = Math.cos(newHeading) * m;
    this.y = Math.sin(newHeading) * m;
    return this;
  }

  dist(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }

  dot(a, b, c) {
    const [dx, dy, dz] = BambooVector._components(a, b, c);
    return this.x * dx + this.y * dy + this.z * dz;
  }

  cross(v) {
    return new BambooVector(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }

  copy() { return new BambooVector(this.x, this.y, this.z); }

  set(a, b, c) {
    const [dx, dy, dz] = BambooVector._components(a, b, c);
    this.x = dx; this.y = dy; this.z = dz;
    return this;
  }

  array() { return [this.x, this.y, this.z]; }

  equals(v) { return this.x === v.x && this.y === v.y && this.z === v.z; }

  toString() { return `Vector(${this.x}, ${this.y}, ${this.z})`; }
}
