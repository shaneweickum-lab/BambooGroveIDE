// Transpiles a BambooScript AST (see parser.js) into a JS source string.
//
// Two independent axes control the shape of the output:
//  - `mode`: "canvas" (default) emits plain sync functions, for the
//    setup()/draw() animation-loop world. "terminal" (spec 3.6 Terminal
//    tab) emits every function as `async` and awaits every call, so
//    `input()` can genuinely pause execution until the user types a line
//    — see runtime-base.js / terminal-runtime.js.
//  - `exportMode`: "lifecycle" (default, for the entry file) returns the
//    fixed set of lifecycle functions (setup, draw, mousePressed, ...).
//    "all" (for a sibling module file, spec section 6) returns every
//    top-level function by name, for `import`/`from ... import` to pull
//    from.
//
// Design notes:
//  - Every builtin (background, forward, mouse_x, ...) is only ever reached
//    through `__rt.*`, so user variable/function names never collide with
//    stdlib names and don't need to be reserved.
//  - `__rt.__line` is updated before most statements so a thrown error can
//    be mapped back to the original BambooScript source line.
//  - `__rt.__tick(line)` is called on every loop iteration as an infinite
//    loop guard (see runtime-base.js for the actual limits).
//  - Library modules (imported sibling files) always compile in "canvas"
//    (sync) mode regardless of the importing file's mode: they're meant
//    to be reusable helper functions (spec 6's own example is
//    draw_panda()/panda_walk()), not input()-driven scripts. Calling a
//    sync helper's result with `await` (as terminal mode does at every
//    call site) is harmless — awaiting a non-promise just resolves to it.
import { BambooSyntaxError } from "./errors.js";

const JS_RESERVED_WORDS = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "enum", "export", "extends", "finally",
  "function", "implements", "import", "instanceof", "interface", "let",
  "new", "package", "private", "protected", "public", "static", "super",
  "switch", "this", "throw", "try", "typeof", "var", "void", "yield",
  "await", "arguments", "eval", "null", "undefined", "of", "get", "set",
]);

const GLOBAL_READONLY = {
  // Original snake_case globals (spec 3.3)
  mouse_x: "mouseX",
  mouse_y: "mouseY",
  frame_count: "frameCount",
  key_pressed: "keyPressed",
  // p5.js-compatible globals (spec 3.6)
  mouseX: "mouseX",
  mouseY: "mouseY",
  pmouseX: "pmouseX",
  pmouseY: "pmouseY",
  mouseIsPressed: "mouseIsPressed",
  keyIsPressed: "keyIsPressed",
  key: "keyPressed",
  frameCount: "frameCount",
  width: "width",
  height: "height",
  windowWidth: "windowWidth",
  windowHeight: "windowHeight",
  PI: "PI",
  TWO_PI: "TWO_PI",
  HALF_PI: "HALF_PI",
  QUARTER_PI: "QUARTER_PI",
  DEGREES: "DEGREES",
  RADIANS: "RADIANS",
};

// Optional lifecycle functions the sandbox may call in addition to
// setup()/draw() (spec 3.6 Events): defined the same way as any other
// top-level `def`, just recognized by name.
const LIFECYCLE_NAMES = [
  "setup", "draw",
  "keyPressed", "keyReleased",
  "mousePressed", "mouseReleased", "mouseDragged", "mouseMoved", "mouseClicked",
];

// "+"/"-" are the only BinOp operators still emitted as plain inline JS —
// "*" (repeat semantics), "/"/"//"/"%" (int/float-aware, spec 3.2/6.8) all
// route through a runtime dispatcher instead (see the BinOp case below).
// "+"/"-" get the same treatment in Phase A7, once list-concat and the
// float-promotion rule they need both exist.
const BINOP_JS = { "+": "+", "-": "-" };
// "=="/"!=" route through __rt.__eq (below) so a PyFloat compares by value
// against a plain number and lists compare by value instead of reference —
// only the four ordering comparisons stay inline (already correct via
// PyFloat's own valueOf()).
const COMPARE_JS = { "<": "<", ">": ">", "<=": "<=", ">=": ">=" };

