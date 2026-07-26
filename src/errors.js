// Shared error types used across the lexer, parser, transpiler, and runtime.
// Both carry a 1-based `line` number in the *original* BambooScript source so
// the editor can point learners at the right place, never at generated JS.

export class BambooSyntaxError extends Error {
  constructor(message, line) {
    super(message);
    this.name = "BambooSyntaxError";
    this.line = line;
  }
}

export class BambooRuntimeError extends Error {
  // `pythonType` (spec 3.2's exception taxonomy, e.g. "ValueError",
  // "IndexError") tags an error as catchable by a matching `except`
  // clause. Defaults to null, which means "not catchable by any except
  // clause, not even a bare `except:`" — internal guardrail errors (the
  // infinite-loop guard, etc.) stay uncatchable by design, only errors
  // deliberately tagged with a real Python exception type become
  // catchable, matching Python's own actual behavior for that error kind.
  constructor(message, line, pythonType = null) {
    super(message);
    this.name = "BambooRuntimeError";
    this.line = line;
    this.pythonType = pythonType;
  }
}
