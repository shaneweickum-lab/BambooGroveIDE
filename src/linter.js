// A learner-focused linter (separate from the parser's fatal syntax
// errors): it points out likely mistakes and style inconsistencies that
// don't stop a script from running, but tend to trip up someone new to
// programming or to BambooScript specifically.
//
// lint(source) never throws. If the source doesn't even parse, it reports
// that as `syntaxError` (reusing the parser's own friendly message) and
// skips the rest, since AST-based checks need a valid AST to run on.
// Otherwise it returns a list of `issues`, each `{ line, rule, severity,
// message }`, sorted by line number.
import { parse } from "./parser.js";
import { BambooSyntaxError } from "./errors.js";
import { ALL_BUILTIN_NAMES, ALL_GLOBAL_NAMES } from "./transpiler.js";

const RESERVED_NAMES = new Set([...ALL_BUILTIN_NAMES, ...ALL_GLOBAL_NAMES]);
const MAX_LINE_LENGTH = 100;

export function lint(source) {
  let ast;
  try {
    ast = parse(source);
  } catch (err) {
    if (err instanceof BambooSyntaxError) {
      return { syntaxError: { line: err.line, message: err.message }, issues: [] };
    }
    throw err;
  }

  const issues = [];
  checkLineLength(source, issues);
  checkBooleanComparisons(ast, issues);
  checkShadowedNames(ast, issues);
  checkNamingConsistency(ast, issues);
  checkUnusedVariables(ast, issues);

  issues.sort((a, b) => a.line - b.line);
  return { syntaxError: null, issues };
}

// --- Generic AST walkers -----------------------------------------------
// Two small walkers cover every rule below:
//  - forEachNode: every node, in no particular read/write role — enough
//    for rules that only care "does this node exist anywhere" (booleans,
//    line length doesn't need one at all).
//  - walkDefs: every *binding* occurrence (function/param/assignment
//    target/loop variable/import name) with its line and what kind of
//    binding it is.
//  - collectReads: every Name that's read (as opposed to just being the
//    left side of an `=`), for the unused-variable check.

function forEachNode(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) forEachNode(n, visit);
    return;
  }
  if (!node.type) return;
  visit(node);
  switch (node.type) {
    case "Program":
    case "FunctionDef":
      forEachNode(node.body, visit);
      break;
    case "If":
      for (const c of node.cases) { forEachNode(c.test, visit); forEachNode(c.body, visit); }
      if (node.orelse) forEachNode(node.orelse, visit);
      break;
    case "For":
      forEachNode(node.iterable, visit);
      forEachNode(node.body, visit);
      break;
    case "While":
      forEachNode(node.test, visit);
      forEachNode(node.body, visit);
      break;
    case "Try":
      forEachNode(node.body, visit);
      for (const h of node.handlers) forEachNode(h.body, visit);
      if (node.orelse) forEachNode(node.orelse, visit);
      if (node.finallyBody) forEachNode(node.finallyBody, visit);
      break;
    case "Raise":
      if (node.value) forEachNode(node.value, visit);
      break;
    case "Assign":
      forEachNode(node.target, visit);
      forEachNode(node.value, visit);
      break;
    case "Return":
      if (node.value) forEachNode(node.value, visit);
      break;
    case "ExprStmt":
      forEachNode(node.value, visit);
      break;
    case "ListLiteral":
      forEachNode(node.elements, visit);
      break;
    case "Index":
      forEachNode(node.object, visit);
      forEachNode(node.index, visit);
      break;
    case "Attribute":
      forEachNode(node.object, visit);
      break;
    case "Call":
      forEachNode(node.args, visit);
      break;
    case "MethodCall":
      forEachNode(node.object, visit);
      forEachNode(node.args, visit);
      break;
    case "BinOp":
    case "Compare":
    case "BoolOp":
      forEachNode(node.left, visit);
      forEachNode(node.right, visit);
      break;
    case "UnaryOp":
      forEachNode(node.operand, visit);
      break;
    case "FString":
      for (const part of node.parts) {
        if (part.type === "expr") forEachNode(part.expr, visit);
      }
      break;
    default:
      break; // Name, Num, Str, BoolLiteral, Import, FromImport: no children
  }
}

