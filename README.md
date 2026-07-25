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

Then open http://localhost:8080. (`serve.js` is a ~40-line zero-dependency
static file server — BambooScript ships as pure client-side JS per the
spec's architecture decision in section 6.2.)

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
  `frame_count`/`no_loop()`/`loop()`.
- **Sandbox** (`src/sandbox.js`): compiles and runs a sketch, drives the
  `setup()`/`draw()` `requestAnimationFrame` loop, and turns parse/runtime
  errors into plain-English messages with a line number. Includes a
  per-call iteration guard (see "Known limitations" below).
- **Storage** (`src/storage.js`): client-side-only file management
  (New/Save/Save As/Open/Rename/Delete) backed by `localStorage`, plus
  file download/upload for cross-device use — no backend, per spec 5.2.
- **Editor shell** (`index.html`, `styles.css`, `src/app.js`): code pane
  with line numbers and syntax highlighting, canvas pane, Run/Stop, and
  the sketch list sidebar.
- **File icon** (`assets/bamboo-script-icon.svg`, plus 16/32/64/128 PNG
  fallbacks in `assets/png/`): the `</>`-with-bamboo-stalk mark from
  spec 2.3.
- **Examples** (`examples/*.bs`): the spec's own hexagon/octagon
  examples, a `while`-loop square, and `bamboo_stalk.bs` — the "draw a
  bamboo stalk using loops" lesson from spec section 7.

## Project layout

```
index.html, styles.css      Editor shell
src/lexer.js                 Tokenizer
src/parser.js                Recursive-descent parser -> AST
src/transpiler.js             AST -> JS codegen
src/runtime.js                Canvas + turtle + input/timing stdlib
src/sandbox.js                Compile/run pipeline, error mapping, rAF loop
src/storage.js                localStorage-backed file management
src/app.js                    Wires the editor shell UI together
src/errors.js                 Shared BambooSyntaxError / BambooRuntimeError
serve.js                       Zero-dependency static file server
docs/SPEC.md                   Full technical spec
examples/*.bs                  Example sketches
assets/                         File icon (SVG master + PNG exports)
tests/                          node:test unit tests for lexer/parser/transpiler/runtime/storage
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
- No multi-file projects, custom asset uploads, or cloud save/sharing —
  all later-phase per spec 5.3.