function assertValidIdentifier(name, line) {
  if (JS_RESERVED_WORDS.has(name)) {
    throw new BambooSyntaxError(
      `'${name}' is a reserved word and can't be used as a variable, parameter, or function name.`,
      line
    );
  }
  if (name.startsWith("__")) {
    throw new BambooSyntaxError(
      `Names starting with '__' are reserved. Rename '${name}'.`,
      line
    );
  }
}

// Names attribute access (.name / .method(...)) refuses on top of the usual
// identifier rules. `constructor`/`prototype` specifically block the
// classic `x.constructor.constructor("...")` escape to the Function
// constructor — the one thing that would actually undermine the loop-guard
// promise (spec 4.2), since code reached that way never passes through our
// own __tick() codegen.
const RESERVED_PROPERTY_NAMES = new Set(["constructor", "prototype", "__proto__"]);

function assertValidPropertyName(name, line) {
  assertValidIdentifier(name, line);
  if (RESERVED_PROPERTY_NAMES.has(name)) {
    throw new BambooSyntaxError(`'${name}' isn't a usable attribute or method name.`, line);
  }
}

// Python's str methods (see src/runtime-base.js's __strmethod for the
// implementations) — matching CPython's own behavior is the whole point,
// so a Terminal-tab script that only uses these can be copy-pasted into a
// real Python interpreter and run the same.
const PYTHON_STRING_METHODS = new Set([
  "upper", "lower", "strip", "lstrip", "rstrip", "split", "replace", "join",
  "startswith", "endswith", "find", "rfind", "index", "count", "title",
  "capitalize", "swapcase", "isdigit", "isalpha", "isalnum", "isspace",
  "isupper", "islower", "zfill",
]);

// Python's built-in exception types (spec 3.2/6.8's fixed taxonomy). Each
// is a callable that CONSTRUCTS a tagged, catchable error value without
// throwing it — `raise` (genRaise below) is what actually throws, exactly
// like real Python's own model where `ValueError("bad")` is just an
// instance until something raises it. "Exception" doubles as the generic
// catch-all name (matches anything tagged, same as a bare `except:`).
const EXCEPTION_TYPES = new Set([
  "ValueError", "TypeError", "KeyError", "IndexError", "ZeroDivisionError",
  "FileNotFoundError", "FileExistsError", "NotADirectoryError", "IsADirectoryError",
  "JSONDecodeError", "AttributeError", "Exception", "RuntimeError",
]);

class Transpiler {
  constructor(mode) {
    this.tempCounter = 0;
    this.mode = mode;
  }

  nextTemp() {
    return `__t${this.tempCounter++}`;
  }

