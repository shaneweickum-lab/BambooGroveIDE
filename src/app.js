// Wires up the BambooGrove editor shell (spec section 5.1): code pane with
// line numbers + syntax highlighting, a tabbed output pane (Canvas /
// Terminal / Reference, spec 3.6), and file + multi-file-project management
// backed by src/storage.js.
import { Sketch } from "./sandbox.js";
import {
  storage, downloadFile, readUploadedFile, sanitizeName, makeModuleSourceLookup,
} from "./storage.js";

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
const projectFilesEl = document.getElementById("project-files");
const canvasEl = document.getElementById("canvas");
const errorEl = document.getElementById("error-console");
const fileUploadEl = document.getElementById("file-upload");

const terminalOutputEl = document.getElementById("terminal-output");
const terminalFormEl = document.getElementById("terminal-input-form");
const terminalPromptEl = document.getElementById("terminal-prompt");
const terminalInputEl = document.getElementById("terminal-input");

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
let currentProjectId = null;

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

// --- Output tabs (Canvas / Terminal / Reference, spec 3.6) ---

const outputTabs = document.querySelectorAll(".output-tab");
const tabPanels = document.querySelectorAll(".tab-panel");
let activeTab = "canvas";

function switchTab(tab) {
  activeTab = tab;
  outputTabs.forEach((btn) => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === tab);
  });
}

outputTabs.forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

// --- Terminal tab I/O ---

function resetTerminal() {
  terminalOutputEl.textContent = "";
  terminalFormEl.hidden = true;
  terminalPromptEl.textContent = "";
  terminalInputEl.value = "";
}

function appendTerminalLine(text, className) {
  const div = document.createElement("div");
  if (className) div.className = className;
  div.textContent = text;
  terminalOutputEl.appendChild(div);
  terminalOutputEl.scrollTop = terminalOutputEl.scrollHeight;
}

function showTerminalError(err) {
  const where = err.line ? `Line ${err.line}: ` : "";
  appendTerminalLine(`${where}${err.message}`, "line-error");
  terminalFormEl.hidden = true;
}

function requestTerminalInput(prompt, resolve) {
  terminalPromptEl.textContent = prompt;
  terminalInputEl.value = "";
  terminalFormEl.hidden = false;
  terminalInputEl.focus();
  terminalFormEl.onsubmit = (e) => {
    e.preventDefault();
    const value = terminalInputEl.value;
    appendTerminalLine(`${prompt}${value}`);
    terminalFormEl.hidden = true;
    resolve(value);
  };
}

// --- Syntax highlighting ---
// A lenient, display-only tokenizer. It never throws on incomplete or
// invalid syntax (unlike src/lexer.js, which is the real grammar used to
// actually run the program) since the user is mid-typing most of the time.

const KEYWORDS = new Set([
  "def", "return", "if", "elif", "else", "for", "in", "while",
  "and", "or", "not", "True", "False",
  "import", "from", "as",
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
  // Terminal tab (spec 3.6)
  "print", "input",
  // p5.js-compatible layer Phase 2 (spec 3.6)
  "bezier", "beginShape", "vertex", "endShape",
  "noise", "noiseDetail", "noiseSeed", "createVector",
  "int", "float", "str", "boolean",
  // Vector instance methods (called as v.add(...), etc.)
  "add", "sub", "mult", "div", "mag", "magSq", "normalize", "limit",
  "setMag", "heading", "rotate", "dist", "dot", "cross", "copy", "set",
  "array", "equals",
]);

const TOKEN_RE = /(#.*)|([fF]?"(?:[^"\\]|\\.)*"|[fF]?'(?:[^'\\]|\\.)*')|(\b\d+\.?\d*\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)/g;

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

// The project's entry-point source: if we're currently viewing the main
// file, use the editor's live content; if we're viewing a sibling, the
// main file's last-saved content (its own live edits are saved separately
// when its own chip is active — see runSketch()).
function getMainSource() {
  if (!currentProjectId) return codeEl.value;
  if (currentFileId === currentProjectId) return codeEl.value;
  return storage.getFile(currentProjectId);
}

function runSketch() {
  if (currentFileId) storage.saveFile(currentFileId, codeEl.value);
  clearError();
  resetTerminal();

  if (activeTab === "reference") switchTab("canvas");
  const mode = activeTab === "terminal" ? "terminal" : "canvas";
  const mainSource = getMainSource();
  const getModuleSource = currentProjectId ? makeModuleSourceLookup(currentProjectId) : () => null;

  if (mode === "terminal") {
    sketch.run(mainSource, {
      mode: "terminal",
      getModuleSource,
      onError: showTerminalError,
      onPrint: appendTerminalLine,
      onInputRequest: requestTerminalInput,
    });
  } else {
    sketch.run(mainSource, {
      mode: "canvas",
      getModuleSource,
      onError: showError,
      onPrint: appendTerminalLine,
    });
  }
}

btnRun.addEventListener("click", runSketch);
btnStop.addEventListener("click", () => sketch.stop());

// --- File management (spec section 5.2) + projects (spec section 6) ---

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

function renderProjectFiles() {
  projectFilesEl.innerHTML = "";
  if (!currentProjectId) {
    projectFilesEl.hidden = true;
    return;
  }
  const files = storage.listProjectFiles(currentProjectId);
  projectFilesEl.hidden = false;
  for (const f of files) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = f.id === currentFileId ? "chip active" : "chip";
    chip.textContent = f.name;
    chip.title = f.id === currentProjectId ? `${f.name} (entry point)` : f.name;
    chip.addEventListener("click", () => switchProjectFile(f.id));
    projectFilesEl.appendChild(chip);
  }
  const addChip = document.createElement("button");
  addChip.type = "button";
  addChip.className = "chip chip-add";
  addChip.textContent = "+";
  addChip.title = "Add a new file to this project";
  addChip.addEventListener("click", addProjectFile);
  projectFilesEl.appendChild(addChip);
}

