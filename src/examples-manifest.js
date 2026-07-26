// Metadata for the in-app "Examples" picker (src/app.js). This is
// deliberately metadata-only — the actual .bs source stays in examples/*.bs
// and is fetched on demand at load time, so examples/*.bs remains the one
// place that content lives (both for browsing on GitHub and for loading
// into the IDE itself), instead of duplicating source into this file.
export const EXAMPLES = [
  {
    id: "hexagon",
    title: "Hexagon",
    description: "Turtle graphics: a for-loop draws a hexagon.",
    mode: "canvas",
    files: [{ name: "main.bs", path: "examples/hexagon.bs" }],
  },
  {
    id: "octagon",
    title: "Octagon",
    description: "Turtle graphics: a for-loop draws an octagon.",
    mode: "canvas",
    files: [{ name: "main.bs", path: "examples/octagon.bs" }],
  },
  {
    id: "square",
    title: "Square (while loop)",
    description: "The same turtle movement, using a while loop instead of range().",
    mode: "canvas",
    files: [{ name: "main.bs", path: "examples/square.bs" }],
  },
  {
    id: "bamboo_stalk",
    title: "Bamboo stalk",
    description: "The spec's own loops lesson: draw a bamboo stalk with a while loop.",
    mode: "canvas",
    files: [{ name: "main.bs", path: "examples/bamboo_stalk.bs" }],
  },
  {
    id: "p5_style_orbit",
    title: "p5.js-style orbit",
    description: "push()/translate()/rotate() plus a mousePressed() event callback.",
    mode: "canvas",
    files: [{ name: "main.bs", path: "examples/p5_style_orbit.bs" }],
  },
  {
    id: "terminal_quiz",
    title: "Terminal quiz",
    description: "Plain print()/input() scripting in the Terminal tab.",
    mode: "terminal",
    files: [{ name: "main.bs", path: "examples/terminal_quiz.bs" }],
  },
  {
    id: "terminal_string_lab",
    title: "String lab (Python-compatible)",
    description: "upper()/split()/title()/join()/... - copy-paste this into real Python and it runs the same.",
    mode: "terminal",
    files: [{ name: "main.bs", path: "examples/terminal_string_lab.bs" }],
  },
  {
    id: "terminal_calculator",
    title: "Terminal calculator",
    description: "input() plus the float()/str() data-conversion builtins.",
    mode: "terminal",
    files: [{ name: "main.bs", path: "examples/terminal_calculator.bs" }],
  },
  {
    id: "modules_demo",
    title: "Modules: panda drawing",
    description: "A two-file project using import / from ... import.",
    mode: "canvas",
    files: [
      { name: "main.bs", path: "examples/modules_main.bs" },
      { name: "panda.bs", path: "examples/modules_panda.bs" },
    ],
  },
  {
    id: "phase2_demo",
    title: "Vectors, noise & custom shapes",
    description: "createVector(), noise(), bezier(), and beginShape()/vertex()/endShape().",
    mode: "canvas",
    files: [{ name: "main.bs", path: "examples/phase2_demo.bs" }],
  },
  {
    id: "hsb_rainbow",
    title: "HSB rainbow ring",
    description: "colorMode(\"hsb\") spinning a rainbow of circles.",
    mode: "canvas",
    files: [{ name: "main.bs", path: "examples/hsb_rainbow.bs" }],
  },
  {
    id: "smart_missiles",
    title: "Smart missiles (genetic algorithm)",
    description: "A population of rockets evolves — selection, crossover, mutation — to hit a target past a wall.",
    mode: "canvas",
    files: [
      { name: "main.bs", path: "examples/smart_missiles/main.bs" },
      { name: "rocket.bs", path: "examples/smart_missiles/rocket.bs" },
    ],
  },
  {
    id: "stdlib_string_demo",
    title: "Python's string module",
    description: "import string - ascii_letters/digits/punctuation, matching CPython's own values.",
    mode: "terminal",
    files: [{ name: "main.bs", path: "examples/stdlib_string_demo.bs" }],
  },
];
