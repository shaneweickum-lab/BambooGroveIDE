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

const BINOP_JS = { "+": "+", "-": "-", "*": "*", "/": "/", "%": "%" };
const COMPARE_JS = { "==": "===", "!=": "!==", "<": "<", ">": ">", "<=": "<=", ">=": ">=" };

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

  genExpr(node) {
    switch (node.type) {
      case "Num":
        return JSON.stringify(node.value);
      case "Str":
        return JSON.stringify(node.value);
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
      case "BinOp":
        return `(${this.genExpr(node.left)} ${BINOP_JS[node.op]} ${this.genExpr(node.right)})`;
      case "Compare":
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
        return `(${node.op}${this.genExpr(node.operand)})`;
      default:
        throw new BambooSyntaxError(`Internal error: unknown expression '${node.type}'.`, node.line);
    }
  }

  genCall(node) {
    const args = node.args.map((a) => this.genExpr(a)).join(", ");
    let callExpr;
    if (Object.prototype.hasOwnProperty.call(RUNTIME_BUILTINS, node.callee)) {
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
    const callExpr = `${obj}.${node.method}(${args})`;
    return this.mode === "terminal" ? `(await ${callExpr})` : callExpr;
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
]);

export const CANVAS_ONLY_BUILTIN_NAMES = Object.keys(RUNTIME_BUILTINS).filter(
  (name) => !NON_CANVAS_BUILTINS.has(name)
);

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
