// Python's int/float numeric model (spec 3.2/6.8) — every case here is
// cross-checked against a real python3 interpreter, not just eyeballed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PyFloat, unboxNum, formatPyFloat } from "../src/pynum.js";
import { parse } from "../src/parser.js";
import { transpile } from "../src/transpiler.js";
import { BambooRuntime } from "../src/runtime.js";
import { BambooRuntimeError } from "../src/errors.js";

test("PyFloat.valueOf() lets <, >, <=, >= coerce against plain numbers for free", () => {
  const f = new PyFloat(3.5);
  assert.equal(f < 4, true);
  assert.equal(f > 3, true);
  assert.equal(f <= 3.5, true);
  assert.equal(4 > f, true);
});

test("unboxNum returns the raw number for a PyFloat, and passes plain numbers through", () => {
  assert.equal(unboxNum(new PyFloat(2.5)), 2.5);
  assert.equal(unboxNum(7), 7);
});

// python3: repr() for each of these exact values (see the inline
// transcript this mirrors — a table run programmatically against a real
// interpreter during development, reproduced here as fixed expectations).
test("formatPyFloat matches CPython's float repr exactly, including the fixed/scientific threshold", () => {
  const cases = [
    [0.0, "0.0"], [1.0, "1.0"], [-0.0, "-0.0"], [100.0, "100.0"], [1e16, "1e+16"],
    [1e-5, "1e-05"], [0.1 + 0.2, "0.30000000000000004"], [3.14159265358979, "3.14159265358979"],
    [1.5e300, "1.5e+300"], [1.5e-300, "1.5e-300"], [-3.5, "-3.5"], [2.5, "2.5"],
    [1e100, "1e+100"], [123456789012345.0, "123456789012345.0"], [0.0001, "0.0001"],
    [0.00001, "1e-05"], [9999999999999998.0, "9999999999999998.0"],
    [1234567890123456.0, "1234567890123456.0"], [12345678901234567.0, "1.2345678901234568e+16"],
    [1.0000000000000002e16, "1.0000000000000002e+16"],
    [-1.5, "-1.5"], [-100.0, "-100.0"], [-1e16, "-1e+16"], [-1e-5, "-1e-05"],
    [5.0, "5.0"], [10.0, "10.0"], [0.5, "0.5"], [0.25, "0.25"], [3.0, "3.0"], [-0.5, "-0.5"],
  ];
  for (const [v, expected] of cases) {
    assert.equal(formatPyFloat(v), expected, `formatPyFloat(${v})`);
  }
});

test("formatPyFloat handles nan/inf/-inf", () => {
  assert.equal(formatPyFloat(NaN), "nan");
  assert.equal(formatPyFloat(Infinity), "inf");
  assert.equal(formatPyFloat(-Infinity), "-inf");
});

// --- End-to-end: parser tags Num.isFloat, transpiler boxes/dispatches ---

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

function run(src) {
  const ast = parse(src);
  const code = transpile(ast);
  const rt = new BambooRuntime(fakeCanvas());
  const lines = [];
  rt.onPrint = (line) => lines.push(line);
  const program = new Function("__rt", code)(rt);
  return { program, rt, lines };
}

test("parser tags a decimal-point literal as isFloat, an integer literal as not", () => {
  const ast = parse("x = 3.5\ny = 3\n");
  assert.equal(ast.body[0].value.isFloat, true);
  assert.equal(ast.body[1].value.isFloat, false);
});

// python3: print(4/2) -> "2.0"; print(str(4/2)) -> "2.0"
test("'/' always returns a float, even for two ints that divide evenly", () => {
  const { program, lines } = run('def draw():\n    print(str(4 / 2))\n');
  program.draw();
  assert.deepEqual(lines, ["2.0"]);
});

test("'/' raises ZeroDivisionError with Python's exact int-vs-float message", () => {
  const { program } = run('def draw():\n    x = 1 / 0\n');
  assert.throws(() => program.draw(), (err) => {
    assert.ok(err instanceof BambooRuntimeError);
    assert.equal(err.pythonType, "ZeroDivisionError");
    assert.equal(err.message, "division by zero");
    return true;
  });
  const { program: fprogram } = run('def draw():\n    x = 1.0 / 0\n');
  assert.throws(() => fprogram.draw(), (err) => {
    assert.equal(err.message, "float division by zero");
    return true;
  });
});

// python3: 7//2 -> 3 (int), -7//2 -> -4 (floors toward -inf), 7.5//2 -> 3.0 (float)
test("'//' floors toward negative infinity like Python, staying int for two ints", () => {
  const { program, lines } = run(
    'def draw():\n' +
    '    print(str(7 // 2))\n' +
    '    print(str(-7 // 2))\n' +
    '    print(str(7 // -2))\n' +
    '    print(str(-7 // -2))\n'
  );
  program.draw();
  assert.deepEqual(lines, ["3", "-4", "-4", "3"]);
});

test("'//' promotes to float if either operand is a float", () => {
  const { program, lines } = run(
    'def draw():\n' +
    '    print(str(7.5 // 2))\n' +
    '    print(str(7 // 2.0))\n'
  );
  program.draw();
  assert.deepEqual(lines, ["3.0", "3.0"]);
});

