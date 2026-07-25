// Wires up the BambooGrove editor shell (spec section 5.1): code pane with
// line numbers + syntax highlighting, canvas pane, run/stop, and file
// management backed by src/storage.js.
import { Sketch } from "./sandbox.js";
import { storage, downloadFile, readUploadedFile, sanitizeName } from "./storage.js";

const DEFAULT_SOURCE = `def setup():
    background(255, 255, 255)

def draw():
    stroke(34, 139, 34)
    for i in range(8):
        forward(100)
        turn(45)
`;

const codeEl = document.getElementById("code");
const gutterEl = document.getElementById("gutter");
const highlightCodeEl = document.getElementById("highlight-code");
const highlightEl = document.getElementById("highlight");
const filenameEl = document.getElementById("filename");
const statusEl = document.getElementById("status");
const fileListEl = document.getElementById("file-list");
const canvasEl = document.getElementById("canvas");
const errorEl = document.getElementById("error-console");
const fileUploadEl = document.getElementById("file-upload");

const btnNew = document.getElementById("btn-new");
const btnSave = document.getElementById("btn-save");
const btnSaveAs = document.getElementById("btn-save-as");
const btnOpen = document.getElementById("btn-open");
const btnRename = document.getElementById("btn-rename");
const btnDelete = document.getElementById("btn-delete");
const btnRun = document.getElementById("btn-run");
const btnStop = document.getElementById("btn-stop");

const sketch = new Sketch(canvasEl);
let currentFileId = null;

function setStatus(msg) {
  statusEl.textContent = msg;
}

function showError(err) {
  errorEl.hidden = false;
  const where = err.line ? `Line ${err.line}: ` : "";
  errorEl.textContent = `${where}${err.message}`;
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

// --- Syntax highlighting ---
// A lenient, display-only tokenizer. It never throws on incomplete or
// invalid syntax (unlike src/lexer.js, which is the real grammar used to
// actually run the program) since the user is mid-typing most of the time.

const KEYWORDS = new Set([
  "def", "return", "if", "elif", "else", "for", "in", "while",
  "and", "or", "not", "True", "False",
]);

const BUILTINS = new Set([
  // Original snake_case stdlib (spec 3.3)
  "background", "stroke", "fill", "no_fill", "no_stroke", "line", "rect",
  "circle", "point", "text", "forward", "turn", "right", "left", "pen_up",
  "pen_down", "go_to", "home", "mouse_x", "mouse_y", "is_pressed",
  "key_pressed", "frame_count", "no_loop", "loop", "range",
  // p5.js-compatible layer (spec 3.6)
  "arc", "ellipse", "quad", "square", "triangle", "ellipseMode", "rectMode",
  "strokeWeight", "strokeCap", "strokeJoin", "noSmooth", "smooth",
  "noFill", "noStroke", "clear", "colorMode", "blendMode",
  "color", "red", "green", "blue", "alpha", "lerpColor",
  "push", "pop", "translate", "rotate", "scale", "resetMatrix",
  "frameRate", "cursor", "noCursor", "frameCount",
  "mouseX", "mouseY", "pmouseX", "pmouseY", "mouseIsPressed", "keyIsPressed", "key",
  "width", "height", "windowWidth", "windowHeight",
  "abs", "ceil", "floor", "round", "constrain", "dist", "lerp", "map",
  "max", "min", "pow", "sq", "sqrt", "sin", "cos", "tan", "radians",
  "degrees", "random", "randomSeed",
  "noLoop", "redraw", "isLooping",
  "keyPressed", "keyReleased", "mousePressed", "mouseReleased",
  "mouseDragged", "mouseMoved", "mouseClicked",
  "createCanvas", "resizeCanvas",
  "textSize", "textAlign", "textFont",
  "PI", "TWO_PI", "HALF_PI", "QUARTER_PI", "DEGREES", "RADIANS",
]);

const TOKEN_RE = /(#.*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+\.?\d*\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)/g;

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlight(source) {
  let out = "";
  let last = 0;
  for (const m of source.matchAll(TOKEN_RE)) {
    out += escapeHtml(source.slice(last, m.index));
    const [full, comment, str, num, name] = m;
    if (comment) out += `<span class="tok-comment">${escapeHtml(full)}</span>`;
    else if (str) out += `<span class="tok-string">${escapeHtml(full)}</span>`;
    else if (num) out += `<span class="tok-number">${escapeHtml(full)}</span>`;
    else if (name && KEYWORDS.has(name)) out += `<span class="tok-keyword">${escapeHtml(full)}</span>`;
    else if (name && BUILTINS.has(name)) out += `<span class="tok-builtin">${escapeHtml(full)}</span>`;
    else out += escapeHtml(full);
    last = m.index + full.length;
  }
  out += escapeHtml(source.slice(last));
  return out;
}

function renderGutter(source) {
  const lineCount = source.split("\n").length;
  const lines = [];
  for (let i = 1; i <= lineCount; i++) lines.push(i);
  gutterEl.textContent = lines.join("\n");
}

function renderHighlight(source) {
  // Trailing newline keeps the overlay's height in sync with the textarea.
  highlightCodeEl.innerHTML = highlight(source) + "\n";
}

function refreshEditorChrome() {
  renderGutter(codeEl.value);
  renderHighlight(codeEl.value);
}

function insertTextAtCursor(text) {
  const start = codeEl.selectionStart;
  const end = codeEl.selectionEnd;
  codeEl.value = codeEl.value.slice(0, start) + text + codeEl.value.slice(end);
  codeEl.selectionStart = codeEl.selectionEnd = start + text.length;
}

function dedentSelection() {
  const value = codeEl.value;
  const pos = codeEl.selectionStart;
  const lineStart = value.lastIndexOf("\n", pos - 1) + 1;
  const match = /^ {1,4}/.exec(value.slice(lineStart, lineStart + 4));
  const removeCount = match ? match[0].length : 0;
  if (removeCount === 0) return;
  codeEl.value = value.slice(0, lineStart) + value.slice(lineStart + removeCount);
  codeEl.selectionStart = codeEl.selectionEnd = Math.max(lineStart, pos - removeCount);
}

codeEl.addEventListener("input", refreshEditorChrome);
codeEl.addEventListener("scroll", () => {
  gutterEl.scrollTop = codeEl.scrollTop;
  highlightEl.scrollTop = codeEl.scrollTop;
  highlightEl.scrollLeft = codeEl.scrollLeft;
});

codeEl.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;

  if (mod && e.key === "Enter") {
    e.preventDefault();
    runSketch();
    return;
  }
  if (mod && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveCurrent();
    return;
  }
  if (e.key === "Tab") {
    e.preventDefault();
    if (e.shiftKey) dedentSelection();
    else insertTextAtCursor("    ");
    refreshEditorChrome();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    const value = codeEl.value;
    const pos = codeEl.selectionStart;
    const lineStart = value.lastIndexOf("\n", pos - 1) + 1;
    const currentLine = value.slice(lineStart, pos);
    const indentMatch = /^[ \t]*/.exec(currentLine);
    let indent = indentMatch ? indentMatch[0] : "";
    if (/:\s*$/.test(currentLine.trimEnd())) indent += "    ";
    insertTextAtCursor(`\n${indent}`);
    refreshEditorChrome();
  }
});

