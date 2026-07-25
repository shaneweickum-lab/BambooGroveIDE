# BambooScript Language + BambooGrove IDE — Technical Specification

Version: 0.1 (Draft)
Status: Pre-development / Planning
Last Updated: 2026

This document is the source-of-truth design spec that the initial
implementation in this repository is built against. See `README.md` for
the current implementation status of each section.

## 1. Overview

### 1.1 Project Summary

BambooScript is a visual-first scripting language designed to feel like
writing Python, while executing entirely as canvas-based visual output in
the browser. It is not a general-purpose language — it is a teaching and
creative-coding tool, in the spirit of p5.js and the Processing language,
built specifically for learners and content creators.

BambooGrove IDE is the web-based platform where BambooScript is written,
run, saved, and shared. It is the "home" of the language — the editor,
the canvas runtime, the file system, and (eventually) the community
sharing layer all live here.

Together, these two form one ecosystem:

    BambooScript  = the language (syntax + runtime semantics)
    BambooGrove   = the platform (editor + execution environment + storage)

### 1.2 Design Philosophy

- Write like Python. Run like JavaScript.
- No build step visible to the learner — write code, press run, see art.
- Visual output only. No DOM manipulation, no general app logic, no
  server-side execution. The canvas is the only rendering target.
- Approachable syntax over language completeness. BambooScript does not
  need to be Turing-complete-with-every-feature on day one. It needs to
  teach loops, functions, conditionals, and visual thinking.
- Homage, not imitation. BambooScript borrows Python's readability
  (indentation, plain-English keywords, minimal punctuation) without
  claiming to BE Python or run existing Python code.

### 1.3 Primary Use Cases

- A learner opens BambooGrove, writes a short script, and watches shapes,
  patterns, or animations draw themselves on canvas.
- A content creator (YouTube series) uses BambooGrove on-screen to teach
  programming concepts through visual output, in the style of Coding
  Train / p5.js tutorials.
- A student saves their work as a .bs file, reopens it later, and
  continues editing.

## 2. File Format Specification

### 2.1 File Extension

Extension: `.bs`
Example: `main.bs`, `sketch_01.bs`, `panda_walk.bs`
MIME type: `text/x-bamboo-script` (proposed, unregistered)
Encoding: UTF-8, plain text

### 2.2 File Structure

A `.bs` file is plain text containing BambooScript source code. No binary
headers, no metadata embedded in v0.1. File metadata (name, created date,
last modified, thumbnail preview) is tracked separately by BambooGrove's
project manager, not inside the file itself.

Example minimal file (`main.bs`):

```
def setup():
    background(255, 255, 255)

def draw():
    stroke(34, 139, 34)
    for i in range(8):
        forward(100)
        turn(45)
```

### 2.3 File Icon / Designator

Every `.bs` file uses the BambooScript mark as its icon:

- Asset: `bamboo-script-icon.svg` (and `.png` fallback, transparent bg)
- Motif: `</>` code brackets with the bamboo stalk replacing the
  forward slash, tilted diagonally, with two small leaves
- Color: Forest green (`#3F7A2C` approx, single flat tone, no gradient)
  on transparent background
- Usage: 16x16 / 32x32 / 64x64 / 128x128 raster exports for file icons,
  favicon, and app icon use; SVG master file for all other scaling needs

## 3. BambooScript Language Design

### 3.1 Syntax Principles

- Indentation-based blocks (like Python) — no curly braces.
- `def` for function/block definitions.
- Two required lifecycle functions, mirroring p5.js's setup()/draw():
  - `def setup():` — runs once, on load
  - `def draw():` — runs once per frame (or once, if `no_loop()` called)
- snake_case naming convention throughout the standard library.
- Comments use `#` (Python-style).
- No semicolons.
- Minimal punctuation: prefer `and`, `or`, `not` over `&&`, `||`, `!`.

### 3.2 Core Language Constructs (v0.1 scope)

- Variables: dynamically typed (num, string, bool, list, dict)
- Control flow: `if` / `elif` / `else`, `for ... in range()`, `while`
- Functions: `def name(params):`, `return`
- Loops: `for i in range(n):`, `while condition:`
- Lists: basic list literals and indexing
- Comments: `#` single line only in v0.1

### 3.3 Visual/Canvas Standard Library (v0.1 scope)

Drawing primitives:

```
background(r, g, b)
stroke(r, g, b)
fill(r, g, b)
no_fill()
no_stroke()
line(x1, y1, x2, y2)
rect(x, y, w, h)
circle(x, y, r)
point(x, y)
text(string, x, y)
```

Turtle-style movement (for teaching loops/geometry visually):

```
forward(distance)
turn(degrees)          # right() and left() as aliases
pen_up()
pen_down()
go_to(x, y)
home()
```

Input:

```
mouse_x, mouse_y        (globals, read-only)
is_pressed()
key_pressed              (global, read-only)
```

Timing/State:

```
frame_count              (global, read-only)
no_loop()                # stop draw() from repeating
loop()                    # resume draw() repeat
```

### 3.4 What BambooScript Is NOT (v0.1 scope boundaries)

