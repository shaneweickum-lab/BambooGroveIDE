// try/except/else/finally/raise (spec 3.2/6.8) — every scenario below is
// cross-checked against a real python3 interpreter (see the comment above
// each test for the exact transcript this mirrors).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/parser.js";
import { transpile } from "../src/transpiler.js";
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

// Runs a full BambooScript source string (parse -> transpile -> execute)
// against a real BambooRuntime, returning every print()ed line.
function run(src) {
  const ast = parse(src);
  const code = transpile(ast);
  const rt = new BambooRuntime(fakeCanvas());
  const lines = [];
  rt.onPrint = (line) => lines.push(line);
  const program = new Function("__rt", code)(rt);
  return { program, rt, lines };
}

// python3: try: int("abc") / except ValueError as e: print(str(e))
// -> "invalid literal for int() with base 10: 'abc'"
test("except ValueError catches int()'s ValueError, str(e) gives the message only", () => {
  const { program, lines } = run(
    'def draw():\n' +
    '    try:\n' +
    '        int("abc")\n' +
    '    except ValueError as e:\n' +
    '        print(str(e))\n'
  );
  program.draw();
  assert.deepEqual(lines, ["invalid literal for int() with base 10: 'abc'"]);
});

test("a matching except clause stops the error from propagating", () => {
  const { program } = run(
    'def draw():\n' +
    '    try:\n' +
    '        int("abc")\n' +
    '    except ValueError:\n' +
    '        forward(1)\n'
  );
  assert.doesNotThrow(() => program.draw());
});

// python3: except ValueError: ... / an IndexError isn't caught by it, so
// it propagates past the try entirely.
test("a non-matching except clause does NOT catch the error — it propagates", () => {
  const { program } = run(
    'def draw():\n' +
    '    try:\n' +
    '        nums = [1, 2, 3]\n' +
    '        x = nums[99]\n' +
    '    except ValueError:\n' +
    '        forward(1)\n'
  );
  assert.throws(() => program.draw(), (err) => {
    assert.ok(err instanceof BambooRuntimeError);
    assert.equal(err.pythonType, "IndexError");
    return true;
  });
});

test("list index out of range is tagged IndexError and catchable", () => {
  const { program, lines } = run(
    'def draw():\n' +
    '    try:\n' +
    '        nums = [1, 2, 3]\n' +
    '        x = nums[99]\n' +
    '    except IndexError:\n' +
    '        print("caught it")\n'
  );
  program.draw();
  assert.deepEqual(lines, ["caught it"]);
});

test("a bare 'except:' catches anything with a tagged pythonType", () => {
  const { program, lines } = run(
    'def draw():\n' +
    '    try:\n' +
    '        int("nope")\n' +
    '    except:\n' +
    '        print("caught")\n'
  );
  program.draw();
  assert.deepEqual(lines, ["caught"]);
});

test("'except Exception:' is a generic catch-all, same as bare except", () => {
  const { program, lines } = run(
    'def draw():\n' +
    '    try:\n' +
    '        raise ValueError("boom")\n' +
    '    except Exception as e:\n' +
    '        print("caught: " + str(e))\n'
  );
  program.draw();
  assert.deepEqual(lines, ["caught: boom"]);
});

// The infinite-loop/too-long guard errors must stay uncatchable by ANY
// except clause, even the broadest bare 'except:' — this is deliberate
// (see errors.js), not an oversight.
test("a bare 'except:' does NOT catch an internal guardrail error (pythonType stays null)", () => {
  const rt = new BambooRuntime(fakeCanvas());
  assert.throws(() => {
    try {
      throw new BambooRuntimeError("This loop ran too many times without finishing.", 1);
    } catch (e) {
      if (rt.__excMatches(e, null)) return; // would swallow it if this matched
      throw e;
    }
  }, BambooRuntimeError);
});

test("first-matching handler wins when multiple except clauses are present", () => {
  const { program, lines } = run(
    'def draw():\n' +
    '    try:\n' +
    '        int("abc")\n' +
    '    except ValueError:\n' +
    '        print("value error")\n' +
    '    except TypeError:\n' +
    '        print("type error")\n'
  );
  program.draw();
  assert.deepEqual(lines, ["value error"]);
});

// python3: try/except/else/finally — else runs only when the try body
// raised nothing, finally always runs.
test("try/except/else/finally: success path runs else and finally, not the handler", () => {
  const { program, lines } = run(
    'def draw():\n' +
    '    try:\n' +
    '        x = int("5")\n' +
    '    except ValueError:\n' +
    '        print("error")\n' +
    '    else:\n' +
    '        print("ok " + str(x))\n' +
    '    finally:\n' +
    '        print("done")\n'
  );
  program.draw();
  assert.deepEqual(lines, ["ok 5", "done"]);
});

