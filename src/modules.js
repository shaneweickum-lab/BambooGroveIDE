// Resolves and assembles a multi-file BambooScript project (spec section
// 6) into one combined JS snippet, ready for `new Function("__rt", code)`.
// A project is a flat folder: an entry file (main.bs) plus any number of
// sibling .bs files, imported by name with no path segments.
import { parse } from "./parser.js";
import { transpile, transpileLibrary } from "./transpiler.js";
import { BambooSyntaxError } from "./errors.js";

function collectImports(ast) {
  return ast.body
    .filter((n) => n.type === "Import" || n.type === "FromImport")
    .map((n) => ({ module: n.module, line: n.line }));
}

/**
 * Walks the import graph starting from `mainAst`, resolving each sibling
 * module's source via `getModuleSource(name)` (should return a string, or
 * null/undefined if no such file exists). Returns `{ order, resolved }`:
 * `order` is the list of module names in dependency-first (topological)
 * order, and `resolved` maps each name to its parsed AST.
 *
 * Throws a BambooSyntaxError naming the missing file, or naming the full
 * cycle, on failure — these are meant to be shown to the learner directly,
 * the same as any other parse error.
 */
export function resolveProject(mainAst, getModuleSource) {
  const resolved = new Map();
  const order = [];
  const onStack = new Set();

  function visit(name, line, path) {
    if (resolved.has(name)) return;
    if (onStack.has(name)) {
      throw new BambooSyntaxError(
        `Circular import: ${[...path, name].join(" -> ")}. Remove one of these imports to break the cycle.`,
        line
      );
    }
    const source = getModuleSource(name);
    if (source === null || source === undefined) {
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

  return { order, resolved };
}

/**
 * Parses `mainSource`, resolves every sibling module it (transitively)
 * imports, and returns one JS string: each dependency's namespace object
 * first (deepest first), then the entry file's own compiled code.
 */
export function assembleProject(mainSource, getModuleSource, mode = "canvas") {
  const mainAst = parse(mainSource);
  const { order, resolved } = resolveProject(mainAst, getModuleSource);

  const parts = [];
  for (const name of order) {
    parts.push(`const ${name} = ${transpileLibrary(resolved.get(name))};`);
  }
  parts.push(transpile(mainAst, { mode }));
  return parts.join("\n");
}
