// Resolves and assembles a multi-file BambooScript project (spec section
// 6) into one combined JS snippet, ready for `new Function("__rt", code)`.
// A project is a flat folder: an entry file (main.bs) plus any number of
// sibling .bs files, imported by name with no path segments.
import { parse } from "./parser.js";
import { transpile, transpileLibrary } from "./transpiler.js";
import { BambooSyntaxError } from "./errors.js";

// Names that resolve to a built-in stdlib mock (src/stdlib/index.js) instead
// of a sibling .bs file — working toward Terminal-tab scripts being
// copy-paste compatible with real Python (spec 3.2). A project's own file
// always wins if one exists with this name (matches Python's own well-known
// "a local math.py on sys.path shadows the stdlib" behavior) — this set is
// only consulted after `getModuleSource` has already come back empty.
export const STDLIB_MODULE_NAMES = new Set([
  "math", "random", "time", "os", "sys", "json", "re",
  "string", "collections", "itertools", "datetime",
]);

function collectImports(ast) {
  return ast.body
    .filter((n) => n.type === "Import" || n.type === "FromImport")
    .map((n) => ({ module: n.module, line: n.line }));
}

/**
 * Walks the import graph starting from `mainAst`, resolving each sibling
 * module's source via `getModuleSource(name)` (should return a string, or
 * null/undefined if no such file exists). Returns `{ order, resolved,
 * stdlibNames }`: `order` is the list of sibling-file module names in
 * dependency-first (topological) order, `resolved` maps each of those
 * names to its parsed AST, and `stdlibNames` is the set of imported names
 * that resolved to a built-in stdlib mock instead (spec 3.2) — these have
 * no AST of their own, so they're tracked separately and never appear in
 * `order`/`resolved`.
 *
 * Throws a BambooSyntaxError naming the missing file, or naming the full
 * cycle, on failure — these are meant to be shown to the learner directly,
 * the same as any other parse error.
 */
export function resolveProject(mainAst, getModuleSource) {
  const resolved = new Map();
  const order = [];
  const onStack = new Set();
  const stdlibNames = new Set();

  function visit(name, line, path) {
    if (resolved.has(name) || stdlibNames.has(name)) return;
    if (onStack.has(name)) {
      throw new BambooSyntaxError(
        `Circular import: ${[...path, name].join(" -> ")}. Remove one of these imports to break the cycle.`,
        line
      );
    }
    const source = getModuleSource(name);
    if (source === null || source === undefined) {
      // A project's own file always wins if one exists (checked above via
      // getModuleSource first) — only fall back to a stdlib mock once
      // that's confirmed absent.
      if (STDLIB_MODULE_NAMES.has(name)) {
        stdlibNames.add(name);
        return;
      }
      throw new BambooSyntaxError(`Can't find a sibling file named '${name}.bs' to import.`, line);
    }
    let ast;
    try {
      ast = parse(source);
    } catch (e) {
      if (e instanceof BambooSyntaxError) {
        throw new BambooSyntaxError(`In '${name}.bs': ${e.message}`, line);
      }
      throw e;
    }
    onStack.add(name);
    for (const imp of collectImports(ast)) {
      visit(imp.module, imp.line, [...path, name]);
    }
    onStack.delete(name);
    resolved.set(name, ast);
    order.push(name);
  }

  for (const imp of collectImports(mainAst)) {
    visit(imp.module, imp.line, ["main"]);
  }

  return { order, resolved, stdlibNames };
}

/**
 * Parses `mainSource`, resolves every sibling module and stdlib mock it
 * (transitively) imports, and returns one JS string: stdlib bindings
 * first (they never depend on anything else, so they're always safe to
 * bind before any user code runs), then each sibling dependency's
 * namespace object (deepest first), then the entry file's own compiled
 * code.
 */
export function assembleProject(mainSource, getModuleSource, mode = "canvas") {
  const mainAst = parse(mainSource);
  const { order, resolved, stdlibNames } = resolveProject(mainAst, getModuleSource);

  const parts = [];
  for (const name of stdlibNames) {
    parts.push(`const ${name} = __rt.__stdlib.${name};`);
  }
  for (const name of order) {
    parts.push(`const ${name} = ${transpileLibrary(resolved.get(name))};`);
  }
  parts.push(transpile(mainAst, { mode }));
  return parts.join("\n");
}
