// Builds the namespace objects behind `import math`, `import random`, etc.
// (spec 3.2 — working toward Terminal-tab scripts being copy-paste
// compatible with real Python). Each module's actual logic lives in its
// own src/stdlib/<name>.js file, mirroring src/pystrings.js's existing
// pure-logic-file convention: no class/DOM/canvas dependency, dispatched
// into by the runtime rather than reaching into the DOM itself.
//
// Pure modules (no state of their own) are plain frozen objects, built
// once. Stateful modules (random, time, os) will be factory functions
// that close over the owning runtime instance, so e.g. `random.seed(...)`
// can share the exact same seeded PRNG that already powers Canvas mode's
// `random()`/`noise()` — see src/stdlib/random.js once it exists.
import { STRING_MODULE } from "./string.js";

export function buildStdlib(runtime) {
  return {
    string: STRING_MODULE,
  };
}