  transpileProgram(program, exportMode) {
    const functionDefs = program.body.filter((n) => n.type === "FunctionDef");
    const importStmts = program.body.filter((n) => n.type === "Import" || n.type === "FromImport");
    const topLevelStmts = program.body.filter(
      (n) => n.type !== "FunctionDef" && n.type !== "Import" && n.type !== "FromImport"
    );

    // Top-level `name = value` assignments become real shared variables —
    // every function can read and mutate them by closing over the same
    // `let`, the way plain JS (and p5.js sketches) already work. This is a
    // deliberate deviation from Python, which would require an explicit
    // `global` keyword to write to a module-level name from inside a
    // function; BambooScript's tagline is "run like JavaScript", and
    // requiring `global` would make the setup()/draw()/event-callback
    // pattern this enables (e.g. a `clicked` flag set in mousePressed()
    // and read in draw()) needlessly awkward for a teaching tool.
    const declareNames = new Set(); // names THIS unit declares with `let`
    const shadowExcludeNames = new Set(); // names a function must not locally re-declare
    // Terminal mode allows full control flow at the top level (it's a plain
    // script, not just global-variable initializers), so this has to walk
    // into for/while/if bodies too — not just scan direct top-level Assigns
    // — to catch things like a top-level `for i in range(3):`'s loop variable.
    collectAssignedNames(topLevelStmts, declareNames);
    const firstLine = topLevelStmts[0]?.line ?? 0;
    for (const name of declareNames) {
      assertValidIdentifier(name, firstLine);
      shadowExcludeNames.add(name);
    }

    // Imports (spec section 6): `import foo` expects a `const foo = ...`
    // already in the enclosing scope (emitted by the module orchestrator,
    // see modules.js) — this unit just has to avoid shadowing it. `from
    // foo import bar [as baz]` binds a new shared name the same way a
    // global does.
    const importLines = [];
    for (const stmt of importStmts) {
      if (stmt.type === "Import") {
        assertValidIdentifier(stmt.module, stmt.line);
        shadowExcludeNames.add(stmt.module);
      } else {
        assertValidIdentifier(stmt.module, stmt.line);
        for (const { name, alias } of stmt.names) {
          const bound = alias || name;
          assertValidIdentifier(bound, stmt.line);
          declareNames.add(bound);
          shadowExcludeNames.add(bound);
          importLines.push(`${bound} = ${stmt.module}.${name};`);
        }
      }
    }

    const lines = [`"use strict";`];
    if (declareNames.size) lines.push(`let ${[...declareNames].join(", ")};`);
    for (const line of importLines) lines.push(line);
    for (const fn of functionDefs) {
      lines.push(this.genFunctionDef(fn, shadowExcludeNames));
    }

    if (this.mode === "terminal") {
      const topBody = topLevelStmts.map((stmt) => this.genStmt(stmt)).join("\n");
      lines.push(`async function __run() {\n${topBody}\n}`);
      lines.push(`const __ready = __run();`);
      lines.push(this.buildReturnStatement(functionDefs, exportMode, ["__ready"]));
    } else {
      for (const stmt of topLevelStmts) lines.push(this.genStmt(stmt));
      lines.push(this.buildReturnStatement(functionDefs, exportMode, []));
    }
    return lines.join("\n");
  }

  buildReturnStatement(functionDefs, exportMode, extraNames) {
    const names = exportMode === "all" ? functionDefs.map((fn) => fn.name) : LIFECYCLE_NAMES;
    const fields = names
      .map((name) => `${name}: typeof ${name} === 'function' ? ${name} : null`)
      .concat(extraNames)
      .join(", ");
    return `return { ${fields} };`;
  }

  genFunctionDef(fn, boundTopNames) {
    assertValidIdentifier(fn.name, fn.line);
    for (const p of fn.params) assertValidIdentifier(p, fn.line);

    const locals = new Set();
    collectAssignedNames(fn.body, locals);
    for (const p of fn.params) locals.delete(p);
    for (const g of boundTopNames) locals.delete(g);
    for (const name of locals) assertValidIdentifier(name, fn.line);

    const decl = locals.size ? `let ${[...locals].join(", ")};` : "";
    const body = fn.body.map((stmt) => this.genStmt(stmt)).join("\n");
    const asyncKw = this.mode === "terminal" ? "async " : "";
    return `${asyncKw}function ${fn.name}(${fn.params.join(", ")}) {\n${decl}\n${body}\n}`;
  }

  genStmt(node) {
    const mark = `__rt.__line = ${node.line};`;
    switch (node.type) {
      case "If":
        return this.genIf(node);
      case "For":
        return this.genFor(node);
      case "While":
        return this.genWhile(node);
      case "Try":
        return this.genTry(node);
      case "Raise":
        return this.genRaise(node);
      case "Return":
        return `${mark}\nreturn ${node.value ? this.genExpr(node.value) : ""};`;
      case "Assign":
        return `${mark}\n${this.genAssign(node)}`;
      case "ExprStmt":
        return `${mark}\n${this.genExpr(node.value)};`;
      default:
        throw new BambooSyntaxError(`Internal error: unknown statement '${node.type}'.`, node.line);
    }
  }