test("'//' raises ZeroDivisionError with Python's exact int-vs-float message", () => {
  const { program } = run('def draw():\n    x = 1 // 0\n');
  assert.throws(() => program.draw(), (err) => {
    assert.equal(err.pythonType, "ZeroDivisionError");
    assert.equal(err.message, "integer division or modulo by zero");
    return true;
  });
  const { program: fprogram } = run('def draw():\n    x = 1.0 // 0\n');
  assert.throws(() => fprogram.draw(), (err) => {
    assert.equal(err.message, "float floor division by zero");
    return true;
  });
});

// python3: -7%3 -> 2, 7%-3 -> -2, -7%-3 -> -1 (Python's floored modulo)
test("'%' matches Python's floored modulo (sign follows the divisor), not JS's truncated one", () => {
  const { program, lines } = run(
    'def draw():\n' +
    '    print(str(-7 % 3))\n' +
    '    print(str(7 % -3))\n' +
    '    print(str(-7 % -3))\n'
  );
  program.draw();
  assert.deepEqual(lines, ["2", "-2", "-1"]);
});

test("'%' promotes to float if either operand is a float", () => {
  const { program, lines } = run('def draw():\n    print(str(-7.5 % 2))\n');
  program.draw();
  assert.deepEqual(lines, ["0.5"]);
});

test("'%' raises ZeroDivisionError with Python's exact int-vs-float message", () => {
  const { program } = run('def draw():\n    x = 1 % 0\n');
  assert.throws(() => program.draw(), (err) => {
    assert.equal(err.pythonType, "ZeroDivisionError");
    assert.equal(err.message, "integer modulo by zero");
    return true;
  });
  const { program: fprogram } = run('def draw():\n    x = 1.0 % 0\n');
  assert.throws(() => fprogram.draw(), (err) => {
    assert.equal(err.message, "float modulo");
    return true;
  });
});

// python3: int("abc") raises ValueError; int(3.9) -> 3 (plain int, truncates toward 0)
test("int() always returns a plain unboxed int", () => {
  const { program, lines } = run('def draw():\n    print(str(int(3.9)))\n');
  program.draw();
  assert.deepEqual(lines, ["3"]);
});

// python3: float("abc") raises ValueError: could not convert string to float: 'abc'
test("float() raises ValueError on unparseable strings, matching Python's message", () => {
  const { program } = run('def draw():\n    x = float("abc")\n');
  assert.throws(() => program.draw(), (err) => {
    assert.ok(err instanceof BambooRuntimeError);
    assert.equal(err.pythonType, "ValueError");
    assert.equal(err.message, "could not convert string to float: 'abc'");
    return true;
  });
});

test("float() always returns a boxed float, printing with a trailing .0", () => {
  const { program, lines } = run('def draw():\n    print(str(float("4")))\n    print(str(float(4)))\n');
  program.draw();
  assert.deepEqual(lines, ["4.0", "4.0"]);
});

// python3: print(0.1 + 0.2) -> 0.30000000000000004 (float literal repr).
// BambooScript's number grammar has no 'e' exponent suffix (spec 3.2), so
// the large-magnitude case is spelled out in full rather than as "1e16".
test("a float literal prints with Python's exact float repr, not JS's toString", () => {
  const { program, lines } = run(
    'def draw():\n' +
    '    print(str(0.1))\n' +
    '    print(str(100.0))\n' +
    '    print(str(10000000000000000.0))\n'
  );
  program.draw();
  assert.deepEqual(lines, ["0.1", "100.0", "1e+16"]);
});

// python3: -3.5 still prints as a float ("-3.5"), and -1.0 prints "-1.0" not "-1"
test("unary minus on a float literal preserves its float-ness", () => {
  const { program, lines } = run('def draw():\n    print(str(-3.5))\n    print(str(-1.0))\n');
  program.draw();
  assert.deepEqual(lines, ["-3.5", "-1.0"]);
});

test("unary minus on an int stays a plain int", () => {
  const { program, lines } = run('def draw():\n    print(str(-5))\n');
  program.draw();
  assert.deepEqual(lines, ["-5"]);
});

// python3: 3.5 == 3.5 -> True; 2.0 == 2 -> True (int/float compare by value)
test("'==' compares a PyFloat against a plain number by value", () => {
  const { program, lines } = run(
    'def draw():\n' +
    '    print(str(2.0 == 2))\n' +
    '    print(str(3.5 == 3.5))\n' +
    '    print(str(3.5 == 3.6))\n'
  );
  program.draw();
  assert.deepEqual(lines, ["True", "True", "False"]);
});

// python3: [1, 2] == [1, 2] -> True (Python lists compare by value)
test("'==' compares lists by value (recursively), not by reference", () => {
  const { program, lines } = run(
    'def draw():\n' +
    '    a = [1, 2, [3, 4]]\n' +
    '    b = [1, 2, [3, 4]]\n' +
    '    print(str(a == b))\n' +
    '    print(str(a == [1, 2, [3, 5]]))\n'
  );
  program.draw();
  assert.deepEqual(lines, ["True", "False"]);
});
