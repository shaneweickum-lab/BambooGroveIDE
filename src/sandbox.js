// Orchestrates the pipeline described in spec section 4.1: source -> AST ->
// JS -> a running sketch. Owns the requestAnimationFrame loop, dispatches
// the optional p5.js-style event callbacks (spec 3.6), and turns any
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
    this._lastFrameTime = undefined;
    this._eventHandlers = null;
  }

  stop() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this._lastFrameTime = undefined;
    this._unwireEventCallbacks();
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
    runtime.onRedrawRequest = () => this._call(this.program.draw, onError);

    let program;
    try {
      program = factory(runtime);
    } catch (e) {
      onError?.(toFriendlyError(e, runtime.__line));
      this.stop();
      return false;
    }
    this.program = program;
    this._wireEventCallbacks(onError);

    if (!this._call(program.setup, onError)) return false;
    if (program.draw) this._scheduleFrame(onError);
    return true;
  }

  _call(fn, onError) {
    if (!fn || !this.runtime) return true;
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
    const step = (now) => {
      this.rafId = null;
      if (!this.runtime || !this.runtime.looping) return;
      const target = this.runtime.frameRateTarget;
      if (target) {
        const minDelta = 1000 / target;
        if (this._lastFrameTime !== undefined && now - this._lastFrameTime < minDelta) {
          this.rafId = requestAnimationFrame(step);
          return;
        }
      }
      this._lastFrameTime = now;
      if (!this._call(this.program.draw, onError)) return;
      this.runtime.frameCount++;
      this._scheduleFrame(onError);
    };
    this.rafId = requestAnimationFrame(step);
  }

  // Wires the optional p5.js-style event callbacks (spec 3.6, Events) to
  // the canvas/window, each routed through the guarded _call() so errors
  // inside them are reported and stop the sketch the same way a bad
  // draw() would.
  _wireEventCallbacks(onError) {
    const call = (fn) => this._call(fn, onError);
    const handlers = {
      mousedown: () => call(this.program.mousePressed),
      mouseup: () => call(this.program.mouseReleased),
      click: () => call(this.program.mouseClicked),
      mousemove: () => {
        if (!this.runtime) return;
        call(this.runtime._mousePressed ? this.program.mouseDragged : this.program.mouseMoved);
      },
      keydown: () => call(this.program.keyPressed),
      keyup: () => call(this.program.keyReleased),
    };
    this.canvas.addEventListener("mousedown", handlers.mousedown);
    this.canvas.addEventListener("mouseup", handlers.mouseup);
    this.canvas.addEventListener("click", handlers.click);
    this.canvas.addEventListener("mousemove", handlers.mousemove);
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", handlers.keydown);
      window.addEventListener("keyup", handlers.keyup);
    }
    this._eventHandlers = handlers;
  }

  _unwireEventCallbacks() {
    const handlers = this._eventHandlers;
    if (!handlers) return;
    this.canvas.removeEventListener("mousedown", handlers.mousedown);
    this.canvas.removeEventListener("mouseup", handlers.mouseup);
    this.canvas.removeEventListener("click", handlers.click);
    this.canvas.removeEventListener("mousemove", handlers.mousemove);
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", handlers.keydown);
      window.removeEventListener("keyup", handlers.keyup);
    }
    this._eventHandlers = null;
  }
}