  genAssign(node) {
    const value = this.genExpr(node.value);
    if (node.target.type === "Name") {
      return `${node.target.name} = ${value};`;
    }
    if (node.target.type === "Attribute") {
      // obj.attr = value — e.g. a Vector's v.x = 5 (spec 3.6 Phase 2)
      assertValidPropertyName(node.target.name, node.line);
      const obj = this.genExpr(node.target.object);
      return `${obj}.${node.target.name} = ${value};`;
    }
    // Index target: obj[idx] = value
    const obj = this.genExpr(node.target.object);
    const idx = this.genExpr(node.target.index);
    return `__rt.__setIndex(${obj}, ${idx}, ${value}, ${node.line});`;
  }

  genIf(node) {
    const parts = [];
    node.cases.forEach((c, i) => {
      const kw = i === 0 ? "if" : "} else if";
      parts.push(`${kw} (__rt.__truthy(${this.genExpr(c.test)})) {`);
      parts.push(c.body.map((s) => this.genStmt(s)).join("\n"));
    });
    if (node.orelse) {
      parts.push(`} else {`);
      parts.push(node.orelse.map((s) => this.genStmt(s)).join("\n"));
    }
    parts.push(`}`);
    return `__rt.__line = ${node.line};\n${parts.join("\n")}`;
  }

  genFor(node) {
    assertValidIdentifier(node.varName, node.line);
    const temp = this.nextTemp();
    const iterable = this.genExpr(node.iterable);
    const body = node.body.map((s) => this.genStmt(s)).join("\n");
    return [
      `__rt.__line = ${node.line};`,
      `for (const ${temp} of __rt.__iter(${iterable}, ${node.line})) {`,
      `${node.varName} = ${temp};`,
      `__rt.__tick(${node.line});`,
      body,
      `}`,
    ].join("\n");
  }

  genWhile(node) {
    const test = this.genExpr(node.test);
    const body = node.body.map((s) => this.genStmt(s)).join("\n");
    return [
      `__rt.__line = ${node.line};`,
      `while (__rt.__truthy(${test})) {`,
      `__rt.__tick(${node.line});`,
      body,
      `}`,
    ].join("\n");
  }

  // try/except/else/finally (spec 3.2). `__rt.__excStack` (pushed/popped
  // around the handler-dispatch, not the whole catch) backs bare `raise`
  // re-raise inside a handler body. The except-else body deliberately
  // runs OUTSIDE the try/catch (guarded by a flag) rather than just after
  // the body inside the same try — a real Python `except`/`else` doesn't
  // catch exceptions raised from its own `else` body, confirmed against a
  // real interpreter, and inlining it directly after the body would
  // silently (and wrongly) make this try's own handlers catch those too.
  genTry(node) {
    const bodyCode = node.body.map((s) => this.genStmt(s)).join("\n");
    const finallyCode = node.finallyBody ? node.finallyBody.map((s) => this.genStmt(s)).join("\n") : null;
    const mark = `__rt.__line = ${node.line};`;

    if (node.handlers.length === 0) {
      // try/finally only — no except clause at all (real Python allows this).
      return [mark, `try {`, bodyCode, `} finally {`, finallyCode, `}`].join("\n");
    }

    const errVar = `__exc${this.tempCounter++}`;
    const catchBlock = [
      `catch (${errVar}) {`,
      `__rt.__excStack.push(${errVar});`,
      `try {`,
      this.genExceptDispatch(errVar, node.handlers),
      `} finally {`,
      `__rt.__excStack.pop();`,
      `}`,
      `}`,
    ].join("\n");

    if (!node.orelse) {
      const parts = [mark, `try {`, bodyCode, `}`, catchBlock];
      if (finallyCode !== null) parts.push(`finally {`, finallyCode, `}`);
      return parts.join("\n");
    }

    const okVar = `__ok${this.tempCounter++}`;
    const orelseCode = node.orelse.map((s) => this.genStmt(s)).join("\n");
    const inner = [
      `let ${okVar} = false;`,
      `try {`,
      bodyCode,
      `${okVar} = true;`,
      `}`,
      catchBlock,
      `if (${okVar}) {`,
      orelseCode,
      `}`,
    ].join("\n");

    if (finallyCode === null) return [mark, inner].join("\n");
    return [mark, `try {`, inner, `} finally {`, finallyCode, `}`].join("\n");
  }

