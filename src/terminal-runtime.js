// The Terminal tab's runtime (spec 3.6): a "pure Python" style script
// world with only print()/input() — no canvas, no setup()/draw() loop.
// Every canvas-only builtin is stubbed with a friendly error pointing back
// to the Canvas tab, rather than a raw "not a function" crash.
import { RuntimeBase } from "./runtime-base.js";
import { BambooRuntimeError } from "./errors.js";
import { CANVAS_ONLY_BUILTIN_NAMES } from "./transpiler.js";

export class StoppedError extends Error {
  constructor() {
    super("Stopped");
    this.name = "StoppedError";
  }
}

export class TerminalRuntime extends RuntimeBase {
  constructor() {
    super();
    this.onInputRequest = null; // (promptText, resolve) => void — set by the UI
    this._pendingInputReject = null;

    for (const name of CANVAS_ONLY_BUILTIN_NAMES) {
      this[name] = () => {
        throw new BambooRuntimeError(
          `${name}() isn't available in Terminal mode — switch to the Canvas tab to draw shapes.`,
          this.__line
        );
      };
    }
  }

  input(prompt) {
    return new Promise((resolve, reject) => {
      this._pendingInputReject = reject;
      const settle = (value) => {
        this._pendingInputReject = null;
        resolve(value);
      };
      if (typeof this.onInputRequest === "function") {
        this.onInputRequest(prompt === undefined ? "" : String(prompt), settle);
      } else {
        settle("");
      }
    });
  }

  // Called when the sketch is stopped while paused at input() — rejects
  // with a sentinel the sandbox treats as "the user stopped it", not a
  // real error, so no scary message shows up.
  cancelPendingInput() {
    if (this._pendingInputReject) {
      const reject = this._pendingInputReject;
      this._pendingInputReject = null;
      reject(new StoppedError());
    }
  }

  dispose() {
    this.cancelPendingInput();
  }
}
