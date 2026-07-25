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
  constructor(message, line) {
    super(message);
    this.name = "BambooRuntimeError";
    this.line = line;
  }
}