  genExceptDispatch(errVar, handlers) {
    const parts = [];
    handlers.forEach((h, i) => {
      const kw = i === 0 ? "if" : "} else if";
      const nameJson = h.exceptionName === null ? "null" : JSON.stringify(h.exceptionName);
      parts.push(`${kw} (__rt.__excMatches(${errVar}, ${nameJson})) {`);
      if (h.bindName) {
        assertValidIdentifier(h.bindName, h.line);
        parts.push(`const ${h.bindName} = ${errVar};`);
      }
      parts.push(h.body.map((s) => this.genStmt(s)).join("\n"));
    });
    parts.push(`} else {`, `throw ${errVar};`, `}`);
    return parts.join("\n");
  }

  genRaise(node) {
    const mark = `__rt.__line = ${node.line};`;
    if (node.value === null) {
      return `${mark}\nthrow __rt.__reraise(${node.line});`;
    }
    // `raise ValueError` (bare, no call) constructs a zero-argument
    // instance just like `raise ValueError()` — a bare Name referencing
    // one of the exception types wouldn't otherwise evaluate to anything.
    let valueExpr;
    if (node.value.type === "Name" && EXCEPTION_TYPES.has(node.value.name)) {
      valueExpr = `__rt.__makeException(${JSON.stringify(node.value.name)}, [], ${node.line})`;
    } else {
      valueExpr = this.genExpr(node.value);
    }
    return `${mark}\nthrow __rt.__raise(${valueExpr}, ${node.line});`;
  }

