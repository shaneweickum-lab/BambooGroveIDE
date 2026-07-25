# BambooGrove IDE

BambooGrove is a web-based IDE for **BambooScript** — a visual-first
scripting language that reads like Python and draws to an HTML5 canvas,
in the spirit of p5.js and Processing. It's a teaching and creative-coding
tool, not a general-purpose language: write a short script, press Run, and
watch shapes and turtle-graphics patterns draw themselves.

The full design spec lives in [`docs/SPEC.md`](docs/SPEC.md). This README
covers what's actually implemented and how to run it.

## Quick start

No build step, no dependencies to install.

```
npm start
```

Then open http://localhost:8080 — that's the marketing landing page
(`index.html`). Click "Launch the IDE" (or go straight to
http://localhost:8080/ide.html) for the actual editor. (`serve.js` is a
~40-line zero-dependency static file server — BambooScript ships as pure
client-side JS per the spec's architecture decision in section 6.2.)

To run the test suite:

```
npm test
```

## What's implemented (v0.1)

- **Language** (`src/lexer.js`, `src/parser.js`): a hand-written
  tokenizer with Python-style `INDENT`/`DEDENT` handling and a
  recursive-descent parser, covering the full v0.1 grammar — `def`,
  `if`/`elif`/`else`, `for ... in range()`/`for ... in <list>`, `while`,
  `return`, list literals + indexing, `and`/`or`/`not`, comparisons,
  arithmetic, and `#` comments.
- **Transpiler** (`src/transpiler.js`): walks the AST and emits a JS
  function body that calls into the runtime for every visible effect.
  Every statement is tagged with its original source line so errors can
  be mapped back to BambooScript, not generated JS (spec 4.2).
- **Canvas runtime** (`src/runtime.js`): the full stdlib from spec
  3.3 — drawing primitives, turtle movement, mouse/keyboard input,
  `frame_count`/`no_loop()`/`loop()` — plus the Phase 1 p5.js-compatible
  layer from spec 3.6: shapes (`ellipse`/`arc`/`quad`/`triangle`/`square`
  + `ellipseMode`/`rectMode`), color (`color`/`red`/`green`/`blue`/
  `alpha`/`lerpColor`/`colorMode` incl. HSB), transform (`push`/`pop`/
  `translate`/`rotate`/`scale`), math (`map`/`lerp`/`constrain`/`dist`/
  `random`/`randomSeed`, seeded and deterministic), typography, and the
  `mouseX`/`pmouseX`/`keyIsPressed`/`PI`/`TWO_PI`/... globals. Mode
  setters (`ellipseMode`, `rectMode`, `colorMode`, `textAlign`) take
  plain lowercase strings (`"center"`, `"hsb"`) rather than named
  constants, to avoid inventing a large constants surface beyond the
  handful (`PI`, `TWO_PI`, ...) the spec calls for.
- **Top-level shared variables**: a `name = value` line outside any
  `def` (spec 3.6's implicit assumption for p5-style sketches, e.g.
  `clicked = False` above `setup()`) becomes a real variable shared by
  every function — `draw()` and `mousePressed()` can both read and
  mutate it. This deliberately skips Python's `global` keyword
  requirement, since BambooScript's tagline is "run like JavaScript."
- **Event-driven lifecycle callbacks**: `mousePressed()`, `mouseReleased()`,
  `mouseDragged()`, `mouseMoved()`, `mouseClicked()`, `keyPressed()`, and
  `keyReleased()` are optional `def`s (like `setup`/`draw`) that the
  sandbox calls when the matching DOM event fires.
- **Terminal tab** (spec 3.6): a second execution mode for plain
  top-to-bottom scripts — no `setup()`/`draw()`, just `print()` and a
  genuinely-pausing `input()` (typing a line and hitting Enter resumes
  the script exactly where it left off). Canvas-only builtins are
  disabled there with a friendly redirect instead of a crash. Under the
  hood, Terminal mode compiles to `async` functions with every call
  awaited, so `input()` can really suspend execution — Canvas mode is
  untouched by this and stays fully synchronous.
- **Module system** (`src/modules.js`, spec section 6): `import name` and
  `from name import fn [as alias]` pull in a sibling `.bs` file within
  the same project. The resolver walks the import graph, detects
  circular imports (naming the full cycle) and missing files, and
  assembles everything into one script — each imported file becomes a
  namespaced object (`panda.draw_panda()`), in dependency order.
- **Reference tab**: a static quick-reference panel covering syntax, the
  full stdlib, and both execution modes — no need to leave the IDE to
  look something up.
- **General attribute/method access** (`src/parser.js`, `src/transpiler.js`):
  `.` works uniformly for any object — `panda.draw_panda()` (a module
  call), `v.x` (a property read), `v.add(1, 2)` (a method call) — and
  chains freely (`a.b.c()`). `constructor`/`prototype`/`__proto__` are
  rejected as attribute/method names so user code can't reach the JS
  `Function` constructor and escape the loop-guard.
- **p5.js Phase 2 layer** (spec 3.6): custom shapes (`bezier()`,
  `beginShape()`/`vertex()`/`endShape()`), Perlin noise (`noise()`,
  `noiseDetail()`, `noiseSeed()`), `createVector()` and p5.Vector-style
  vector math (`add`/`sub`/`mult`/`div`/`mag`/`normalize`/`limit`/
  `heading`/`rotate`/`dist`/`dot`/`cross`/`copy`/`set`/`array`/`equals`
  — mutating methods that return the vector for chaining, matching real
  p5.js; no operator overloading since JS doesn't support it), and data
  conversion (`int()`, `float()`, `str()`, `boolean()`). Image
  (`loadImage()`/`image()`/`tint()`/`noTint()`) was **not** implemented —
  see "Known limitations" below.
- **Sandbox** (`src/sandbox.js`): compiles and runs a sketch in either
  mode, drives the `setup()`/`draw()` `requestAnimationFrame` loop (with
  `frameRate()` throttling) in Canvas mode, dispatches the event
  callbacks above, and turns parse/runtime errors into plain-English
  messages with a line number. Includes a per-call iteration guard (see
  "Known limitations" below).
- **Storage** (`src/storage.js`): client-side-only file management
  (New/Save/Save As/Open/Rename/Delete) backed by `localStorage`, plus
  file download/upload for cross-device use — no backend, per spec 5.2.
  A "project" is a flat group of files sharing a `projectId` (the entry
  file's own id doubles as the project's id), backing the module system
  above.
- **Editor shell** (`ide.html`, `styles.css`, `src/app.js`): one shared
  code pane (line numbers + syntax highlighting) feeding a tabbed output
  pane — Canvas / Terminal / Reference — plus Run/Stop, the sketch list
  sidebar, and a project-files chip row for switching between a
  project's main file and its sibling modules (with a "+" to add one).
- **Landing page** (`index.html`, `landing.css`): the site's marketing
  front door — hero, feature grid, a code showcase, and a "Launch the
  IDE" call to action that links to `ide.html`. Static HTML/CSS, no JS
  framework, consistent with the "no build step" design (spec 1.2).
- **File icon** (`assets/bamboo-script-icon.svg`, plus 16/32/64/128 PNG
  fallbacks in `assets/png/`): the `</>`-with-bamboo-stalk mark from
  spec 2.3. `assets/png/logo.png` and `assets/png/hero.png` are the
  landing page's fuller-color brand artwork (glow-mark logo and the
  bamboo/editor/wordmark hero illustration).
- **Examples** (`examples/*.bs`): the spec's own hexagon/octagon
  examples, a `while`-loop square, `bamboo_stalk.bs` — the "draw a
  bamboo stalk using loops" lesson from spec section 7 — 
  `p5_style_orbit.bs` (`push`/`translate`/`rotate`, a top-level shared
  variable, `mousePressed()`), `terminal_quiz.bs` (Terminal-tab
  print/input), `modules_main.bs` + `modules_panda.bs` (a two-file
  project — see the comment in `modules_main.bs` for how to load both),
  `phase2_demo.bs` (a `createVector()` position nudged by `noise()`,
  a `bezier()` curve, and a custom `beginShape()`/`vertex()`/`endShape()`
  shape), `hsb_rainbow.bs` (`colorMode("hsb")` spinning a rainbow ring),
  `terminal_calculator.bs` (Terminal-tab `input()` + `float()`/`str()`
  conversions), and `smart_missiles/` — a two-file project (`main.bs` +
  `missile.bs`) with a small fleet of missiles homing in on a moving
  target using p5.Vector-style "seek" steering (Coding Train / Nature
  of Code style): each frame, `missile.bs`'s `steer_toward()` computes
  the desired velocity toward the target, limits how sharply it can
  turn (`Vector.limit()`), and lets `main.bs` draw the result rotated
  to face its heading.

## Project layout

```
index.html, landing.css      Marketing landing page
ide.html, styles.css         Editor shell
src/lexer.js                 Tokenizer
src/parser.js                Recursive-descent parser -> AST
src/transpiler.js             AST -> JS codegen (Canvas + Terminal modes, library modules)
src/runtime-base.js           Guard/truthiness/list logic shared by both runtimes
src/runtime.js                Canvas + turtle + input/timing stdlib (BambooRuntime)
src/terminal-runtime.js       Terminal tab's runtime: print()/input(), canvas-builtin stubs
src/modules.js                Import graph resolution + multi-file assembly (spec section 6)
src/sandbox.js                Compile/run pipeline for both modes, error mapping, rAF loop
src/storage.js                localStorage-backed file + project management
src/app.js                    Wires the editor shell UI together (tabs, terminal, project chips)
src/errors.js                 Shared BambooSyntaxError / BambooRuntimeError
serve.js                       Zero-dependency static file server
docs/SPEC.md                   Full technical spec
examples/*.bs                  Example sketches
assets/                         File icon (SVG master + PNG exports)
tests/                          node:test unit tests for every src/ module
```

## Deploying

BambooGrove is a static site with no build step, so it deploys to Vercel
as-is: `vercel.json` pins `framework: null` and `outputDirectory: "."` so
Vercel serves the repo root directly instead of guessing. Connect the repo
in the Vercel dashboard (or run `vercel --prod` from this directory) and
no further configuration is needed — `serve.js` is only for local dev and
isn't used in production.

## Known limitations / open items

These mirror the open questions in `docs/SPEC.md` section 6:

- **Sandbox isolation** is currently a scoped `new Function` call (no
  `window`/`document` access from user code) plus an iteration-count and
  wall-clock guard per `setup()`/`draw()` call — not full iframe/Worker
  isolation. That's still an open decision, not a final one.
- No custom asset uploads or cloud save/sharing — later-phase per spec 5.3.
- Module system scope: v0.1 flat-folder only (spec 6.6) — no subfolders,
  no dotted import paths. Library modules (imported sibling files) always
  compile in Canvas (sync) mode regardless of the importing file's mode,
  since they're meant to be reusable helper functions (the spec's own
  `draw_panda()`/`panda_walk()` example) — a sibling file can't itself
  call `input()`.
- p5.js Phase 1 coverage has known simplifications: `circle(x, y, r)`
  keeps its original radius-based signature rather than switching to
  p5's diameter-based one (avoids silently breaking existing scripts);
  `red()`/`green()`/`blue()`/`alpha()` return the raw channel values
  `color()` was given, not always-0-255 RGB (p5 converts on read
  regardless of color mode; this doesn't); `arc()` always renders in
  p5's default open/pie style rather than supporting all four of p5's
  arc modes.
- Mode-setter functions (`ellipseMode`, `rectMode`, `colorMode`,
  `textAlign`) take plain lowercase strings (`"center"`, `"hsb"`) instead
  of named constants like `p5.CENTER`, to avoid inventing a large
  constants surface beyond the handful (`PI`, `TWO_PI`, ...) the spec
  calls for.
- p5.js Phase 2's Image sub-category (`loadImage()`, `image()`,
  `tint()`, `noTint()`) is **not implemented**. It needs asset
  upload/hosting, and the current storage layer only persists `.bs`
  source text to `localStorage` — no binary asset support yet. Revisit
  once that's in place.