// --- Run / stop ---

function runSketch() {
  clearError();
  sketch.run(codeEl.value, { onError: showError });
}

btnRun.addEventListener("click", runSketch);
btnStop.addEventListener("click", () => sketch.stop());

// --- File management (spec section 5.2) ---

function renderFileList() {
  const files = storage.listFiles();
  fileListEl.innerHTML = "";
  if (files.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No saved sketches yet.";
    fileListEl.appendChild(li);
    return;
  }
  for (const f of files) {
    const li = document.createElement("li");
    li.textContent = f.name;
    if (f.id === currentFileId) li.classList.add("active");
    li.addEventListener("click", () => openFile(f.id));
    fileListEl.appendChild(li);
  }
}

function openFile(id) {
  const entry = storage.listFiles().find((f) => f.id === id);
  if (!entry) return;
  sketch.stop();
  clearError();
  currentFileId = id;
  filenameEl.value = entry.name;
  codeEl.value = storage.getFile(id);
  refreshEditorChrome();
  renderFileList();
  setStatus(`Opened ${entry.name}.`);
}

function newFile() {
  sketch.stop();
  clearError();
  currentFileId = null;
  filenameEl.value = "main.bs";
  codeEl.value = DEFAULT_SOURCE;
  refreshEditorChrome();
  renderFileList();
  setStatus("New sketch.");
}

function saveCurrent() {
  const name = sanitizeName(filenameEl.value);
  filenameEl.value = name;
  if (currentFileId) {
    storage.saveFile(currentFileId, codeEl.value);
    const entry = storage.listFiles().find((f) => f.id === currentFileId);
    if (entry && entry.name !== name) storage.renameFile(currentFileId, name);
  } else {
    currentFileId = storage.createFile(name, codeEl.value).id;
  }
  renderFileList();
  setStatus(`Saved ${name}.`);
}

function saveAs() {
  const name = sanitizeName(filenameEl.value);
  filenameEl.value = name;
  currentFileId = storage.createFile(name, codeEl.value).id;
  renderFileList();
  downloadFile(name, codeEl.value);
  setStatus(`Saved a copy as ${name} and downloaded it.`);
}

function renameCurrent() {
  if (!currentFileId) {
    setStatus("Save this sketch first, then you can rename it.");
    return;
  }
  const entry = storage.renameFile(currentFileId, filenameEl.value);
  filenameEl.value = entry.name;
  renderFileList();
  setStatus(`Renamed to ${entry.name}.`);
}

function deleteCurrent() {
  if (!currentFileId) {
    setStatus("Nothing to delete — this sketch isn't saved yet.");
    return;
  }
  const name = filenameEl.value;
  if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
  storage.deleteFile(currentFileId);
  currentFileId = null;
  newFile();
  setStatus(`Deleted ${name}.`);
}

btnNew.addEventListener("click", newFile);
btnSave.addEventListener("click", saveCurrent);
btnSaveAs.addEventListener("click", saveAs);
btnRename.addEventListener("click", renameCurrent);
btnDelete.addEventListener("click", deleteCurrent);

btnOpen.addEventListener("click", () => fileUploadEl.click());
fileUploadEl.addEventListener("change", async () => {
  const file = fileUploadEl.files[0];
  fileUploadEl.value = "";
  if (!file) return;
  const text = await readUploadedFile(file);
  sketch.stop();
  clearError();
  currentFileId = null;
  filenameEl.value = sanitizeName(file.name);
  codeEl.value = text;
  refreshEditorChrome();
  renderFileList();
  setStatus(`Loaded ${file.name} from disk. Save to keep it in your sketch list.`);
});

// --- Init ---

codeEl.value = DEFAULT_SOURCE;
refreshEditorChrome();
renderFileList();
setStatus("Ready. Press Run or Ctrl/Cmd+Enter.");