  genExpr(node) {
    switch (node.type) {
      case "Num":
        // A decimal-point literal (spec 3.2/6.8's numeric model) boxes as
        // a PyFloat so it prints/compares like a real Python float (e.g.
        // "1.0" keeps its trailing .0); a plain integer literal stays an
        // ordinary, unboxed JS number — see src/pynum.js.
        return node.isFloat ? `__rt.__mkfloat(${JSON.stringify(node.value)})` : JSON.stringify(node.value);
      case "Str":
        return JSON.stringify(node.value);
      case "FString":
        return this.genFString(node);
      case "BoolLiteral":
        return node.value ? "true" : "false";
      case "Name":
        if (Object.prototype.hasOwnProperty.call(GLOBAL_READONLY, node.name)) {
          return `__rt.${GLOBAL_READONLY[node.name]}`;
        }
        assertValidIdentifier(node.name, node.line);
        return node.name;
      case "ListLiteral":
        return `[${node.elements.map((e) => this.genExpr(e)).join(", ")}]`;
      case "Index":
        return `__rt.__index(${this.genExpr(node.object)}, ${this.genExpr(node.index)}, ${node.line})`;
      case "Attribute":
        assertValidPropertyName(node.name, node.line);
        return `${this.genExpr(node.object)}.${node.name}`;
      case "Call":
        return this.genCall(node);
      case "MethodCall":
        return this.genMethodCall(node);
      case "BinOp": {
        // "*" means "repeat" for a string/list times a number; "/"/"//"/"%"
        // need int/float-aware results and Python's own floor-division and
        // floored-modulo semantics (spec 3.2/6.8) — none of that matches
        // plain JS closely enough to stay inline. "+"/"-" do (for now —
        // generalized in Phase A7).
        const DISPATCH = { "*": "__mul", "/": "__truediv", "//": "__floordiv", "%": "__mod" };
        if (DISPATCH[node.op]) {
          return `__rt.${DISPATCH[node.op]}(${this.genExpr(node.left)}, ${this.genExpr(node.right)}, ${node.line})`;
        }
        return `(${this.genExpr(node.left)} ${BINOP_JS[node.op]} ${this.genExpr(node.right)})`;
      }
      case "Compare":
        if (node.op === "in" || node.op === "not in") {
          const containsExpr = `__rt.__contains(${this.genExpr(node.right)}, ${this.genExpr(node.left)}, ${node.line})`;
          return node.op === "not in" ? `(!${containsExpr})` : `(${containsExpr})`;
        }
        if (node.op === "==" || node.op === "!=") {
          const eqExpr = `__rt.__eq(${this.genExpr(node.left)}, ${this.genExpr(node.right)})`;
          return node.op === "!=" ? `(!${eqExpr})` : `(${eqExpr})`;
        }
        return `(${this.genExpr(node.left)} ${COMPARE_JS[node.op]} ${this.genExpr(node.right)})`;
      case "BoolOp": {
        if (this.mode === "terminal") {
          const helper = node.op === "and" ? "__andAsync" : "__orAsync";
          return `(await __rt.${helper}(async () => (${this.genExpr(node.left)}), async () => (${this.genExpr(node.right)})))`;
        }
        const helper = node.op === "and" ? "__and" : "__or";
        return `__rt.${helper}(() => (${this.genExpr(node.left)}), () => (${this.genExpr(node.right)}))`;
      }
      case "UnaryOp":
        if (node.op === "not") return `__rt.__not(${this.genExpr(node.operand)})`;
        // Unary '-' on a PyFloat must stay a PyFloat (plain JS '-' would
        // unbox it via valueOf(), silently losing the trailing ".0" on
        // print) — routed through the runtime instead of staying inline.
        // Unary '+' is a genuine no-op in Python (same value, same type),
        // so it just passes the operand through unchanged.
        if (node.op === "-") return `__rt.__neg(${this.genExpr(node.operand)}, ${node.line})`;
        return `(${this.genExpr(node.operand)})`;
      default:
        throw new BambooSyntaxError(`Internal error: unknown expression '${node.type}'.`, node.line);
    }
  }

  genCall(node) {
    const args = node.args.map((a) => this.genExpr(a)).join(", ");
    let callExpr;
    if (EXCEPTION_TYPES.has(node.callee)) {
      callExpr = `__rt.__makeException(${JSON.stringify(node.callee)}, [${args}], ${node.line})`;
    } else if (Object.prototype.hasOwnProperty.call(RUNTIME_BUILTINS, node.callee)) {
      callExpr = `__rt.${RUNTIME_BUILTINS[node.callee]}(${args})`;
    } else {
      assertValidIdentifier(node.callee, node.line);
      callExpr = `${node.callee}(${args})`;
    }
    return this.mode === "terminal" ? `(await ${callExpr})` : callExpr;
  }

  // obj.method(args) — an imported sibling file's function (spec section
  // 6: panda.draw_panda()) or a method on an object value like Vector
  // (spec 3.6 Phase 2: v.add(other)). Never a builtin itself, so no
  // RUNTIME_BUILTINS lookup — whatever `obj` evaluates to just gets its
  // own `.method(...)` called directly.
  genMethodCall(node) {
    assertValidPropertyName(node.method, node.line);
    const obj = this.genExpr(node.object);
    const args = node.args.map((a) => this.genExpr(a)).join(", ");
    // list.append(x) (Python-flavored, spec 3.2): JS arrays have no native
    // .append, so this is special-cased onto a runtime helper (unlike every
    // other MethodCall, which just calls straight through to whatever the
    // object already has — Vector methods, module functions, ...).
    if (node.method === "append") {
      const callExpr = `__rt.__append(${obj}, ${args}, ${node.line})`;
      return this.mode === "terminal" ? `(await ${callExpr})` : callExpr;
    }
    // Python's str methods (.upper(), .split(), ...): special-cased the
    // same way .append() is, since JS strings don't have these methods (or
    // don't have matching semantics for the ones that share a name, like
    // .replace()). The runtime dispatcher only touches actual strings —
    // anything else (a Vector, an imported module's own function) falls
    // straight through to its own `.method(...)`, so this can never break
    // an existing MethodCall that happens to share one of these names.
    if (PYTHON_STRING_METHODS.has(node.method)) {
      const callExpr = `__rt.__strmethod(${obj}, ${JSON.stringify(node.method)}, [${args}], ${node.line})`;
      return this.mode === "terminal" ? `(await ${callExpr})` : callExpr;
    }
    const callExpr = `${obj}.${node.method}(${args})`;
    return this.mode === "terminal" ? `(await ${callExpr})` : callExpr;
  }

