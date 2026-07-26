# BambooScript Language + BambooGrove IDE — Technical Specification

Version: 0.1 (Draft)
Status: Pre-development / Planning
Last Updated: 2026

This document is the source-of-truth design spec that the implementation
in this repository is built against. See `README.md` for the current
implementation status of each section.

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

### 1.2 Development Approach

BambooGrove IDE is being built as a fully client-side static web
application (HTML/CSS/JS, no backend server), developed with Claude
Code as the primary build tool. This reinforces the "no backend for
MVP" decision throughout this spec (see Section 5.2, Section 6.2) —
the entire platform should be deployable as static files (e.g., to
Vercel, Netlify, GitHub Pages) with zero server-side dependencies for
v0.1 launch.

### 1.3 Design Philosophy

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

### 1.4 Primary Use Cases

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
- Lists: basic list literals and indexing, plus `len(list)` and
  `list.append(value)` for reading a list's length and growing it at
  runtime (the only method BambooScript special-cases, since JS arrays
  have no native `.append`)
- Strings: single/double-quoted literals with `\n`/`\t`/`\\`/`\"`/`\'`
  escapes, plus f-strings (`f"hi {name}!"`) — any expression inside
  `{...}` is evaluated and stringified the same way `print()`/`str()`
  format values; `{{`/`}}` escape a literal brace, and `{expr:.Nf}`
  fixes a number to `N` decimal places
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
- Not networked. No fetch/HTTP/socket support in v0.1.
- Not a full Python-compatible module system. Import resolves sibling
  .bs files within the same project folder only (see Section 6) — no
  subfolders, no dotted paths, not real Python modules or PyPI
  packages.

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

### 3.6 p5.js API Compatibility Plan

Goal: BambooScript's standard library function names and signatures
should match p5.js wherever a direct equivalent exists, so anyone who
knows p5.js (or learns from p5js.org/reference alongside BambooScript)
can transfer knowledge directly. Function NAMES and PARAMETER ORDER
mirror p5.js; syntax (indentation, def, snake_case internals where
BambooScript diverges) stays Python-flavored.

The full p5.js reference (p5js.org/reference) is organized into these
top-level categories: Shape, Color, Typography, Image, Transform,
Environment, 3D, Rendering, Math, IO, Events, DOM, Data, Structure,
Constants, and Foundation. That is a large surface area — full DOM
element creation, WebGL/3D, shaders, device sensors, and file I/O are
out of scope for a browser-based visual teaching tool. BambooScript
implements a deliberate subset, phased by priority:

**PHASE 1 (v0.1 MVP) — direct p5.js name matches:**

- Shape > 2D Primitives: `arc()`, `circle()`, `ellipse()`, `line()`,
  `point()`, `quad()`, `rect()`, `square()`, `triangle()`
- Shape > Attributes: `ellipseMode()`, `rectMode()`, `strokeWeight()`,
  `strokeCap()`, `strokeJoin()`, `noSmooth()`, `smooth()`
- Color > Setting: `background()`, `fill()`, `noFill()`, `stroke()`,
  `noStroke()`, `clear()`, `colorMode()`, `blendMode()`
- Color > Creating & Reading: `color()`, `red()`, `green()`, `blue()`,
  `alpha()`, `lerpColor()`
- Transform: `push()`, `pop()`, `translate()`, `rotate()`, `scale()`,
  `resetMatrix()`
- Environment: `frameCount`, `frameRate()`, `width`, `height`,
  `windowWidth`, `windowHeight`, `cursor()`, `noCursor()`
- Math > Calculation, Trigonometry, Random: `abs()`, `ceil()`,
  `floor()`, `round()`, `constrain()`, `dist()`, `lerp()`, `map()`,
  `max()`, `min()`, `pow()`, `sq()`, `sqrt()`, `sin()`, `cos()`,
  `tan()`, `radians()`, `degrees()`, `random()`, `randomSeed()`