function switchProjectFile(id) {
  if (id === currentFileId) return;
  if (currentFileId) storage.saveFile(currentFileId, codeEl.value);
  const entry = storage.listProjectFiles(currentProjectId).find((f) => f.id === id);
  if (!entry) return;
  currentFileId = id;
  filenameEl.value = entry.name;
  codeEl.value = storage.getFile(id);
  refreshEditorChrome();
  renderProjectFiles();
  renderFileList();
  setStatus(`Switched to ${entry.name}.`);
}

function addProjectFile() {
  if (currentFileId) storage.saveFile(currentFileId, codeEl.value);
  const existingNames = new Set(storage.listProjectFiles(currentProjectId).map((f) => f.name.toLowerCase()));
  let n = 1;
  let name = "module.bs";
  while (existingNames.has(name.toLowerCase())) {
    n += 1;
    name = `module${n}.bs`;
  }
  const moduleName = name.replace(/\.bs$/i, "");
  const starter = `# A new file in this project. Define functions here, then use them\n# from another file with 'import ${moduleName}' or\n# 'from ${moduleName} import example'.\n\ndef example():\n    return 0\n`;
  const entry = storage.createProjectFile(currentProjectId, name, starter);
  currentFileId = entry.id;
  filenameEl.value = entry.name;
  codeEl.value = storage.getFile(entry.id);
  refreshEditorChrome();
  renderProjectFiles();
  renderFileList();
  setStatus(`Created ${entry.name}.`);
}

function openFile(id) {
  const entry = storage.listFiles().find((f) => f.id === id);
  if (!entry) return;
  sketch.stop();
  clearError();
  currentFileId = id;
  currentProjectId = entry.projectId;
  filenameEl.value = entry.name;
  codeEl.value = storage.getFile(id);
  refreshEditorChrome();
  renderFileList();
  renderProjectFiles();
  setStatus(`Opened ${entry.name}.`);
}

function newFile() {
  sketch.stop();
  clearError();
  currentFileId = null;
  currentProjectId = null;
  filenameEl.value = "main.bs";
  codeEl.value = DEFAULT_SOURCE;
  refreshEditorChrome();
  renderFileList();
  renderProjectFiles();
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
    const entry = storage.createFile(name, codeEl.value);
    currentFileId = entry.id;
    currentProjectId = entry.projectId;
  }
  renderFileList();
  renderProjectFiles();
  setStatus(`Saved ${name}.`);
}

function saveAs() {
  const name = sanitizeName(filenameEl.value);
  filenameEl.value = name;
  const entry = storage.createFile(name, codeEl.value);
  currentFileId = entry.id;
  currentProjectId = entry.projectId;
  renderFileList();
  renderProjectFiles();
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
  renderProjectFiles();
  setStatus(`Renamed to ${entry.name}.`);
}

function deleteCurrent() {
  if (!currentFileId) {
    setStatus("Nothing to delete — this sketch isn't saved yet.");
    return;
  }
  const name = filenameEl.value;
  const isMainFile = currentFileId === currentProjectId;
  const siblings = isMainFile ? storage.listProjectFiles(currentProjectId).filter((f) => f.id !== currentProjectId) : [];
  const confirmMsg = siblings.length
    ? `Delete "${name}" and its ${siblings.length} other project file(s)? This can't be undone.`
    : `Delete "${name}"? This can't be undone.`;
  if (!window.confirm(confirmMsg)) return;
  for (const sibling of siblings) storage.deleteFile(sibling.id);
  storage.deleteFile(currentFileId);
  currentFileId = null;
  currentProjectId = null;
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
  currentProjectId = null;
  filenameEl.value = sanitizeName(file.name);
  codeEl.value = text;
  refreshEditorChrome();
  renderFileList();
  renderProjectFiles();
  setStatus(`Loaded ${file.name} from disk. Save to keep it in your sketch list.`);
});

// --- Init ---

codeEl.value = DEFAULT_SOURCE;
refreshEditorChrome();
renderFileList();
renderProjectFiles();
setStatus("Ready. Press Run or Ctrl/Cmd+Enter.");