  // f"...{expr}..." (spec 3.6-adjacent convenience): each {expr} is
  // formatted through the runtime (same Python-flavored stringification
  // print()/str() use), with an optional ':spec' for numeric formatting.
  genFString(node) {
    if (node.parts.length === 0) return `""`;
    const pieces = node.parts.map((part) => {
      if (part.type === "text") return JSON.stringify(part.value);
      const exprCode = this.genExpr(part.expr);
      const specCode = part.spec ? JSON.stringify(part.spec) : "null";
      return `__rt.__fstr(${exprCode}, ${specCode}, ${node.line})`;
    });
    return `(${pieces.join(" + ")})`;
  }
}

// Maps BambooScript stdlib call names to BambooRuntime method names.
// Every value is identical to its key today; kept as a map (rather than a
// Set) so a call name and its runtime method are free to diverge later.
const RUNTIME_BUILTINS = {
  // Drawing primitives + turtle movement (spec 3.3)
  background: "background",
  stroke: "stroke",
  fill: "fill",
  no_fill: "no_fill",
  no_stroke: "no_stroke",
  line: "line",
  rect: "rect",
  circle: "circle",
  point: "point",
  text: "text",
  forward: "forward",
  turn: "turn",
  right: "right",
  left: "left",
  pen_up: "pen_up",
  pen_down: "pen_down",
  go_to: "go_to",
  home: "home",
  is_pressed: "is_pressed",
  no_loop: "no_loop",
  loop: "loop",
  range: "range",

  // p5.js-compatible layer (spec 3.6, Phase 1)
  // Shape > 2D Primitives / Attributes
  arc: "arc",
  ellipse: "ellipse",
  quad: "quad",
  square: "square",
  triangle: "triangle",
  ellipseMode: "ellipseMode",
  rectMode: "rectMode",
  strokeWeight: "strokeWeight",
  strokeCap: "strokeCap",
  strokeJoin: "strokeJoin",
  noSmooth: "noSmooth",
  smooth: "smooth",
  // Color > Setting / Creating & Reading
  noFill: "noFill",
  noStroke: "noStroke",
  clear: "clear",
  colorMode: "colorMode",
  blendMode: "blendMode",
  color: "color",
  red: "red",
  green: "green",
  blue: "blue",
  alpha: "alpha",
  lerpColor: "lerpColor",
  // Transform
  push: "push",
  pop: "pop",
  translate: "translate",
  rotate: "rotate",
  scale: "scale",
  resetMatrix: "resetMatrix",
  // Environment
  frameRate: "frameRate",
  cursor: "cursor",
  noCursor: "noCursor",
  // Math
  abs: "abs",
  ceil: "ceil",
  floor: "floor",
  round: "round",
  constrain: "constrain",
  dist: "dist",
  lerp: "lerp",
  map: "map",
  max: "max",
  min: "min",
  pow: "pow",
  sq: "sq",
  sqrt: "sqrt",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  radians: "radians",
  degrees: "degrees",
  random: "random",
  randomSeed: "randomSeed",
  // Structure
  noLoop: "noLoop",
  redraw: "redraw",
  isLooping: "isLooping",
  // Rendering
  createCanvas: "createCanvas",
  resizeCanvas: "resizeCanvas",
  // Typography
  textSize: "textSize",
  textAlign: "textAlign",
  textFont: "textFont",

  // Terminal tab (spec 3.6): print/input work in both modes, but input()
  // only does anything useful in Terminal mode (see runtime.js / TerminalRuntime).
  print: "print",
  input: "input",

  // p5.js-compatible layer (spec 3.6, Phase 2)
  // Shape > Curves and Custom Shapes (canvas-only — see NON_CANVAS_BUILTINS)
  bezier: "bezier",
  beginShape: "beginShape",
  vertex: "vertex",
  endShape: "endShape",
  // Math > Noise (works in both modes — pure computation, see runtime-base.js)
  noise: "noise",
  noiseDetail: "noiseDetail",
  noiseSeed: "noiseSeed",
  // Math > p5.Vector (works in both modes — createVector() itself doesn't
  // touch the canvas; the Vector's own methods, e.g. v.add(), are called
  // as plain object methods via MethodCall, not through __rt at all)
  createVector: "createVector",
  // Data > Conversion (works in both modes)
  int: "int",
  float: "float",
  str: "str",
  boolean: "boolean",
  // Data > Lists (works in both modes; list.append(x) is handled
  // separately in genMethodCall since it's a method, not a call)
  len: "len",
};