test("try/except/else/finally: failure path runs the handler and finally, not else", () => {
  const { program, lines } = run(
    'def draw():\n' +
    '    try:\n' +
    '        x = int("abc")\n' +
    '    except ValueError:\n' +
    '        print("error")\n' +
    '    else:\n' +
    '        print("ok " + str(x))\n' +
    '    finally:\n' +
    '        print("done")\n'
  );
  program.draw();
  assert.deepEqual(lines, ["error", "done"]);
});

// python3: raise inside try/except's own 'else:' body is NOT caught by
// that try's own except clauses — confirmed against a real interpreter.
test("an exception raised from 'else:' is not caught by this try's own handlers", () => {
  const { program, lines } = run(
    'def draw():\n' +
    '    try:\n' +
    '        try:\n' +
    '            x = 1\n' +
    '        except ValueError:\n' +
    '            print("inner caught (should not happen)")\n' +
    '        else:\n' +
    '            raise ValueError("from else")\n' +
    '        finally:\n' +
    '            print("inner finally")\n' +
    '    except ValueError as e:\n' +
    '        print("outer caught: " + str(e))\n'
  );
  program.draw();
  assert.deepEqual(lines, ["inner finally", "outer caught: from else"]);
});

test("try/finally with no except at all still runs finally and lets the error propagate", () => {
  const { program, lines } = run(
    'def draw():\n' +
    '    try:\n' +
    '        raise ValueError("boom")\n' +
    '    finally:\n' +
    '        print("always runs")\n'
  );
  assert.throws(() => program.draw(), (err) => {
    assert.ok(err instanceof BambooRuntimeError);
    assert.equal(err.pythonType, "ValueError");
    assert.equal(err.message, "boom");
    return true;
  });
  assert.deepEqual(lines, ["always runs"]);
});

// python3: raise ValueError("bad") then except ValueError as e: raise ->
// re-raised, caught by an outer try with the original message intact.
test("bare 'raise' inside a handler re-raises the same exception outward", () => {
  const { program, lines } = run(
    'def draw():\n' +
    '    try:\n' +
    '        try:\n' +
    '            raise ValueError("deep problem")\n' +
    '        except ValueError:\n' +
    '            print("inner: about to re-raise")\n' +
    '            raise\n' +
    '    except ValueError as e:\n' +
    '        print("outer caught: " + str(e))\n'
  );
  program.draw();
  assert.deepEqual(lines, ["inner: about to re-raise", "outer caught: deep problem"]);
});

test("a bare 'raise' with no active exception raises a friendly RuntimeError", () => {
  const { program } = run('def draw():\n    raise\n');
  assert.throws(() => program.draw(), (err) => {
    assert.ok(err instanceof BambooRuntimeError);
    assert.equal(err.pythonType, "RuntimeError");
    assert.match(err.message, /No active exception to re-raise/);
    return true;
  });
});

// python3: raise ValueError (bare, no call) then str(e) == ""
test("'raise ValueError' with no call/args constructs a zero-arg instance (empty message)", () => {
  const { program, lines } = run(
    'def draw():\n' +
    '    try:\n' +
    '        raise ValueError\n' +
    '    except ValueError as e:\n' +
    '        print("[" + str(e) + "]")\n'
  );
  program.draw();
  assert.deepEqual(lines, ["[]"]);
});

// python3: str(ValueError("a", "b")) == "('a', 'b')"
test("an exception constructed with multiple args formats str(e) as a tuple, matching Python", () => {
  const { program, lines } = run(
    'def draw():\n' +
    '    try:\n' +
    '        raise ValueError("a", "b")\n' +
    '    except ValueError as e:\n' +
    '        print(str(e))\n'
  );
  program.draw();
  assert.deepEqual(lines, ["('a', 'b')"]);
});

test("raising a plain non-exception value is itself a TypeError", () => {
  const { program } = run('def draw():\n    raise 42\n');
  assert.throws(() => program.draw(), (err) => {
    assert.ok(err instanceof BambooRuntimeError);
    assert.equal(err.pythonType, "TypeError");
    return true;
  });
});

test("an uncaught exception still propagates all the way out with its pythonType intact", () => {
  const { program } = run('def draw():\n    raise KeyError("missing")\n');
  assert.throws(() => program.draw(), (err) => {
    assert.ok(err instanceof BambooRuntimeError);
    assert.equal(err.pythonType, "KeyError");
    assert.equal(err.message, "missing");
    return true;
  });
});

test("an exception constructed but not raised is just an inert value", () => {
  const { program, lines } = run(
    'def draw():\n' +
    '    e = ValueError("not thrown yet")\n' +
    '    print("still running")\n' +
    '    print(str(e))\n'
  );
  program.draw();
  assert.deepEqual(lines, ["still running", "not thrown yet"]);
});

test("'raise e' later throws a previously-constructed exception value", () => {
  const { program, lines } = run(
    'def draw():\n' +
    '    e = ValueError("delayed")\n' +
    '    try:\n' +
    '        raise e\n' +
    '    except ValueError as caught:\n' +
    '        print(str(caught))\n'
  );
  program.draw();
  assert.deepEqual(lines, ["delayed"]);
});