- Not a DOM manipulation tool. No HTML element access.
- Not a general app framework. No routing, no state management patterns.
- Not Python. Cannot import or run real .py files or PyPI packages.
- Not multi-file/module system in v0.1 (single-file scripts only).
- Not networked. No fetch/HTTP/socket support in v0.1.

### 3.5 Example Program

```
def setup():
    background(20, 20, 20)
    stroke(34, 139, 34)

def draw():
    for i in range(6):
        forward(120)
        turn(60)
```

## 4. Execution Model

### 4.1 Pipeline

1. User writes BambooScript source in the BambooGrove editor.
2. On "Run," source text is parsed into an AST by the BambooScript
   parser (written in JavaScript).
3. AST is transpiled into a JS function that calls into the BambooGrove
   canvas runtime (a p5.js-style wrapper around the HTML5 Canvas 2D API).
4. `setup()` runs once; `draw()` runs on a `requestAnimationFrame` loop
   unless `no_loop()` is called.

### 4.2 Error Handling

- Parse errors are caught and mapped back to the original BambooScript
  line number (not the transpiled JS line number) for learner-friendly
  error messages.
- Runtime errors (e.g., undefined variable, bad argument type) should
  produce plain-English error messages, not raw JS stack traces.
- Infinite loop protection: a max iteration count on synchronous loops
  within a single `setup()`/`draw()` call, to prevent browser tab
  freezing (critical for classroom/learner use).

## 5. BambooGrove IDE — Platform Specification

### 5.1 Core Features (v0.1 / MVP)

- Code editor pane (syntax highlighting for BambooScript keywords,
  functions, strings, numbers, comments)
- Canvas output pane (live preview, updates on Run)
- Run / Stop controls
- File management: New, Save, Save As, Open, Rename, Delete
  - Files saved as `.bs`, displayed with the BambooScript file icon
  - Default filename on new file: `main.bs`
- Basic project/workspace concept: a saved sketch = one `.bs` file +
  optional metadata (title, thumbnail, last modified)

### 5.2 Storage (v0.1)

- 100% client-side. No backend server required for v0.1 launch.
- Browser local storage / IndexedDB is the primary and only storage
  layer for MVP — `.bs` files persist locally in the browser.
- File download/upload (Save As -> download `.bs` file to disk, Open ->
  upload `.bs` file from disk) covers cross-device use in v0.1, since
  there is no server to sync accounts against.
- Optional account-based cloud save and public sharing links remain a
  later-phase feature and would be the first feature to require
  introducing a backend at all.

### 5.3 Later-Phase Features (not required for MVP)

- Public gallery / sharing (like OpenProcessing or the p5.js web editor)
- Embeddable sketches (iframe embed for the YouTube companion site)
- Multi-file projects
- Custom asset uploads (images, sounds)
- Collaborative/live-share editing
- Desktop app wrapper (Electron/Tauri) with native `.bs` file association

### 5.4 Branding Within the Platform

- Primary icon/mark: `</>` with bamboo stalk (see 2.3)
- Color palette: forest green primary, warm off-white/cream background,
  dark charcoal for code editor chrome
- Editor theme: dark background for the code pane, light/cream canvas
  preview pane
- Tagline (candidate): "Write like Python. Run like JavaScript."

## 6. Open Questions / Decisions Needed

### 6.1 Naming/Scope

- [ ] Confirm final platform name: BambooGrove IDE (vs. BambooGrove Studio,
      BambooGrove Editor, etc.)
- [ ] Confirm domain availability for chosen name before public launch

### 6.2 Technical

- [ ] Sandbox strategy: iframe vs. Web Worker vs. both, for safe script
      execution. **Current implementation note:** v0.1 runs transpiled
      code in the main thread via `new Function`, scoped to only the
      runtime API object (no `window`/`document` access from user code),
      with an iteration-count guard per `setup()`/`draw()` invocation.
      This is an interim measure, not the final decision — true
      iframe/Worker isolation remains open for a later pass.
- [x] Parser approach: hand-written recursive-descent parser (see
      `src/lexer.js` / `src/parser.js`). No parser generator dependency.
- [x] DECIDED: BambooScript v0.1 ships as pure client-side JS. No backend
      required to run scripts. The parser, transpiler, and canvas runtime
      all execute in the browser. This is a firm architectural decision
      for MVP, not just a recommendation.

### 6.3 Content/Teaching Integration

- [ ] Confirm relationship between BambooGrove platform and the YouTube
      series — will videos embed live BambooGrove sketches, or use
      screen-recorded sessions only?
- [ ] Define initial curriculum arc (first 10 videos = first 10 language
      concepts introduced, in order)

## 7. Next Steps

1. Finalize BambooScript v0.1 grammar (formal spec, not just examples)
2. Prototype the transpiler: BambooScript source -> JS -> canvas calls
3. Build minimal BambooGrove editor shell (code pane + canvas pane +
   Run button) as a standalone web page, before full platform/storage
   work
4. Validate the "teaching loop" — write and record one full example
   lesson (e.g., "draw a bamboo stalk using loops") end to end