// Builtins that work the same with no canvas at all — everything else in
// RUNTIME_BUILTINS is Canvas-mode only, and TerminalRuntime stubs it out
// with a friendly redirect error instead of a confusing "not a function"
// crash (see CANVAS_ONLY_BUILTIN_NAMES below).
const NON_CANVAS_BUILTINS = new Set([
  "range", "print", "input",
  "random", "randomSeed",
  "noise", "noiseDetail", "noiseSeed", "createVector",
  "int", "float", "str", "boolean",
  "len",
]);

export const CANVAS_ONLY_BUILTIN_NAMES = Object.keys(RUNTIME_BUILTINS).filter(
  (name) => !NON_CANVAS_BUILTINS.has(name)
);

// Every callable builtin name and every read-only global name (spec 3.3 +
// 3.6) — used by src/linter.js to warn when a learner's own variable or
// function name shadows one of these.
export const ALL_BUILTIN_NAMES = Object.keys(RUNTIME_BUILTINS);
export const ALL_GLOBAL_NAMES = Object.keys(GLOBAL_READONLY);

function collectAssignedNames(stmts, into) {
  for (const stmt of stmts) {
    switch (stmt.type) {
      case "Assign":
        if (stmt.target.type === "Name") into.add(stmt.target.name);
        break;
      case "For":
        into.add(stmt.varName);
        collectAssignedNames(stmt.body, into);
        break;
      case "While":
        collectAssignedNames(stmt.body, into);
        break;
      case "If":
        for (const c of stmt.cases) collectAssignedNames(c.body, into);
        if (stmt.orelse) collectAssignedNames(stmt.orelse, into);
        break;
      case "Try":
        // A handler's own `except X as e:` binding is intentionally NOT
        // collected here — it's emitted as a block-scoped `const` inside
        // its own handler block (see genExceptDispatch), not meant to
        // escape that block the way a plain assignment does.
        collectAssignedNames(stmt.body, into);
        for (const h of stmt.handlers) collectAssignedNames(h.body, into);
        if (stmt.orelse) collectAssignedNames(stmt.orelse, into);
        if (stmt.finallyBody) collectAssignedNames(stmt.finallyBody, into);
        break;
      default:
        break;
    }
  }
}

export function transpile(program, { mode = "canvas" } = {}) {
  return new Transpiler(mode).transpileProgram(program, "lifecycle");
}

// Compiles a sibling module file (spec section 6) into a namespace-object
// expression: `const panda = <this>;` in the assembled script. Always
// compiles in sync ("canvas") mode — see the file-level comment.
export function transpileLibrary(program) {
  const body = new Transpiler("canvas").transpileProgram(program, "all");
  return `(() => {\n${body}\n})()`;
}
