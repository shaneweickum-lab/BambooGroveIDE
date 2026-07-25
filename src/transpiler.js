// Transpiles a BambooScript AST (see parser.js) into a JS source string.
// The generated source, run through `new Function('__rt', src)`, returns
// `{ setup, draw }` — plain JS functions that call back into the runtime
// object (`__rt`, see runtime.js) for every visible effect.
//
// Design notes:
//  - Every builtin (background, forward, mouse_x, ...) is only ever reached
//    through `__rt.*`, so user variable/function names never collide with
//    stdlib names and don't need to be reserved.
//  - `__rt.__line` is updated before most statements so a thrown error can
//    be mapped back to the original BambooScript source line.
//  - `__rt.__tick(line)` is called on every loop iteration as an infinite
//    loop guard (see runtime.js for the actual limits).
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

class Transpiler {
  constructor() {
    this.tempCounter = 0;
  }

  nextTemp() {
    return `__t${this.tempCounter++}`;
  }

  transpileProgram(program) {
    const functionDefs = program.body.filter((n) => n.type === "FunctionDef");
    const topLevelStmts = program.body.filter((n) => n.type !== "FunctionDef");

    // Top-level `name = value` assignments become real shared variables —
    // every function can read and mutate them by closing over the same
    // `let`, the way plain JS (and p5.js sketches) already work. This is a
    // deliberate deviation from Python, which would require an explicit
    // `global` keyword to write to a module-level name from inside a
    // function; BambooScript's tagline is "run like JavaScript", and
    // requiring `global` would make the setup()/draw()/event-callback
    // pattern this enables (e.g. a `clicked` flag set in mousePressed()
    // and read in draw()) needlessly awkward for a teaching tool.
    const globalNames = new Set();
    for (const stmt of topLevelStmts) {
      if (stmt.type === "Assign" && stmt.target.type === "Name") {
        assertValidIdentifier(stmt.target.name, stmt.line);
        globalNames.add(stmt.target.name);
      }
    }

    const lines = [`"use strict";`];
    if (globalNames.size) lines.push(`let ${[...globalNames].join(", ")};`);
    for (const fn of functionDefs) {
      lines.push(this.genFunctionDef(fn, globalNames));
    }
    for (const stmt of topLevelStmts) {
      lines.push(this.genStmt(stmt));
    }
    const returnFields = LIFECYCLE_NAMES
      .map((name) => `${name}: typeof ${name} === 'function' ? ${name} : null`)
      .join(", ");
    lines.push(`return { ${returnFields} };`);
    return lines.join("\n");
  }

  genFunctionDef(fn, globalNames) {
    assertValidIdentifier(fn.name, fn.line);
    for (const p of fn.params) assertValidIdentifier(p, fn.line);

    const locals = new Set();
    collectAssignedNames(fn.body, locals);
    for (const p of fn.params) locals.delete(p);
    for (const g of globalNames) locals.delete(g);
    for (const name of locals) assertValidIdentifier(name, fn.line);

    const decl = locals.size ? `let ${[...locals].join(", ")};` : "";
    const body = fn.body.map((stmt) => this.genStmt(stmt)).join("\n");
    return `function ${fn.name}(${fn.params.join(", ")}) {\n${decl}\n${body}\n}`;
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
      case "Call":
        return this.genCall(node);
      case "BinOp":
        return `(${this.genExpr(node.left)} ${BINOP_JS[node.op]} ${this.genExpr(node.right)})`;
      case "Compare":
        return `(${this.genExpr(node.left)} ${COMPARE_JS[node.op]} ${this.genExpr(node.right)})`;
      case "BoolOp": {
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
    if (Object.prototype.hasOwnProperty.call(RUNTIME_BUILTINS, node.callee)) {
      return `__rt.${RUNTIME_BUILTINS[node.callee]}(${args})`;
    }
    assertValidIdentifier(node.callee, node.line);
    return `${node.callee}(${args})`;
  }
}

// Maps BambooScript stdlib call names to BambooRuntime method names.
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
};

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

export function transpile(program) {
  return new Transpiler().transpileProgram(program);
}