// Visits every binding site: visit(name, line, kind), kind one of
// "function" | "param" | "assign" | "loopvar" | "import".
function walkDefs(node, visit) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const n of node) walkDefs(n, visit);
    return;
  }
  switch (node.type) {
    case "Program":
      walkDefs(node.body, visit);
      break;
    case "FunctionDef":
      visit(node.name, node.line, "function");
      for (const p of node.params) visit(p, node.line, "param");
      walkDefs(node.body, visit);
      break;
    case "If":
      for (const c of node.cases) walkDefs(c.body, visit);
      if (node.orelse) walkDefs(node.orelse, visit);
      break;
    case "For":
      visit(node.varName, node.line, "loopvar");
      walkDefs(node.body, visit);
      break;
    case "While":
      walkDefs(node.body, visit);
      break;
    case "Try":
      walkDefs(node.body, visit);
      for (const h of node.handlers) {
        if (h.bindName) visit(h.bindName, h.line, "assign");
        walkDefs(h.body, visit);
      }
      if (node.orelse) walkDefs(node.orelse, visit);
      if (node.finallyBody) walkDefs(node.finallyBody, visit);
      break;
    case "Assign":
      if (node.target.type === "Name") visit(node.target.name, node.target.line, "assign");
      break;
    case "FromImport":
      for (const { name, alias } of node.names) visit(alias || name, node.line, "import");
      break;
    default:
      break;
  }
}

// Every Name read anywhere under `node` — a bare Name that's the direct
// target of an Assign is a write, not a read, and is excluded; everything
// else (including the object under `xs[i] = ...` or `v.x = ...`) counts.
function collectReads(node, into) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) collectReads(n, into);
    return;
  }
  if (!node.type) return;
  if (node.type === "Assign") {
    if (node.target.type !== "Name") collectReads(node.target, into);
    collectReads(node.value, into);
    return;
  }
  if (node.type === "Name") {
    into.add(node.name);
    return;
  }
  forEachNode(node, (n) => {
    if (n.type === "Name") into.add(n.name);
  });
}

function collectTopLevelAssignedNames(stmts) {
  const names = new Set();
  (function walk(list) {
    for (const stmt of list) {
      switch (stmt.type) {
        case "Assign":
          if (stmt.target.type === "Name") names.add(stmt.target.name);
          break;
        case "For":
          names.add(stmt.varName);
          walk(stmt.body);
          break;
        case "While":
          walk(stmt.body);
          break;
        case "If":
          for (const c of stmt.cases) walk(c.body);
          if (stmt.orelse) walk(stmt.orelse);
          break;
        case "Try":
          walk(stmt.body);
          for (const h of stmt.handlers) walk(h.body);
          if (stmt.orelse) walk(stmt.orelse);
          if (stmt.finallyBody) walk(stmt.finallyBody);
          break;
        default:
          break;
      }
    }
  })(stmts);
  return names;
}

// --- Rules ---------------------------------------------------------------

function checkLineLength(source, issues) {
  const lines = source.split("\n");
  lines.forEach((line, i) => {
    if (line.length > MAX_LINE_LENGTH) {
      issues.push({
        line: i + 1,
        rule: "line-too-long",
        severity: "info",
        message: `This line is ${line.length} characters long — consider breaking it up (most style guides suggest ${MAX_LINE_LENGTH} or fewer).`,
      });
    }
  });
}

function checkBooleanComparisons(ast, issues) {
  forEachNode(ast, (node) => {
    if (node.type !== "Compare" || (node.op !== "==" && node.op !== "!=")) return;
    const boolSide = node.left.type === "BoolLiteral" ? node.left
      : node.right.type === "BoolLiteral" ? node.right : null;
    if (!boolSide) return;
    const isEq = node.op === "==";
    const isTrue = boolSide.value === true;
    let fix;
    if ((isEq && isTrue) || (!isEq && !isTrue)) fix = "'if x:' instead of 'if x == True:'";
    else fix = "'if not x:' instead of 'if x == False:'";
    issues.push({
      line: node.line,
      rule: "boolean-comparison",
      severity: "info",
      message: `Comparing directly with True/False is redundant — use ${fix}.`,
    });
  });
}

function checkShadowedNames(ast, issues) {
  const flagged = new Set();
  walkDefs(ast, (name, line) => {
    if (!RESERVED_NAMES.has(name) || flagged.has(name)) return;
    flagged.add(name);
    issues.push({
      line,
      rule: "shadowed-builtin",
      severity: "warning",
      message: `'${name}' is already a built-in name in BambooScript. Using it for your own variable or function can make your code confusing to read (and, in a function, can hide the real ${name}).`,
    });
  });
}