- Structure: `setup()`, `draw()`, `noLoop()`, `loop()`, `redraw()`,
  `isLooping()`
- Events > Keyboard: `keyIsPressed`, `key`, `keyPressed()`,
  `keyReleased()`
- Events > Pointer: `mouseX`, `mouseY`, `pmouseX`, `pmouseY`,
  `mouseIsPressed`, `mousePressed()`, `mouseReleased()`,
  `mouseDragged()`, `mouseMoved()`, `mouseClicked()`
- Rendering: `createCanvas()`, `resizeCanvas()`
- Typography (basic): `text()`, `textSize()`, `textAlign()`,
  `textFont()`
- Constants: `PI`, `TWO_PI`, `HALF_PI`, `QUARTER_PI`, `DEGREES`,
  `RADIANS`

  BambooScript-specific additions (no direct p5.js equivalent, added
  for the turtle-graphics teaching style): `forward()`, `turn()`,
  `pen_up()`, `pen_down()`, `go_to()`, `home()`

**PHASE 2 (post-MVP):**

- Shape > Curves and Custom Shapes: `bezier()`, `beginShape()`,
  `vertex()`, `endShape()` — **implemented**
- Math > Noise: `noise()`, `noiseDetail()`, `noiseSeed()` —
  **implemented**
- Math > p5.Vector: `createVector()` and vector math operations —
  **implemented** (mutating instance methods that return the vector
  for chaining, matching real p5.js; no operator overloading since
  JS doesn't support it)
- Data > Conversion: `int()`, `float()`, `str()`, `boolean()` —
  **implemented**
- Image: `loadImage()`, `image()`, `tint()`, `noTint()` — **deferred**.
  This needs asset-upload/hosting infrastructure (there's no file
  storage in a static-only, localStorage-backed IDE yet) and was
  judged out of scope for this pass. Revisit once the storage layer
  supports binary assets.

**OUT OF SCOPE** (not planned — conflicts with "visual-only,
client-side, teaching tool" design boundaries):

- DOM category in full (`createDiv`, `createButton`, `createSlider`,
  etc.) — BambooScript does not manipulate the surrounding page
- 3D category (camera, lights, material, shaders, WEBGL mode)
- IO category (`loadJSON`, `loadTable`, `httpGet`/`httpPost`, file
  writing) — no network or filesystem access in-browser
- Events > Acceleration (device motion/orientation sensors)
- p5.sound (audio) — may be reconsidered in a later major version

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

- Collaborative/live-share editing
- Desktop app wrapper (Electron/Tauri) with native `.bs` file association

### 5.4 Branding Within the Platform

- Primary icon/mark: `</>` with bamboo stalk (see 2.3)
- Color palette: forest green primary, warm off-white/cream background,
  dark charcoal for code editor chrome
- Editor theme: dark background for the code pane, light/cream canvas
  preview pane
- Tagline (candidate): "Write like Python. Run like JavaScript."

## 6. Module System and Folder Structure

### 6.1 Goal

BambooScript projects support splitting code across multiple `.bs`
files, and importing between them using Python-style import syntax.
This lets a project grow beyond a single `main.bs` file — e.g.,
separating a reusable "panda" character module from the main sketch
that uses it.

SCOPE FOR v0.1: single-folder only. A project is one flat folder
containing `main.bs` plus any number of sibling `.bs` files. There are
no subfolders/packages and no dotted import paths in v0.1. This keeps
the mental model dead simple for learners: "any file next to main.bs
can be imported by name." Nested folder-based packages (as originally
sketched) are explicitly deferred — see 6.6.

### 6.2 Import Syntax

BambooScript supports two import forms, modeled directly on Python's
import statement, using bare file names (no dots, no path segments):

```
import module_name
from module_name import function_name
from module_name import function_name, other_function
from module_name import function_name as alias
```

Usage inside code is Python-style dotted access when using plain
`import`, and direct name access when using `from ... import`:

```
import panda
panda.draw_panda(100, 100)

from panda import draw_panda
draw_panda(100, 100)
```

### 6.3 Folder Structure Convention

A BambooGrove project is a single flat folder: one entry-point file
(`main.bs` by default) plus any number of sibling `.bs` files, all in
the same folder. No subfolders are used for organizing importable code
in v0.1.

Example project structure:

```
my_project/
  main.bs         <- entry point, contains setup()/draw()
  panda.bs         <- defines draw_panda(), panda_walk()
  bamboo.bs         <- defines draw_stalk(), draw_leaf()
  colors.bs         <- defines project-specific color helpers
```

Import statements reference the sibling file by name only:

```
import panda
from bamboo import draw_stalk
from colors import forest_green
```

### 6.4 Resolution Rules

- Import names resolve to a `.bs` file with the same name in the same
  project folder as `main.bs`. There is no path traversal and no
  cross-folder lookup in v0.1 — every importable file must live
  alongside `main.bs`.
- The `.bs` extension is implied and must NOT be included in import
  statements (`import panda`, not `import panda.bs`).
- Two files cannot share the same name in a single project (the flat
  folder is effectively a flat namespace), so this is a non-issue by
  construction rather than something the resolver needs to
  disambiguate.
- Circular imports (A imports B, B imports A) should raise a clear
  compile-time error naming both files, rather than a cryptic runtime
  failure.
- Since execution is 100% client-side (Section 5.2), the module
  resolver reads files from the in-browser project file tree
  (IndexedDB-backed), not from any server or filesystem path.

### 6.5 Editor/IDE Implications

- BambooGrove's file browser (Section 5.1) can remain a flat file list
  for v0.1 — no folder-creation UI is required to support this
  simplified import model.
- The editor should offer "Go to definition" / autocomplete across
  files once a project has more than one `.bs` file — stretch goal,
  not MVP-blocking.
- New file actions in the sidebar can suggest starter file names (e.g.,
  "panda.bs") for new projects, to model the convention early for
  learners.

### 6.6 Deferred / Out of Scope for v0.1

- Subfolders as packages, dotted import paths (`shapes.panda`), and
  any `__init__`-equivalent marker file are explicitly OUT of scope
  for v0.1. If a project later needs to organize dozens of files,
  nested folder support can be revisited as a v2 module system change
  — but it should not be built now, since it adds resolver complexity
  the single-folder model doesn't need.
- Whether BambooGrove should ship a small set of built-in importable
  modules (e.g., a "panda" character module) as project starter files
  remains an open question for the platform team, separate from the
  import mechanism itself.

## 7. Open Questions / Decisions Needed

### 7.1 Naming/Scope

- [ ] Confirm final platform name: BambooGrove IDE (vs. BambooGrove Studio,
      BambooGrove Editor, etc.)
- [ ] Confirm domain availability for chosen name before public launch

### 7.2 Technical

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

### 7.3 Content/Teaching Integration

- [ ] Confirm relationship between BambooGrove platform and the YouTube
      series — will videos embed live BambooGrove sketches, or use
      screen-recorded sessions only?
- [ ] Define initial curriculum arc (first 10 videos = first 10 language
      concepts introduced, in order)

## 8. Next Steps

1. Finalize BambooScript v0.1 grammar (formal spec, not just examples)
2. Prototype the transpiler: BambooScript source -> JS -> canvas calls
3. Build minimal BambooGrove editor shell (code pane + canvas pane +
   Run button) as a standalone web page, before full platform/storage
   work
4. Validate the "teaching loop" — write and record one full example
   lesson (e.g., "draw a bamboo stalk using loops") end to end
5. Implement single-folder import resolution (Section 6) once
   single-file scripts are working end to end — the flat, no-
   subfolder model keeps this a small addition, not a prerequisite
   for the core execution pipeline
