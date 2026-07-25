// Orchestrates the pipeline described in spec section 4.1: source -> AST ->
// JS -> a running sketch. Owns the requestAnimationFrame loop and turns any
// failure (parse, compile, or runtime) into a plain-English message mapped
// back to a BambooScript source line, per spec section 4.2.
import { BambooSyntaxError, BambooRuntimeError } from "./errors.js";
import { parse } from "./parser.js";
import { transpile } from "./transpiler.js";
import { BambooRuntime } from "./runtime.js";

function toFriendlyError(e, currentLine) {
  if (e instanceof BambooSyntaxError) return { message: e.message, line: e.line, kind: "syntax" };
  if (e instanceof BambooRuntimeError) return { message: e.message, line: e.line, kind: "runtime" };

  let message = e && e.message ? e.message : String(e);
  const undef = /^(\w+) is not defined$/.exec(message);
  const notFn = /^(.+) is not a function$/.exec(message);
  if (undef) {
    message = `'${undef[1]}' isn't defined. Check the spelling, or make sure you set it before using it.`;
  } else if (notFn) {
    message = `${notFn[1]} isn't something you can call like a function.`;
  }
  return { message, line: currentLine ?? null, kind: "runtime" };
}

export class Sketch {
  constructor(canvas) {
    this.canvas = canvas;
    this.runtime = null;
    this.program = null;
    this.rafId = null;
  }

  stop() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.runtime) this.runtime.dispose();
    this.runtime = null;
    this.program = null;
  }

  isRunning() {
    return this.runtime !== null;
  }

  /**
   * Compiles `source` and starts it running. Returns true on success.
   * `onError({message, line, kind})` is called at most once per run() call
   * with the first failure encountered.
   */
  run(source, { onError } = {}) {
    this.stop();

    let ast;
    try {
      ast = parse(source);
    } catch (e) {
      onError?.(toFriendlyError(e));
      return false;
    }

    let jsCode;
    try {
      jsCode = transpile(ast);
    } catch (e) {
      onError?.(toFriendlyError(e));
      return false;
    }

    let factory;
    try {
      // eslint-disable-next-line no-new-func -- this *is* the transpiler's output target
      factory = new Function("__rt", jsCode);
    } catch (e) {
      onError?.({ message: `Internal compiler error: ${e.message}`, line: null, kind: "internal" });
      return false;
    }

    const runtime = new BambooRuntime(this.canvas);
    this.runtime = runtime;
    runtime.onLoopResume = () => this._scheduleFrame(onError);

    let program;
    try {
      program = factory(runtime);
    } catch (e) {
      onError?.(toFriendlyError(e, runtime.__line));
      this.stop();
      return false;
    }
    this.program = program;

    if (!this._call(program.setup, onError)) return false;
    if (program.draw) this._scheduleFrame(onError);
    return true;
  }

  _call(fn, onError) {
    if (!fn) return true;
    this.runtime.resetGuard();
    try {
      fn();
      return true;
    } catch (e) {
      onError?.(toFriendlyError(e, this.runtime.__line));
      this.stop();
      return false;
    }
  }

  _scheduleFrame(onError) {
    if (this.rafId !== null || !this.runtime || !this.runtime.looping) return;
    const step = () => {
      this.rafId = null;
      if (!this.runtime || !this.runtime.looping) return;
      if (!this._call(this.program.draw, onError)) return;
      this.runtime.frameCount++;
      this._scheduleFrame(onError);
    };
    this.rafId = requestAnimationFrame(step);
  }
}