// snake_case vs camelCase consistency, plus a "did you mean" check for two
// different names that are the same word in different casings — the
// classic typo that silently creates a second variable instead of erroring.
function checkNamingConsistency(ast, issues) {
  const firstSeenLine = new Map(); // name -> line
  walkDefs(ast, (name, line) => {
    if (RESERVED_NAMES.has(name)) return;
    if (!firstSeenLine.has(name)) firstSeenLine.set(name, line);
  });

  let firstSnakeCase = null;
  let firstCamelCase = null;
  const byNormalized = new Map(); // normalized -> [name, ...]

  for (const [name, line] of firstSeenLine) {
    const style = classifyStyle(name);
    if (style === "snake_case" && !firstSnakeCase) firstSnakeCase = name;
    if (style === "camelCase" && !firstCamelCase) firstCamelCase = name;

    const normalized = name.toLowerCase().replace(/_/g, "");
    if (!byNormalized.has(normalized)) byNormalized.set(normalized, []);
    byNormalized.get(normalized).push(name);
  }

  if (firstSnakeCase && firstCamelCase) {
    const line = firstSeenLine.get(firstCamelCase);
    issues.push({
      line,
      rule: "inconsistent-naming",
      severity: "info",
      message: `This file mixes naming styles — e.g. '${firstCamelCase}' (camelCase) alongside '${firstSnakeCase}' (snake_case). BambooScript is Python-flavored, so snake_case is the convention here.`,
    });
  }

  for (const [, names] of byNormalized) {
    if (names.length < 2) continue;
    const line = Math.max(...names.map((n) => firstSeenLine.get(n)));
    issues.push({
      line,
      rule: "similar-names",
      severity: "warning",
      message: `${names.map((n) => `'${n}'`).join(" and ")} look like they might be meant to be the same variable, but they're different names. If that's not intentional, use one consistently.`,
    });
  }
}

function classifyStyle(name) {
  if (/^[A-Z][A-Z0-9_]*$/.test(name)) return "constant";
  const hasUnderscore = name.includes("_");
  const hasInternalUpper = /[A-Z]/.test(name.slice(1));
  if (hasUnderscore && !hasInternalUpper) return "snake_case";
  if (!hasUnderscore && hasInternalUpper) return "camelCase";
  if (!hasUnderscore && !hasInternalUpper) return "neutral"; // single word, no signal either way
  return "other";
}

// Flags a plain local variable that's assigned but never read again —
// scoped correctly around BambooScript's shared-top-level-variable model
// (spec 3.6): a name assigned at the top level is a global every function
// can see, so it's only "unused" if nothing anywhere in the whole program
// reads it; a name assigned only inside one function is local to that
// function, so only that function's own reads count.
function checkUnusedVariables(ast, issues) {
  const functionDefs = ast.body.filter((n) => n.type === "FunctionDef");
  const topLevelStmts = ast.body.filter((n) => n.type !== "FunctionDef" && n.type !== "Import" && n.type !== "FromImport");

  const sharedGlobals = collectTopLevelAssignedNames(topLevelStmts);

  const readsEverywhere = new Set();
  collectReads(topLevelStmts, readsEverywhere);
  for (const fn of functionDefs) collectReads(fn.body, readsEverywhere);

  const flaggedGlobals = new Set();
  walkDefs(topLevelStmts, (name, line, kind) => {
    if (kind !== "assign" && kind !== "loopvar") return;
    if (kind === "loopvar") return; // unused loop variables are idiomatic (for i in range(...))
    if (flaggedGlobals.has(name) || readsEverywhere.has(name)) return;
    flaggedGlobals.add(name);
    issues.push({
      line,
      rule: "unused-variable",
      severity: "info",
      message: `'${name}' is assigned but never used anywhere in this file.`,
    });
  });

  for (const fn of functionDefs) {
    const localReads = new Set();
    collectReads(fn.body, localReads);
    const flaggedLocals = new Set();
    walkDefs(fn.body, (name, line, kind) => {
      if (kind !== "assign") return;
      if (sharedGlobals.has(name)) return; // this write mutates the shared global, not a local
      if (flaggedLocals.has(name) || localReads.has(name)) return;
      flaggedLocals.add(name);
      issues.push({
        line,
        rule: "unused-variable",
        severity: "info",
        message: `'${name}' is assigned in ${fn.name}() but never used there.`,
      });
    });
  }
}
