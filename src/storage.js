// Client-side-only file management (spec section 5.2): sketches persist in
// localStorage, keyed through a small index. There is no backend in v0.1 —
// Save As / Open cover cross-device use via file download/upload instead.
//
// A "project" (spec section 6.3) is a flat group of files sharing the same
// `projectId` — the entry file's own `id` doubles as its project's id, so
// "is this the project's main file?" is just `entry.id === entry.projectId`,
// with no extra flag to keep in sync.
const INDEX_KEY = "bamboogrove:index";
const fileKey = (id) => `bamboogrove:file:${id}`;

function loadIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveIndex(index) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

function makeId() {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function sanitizeName(name) {
  let n = (name || "").trim();
  if (!n) n = "main";
  if (!n.toLowerCase().endsWith(".bs")) n += ".bs";
  return n;
}

// The name an `import`/`from ... import` statement would use to refer to
// this file: its filename without the .bs extension.
export function moduleNameOf(entry) {
  return entry.name.replace(/\.bs$/i, "");
}

export const storage = {
  listFiles() {
    return loadIndex().sort((a, b) => b.updatedAt - a.updatedAt);
  },

  getFile(id) {
    const raw = localStorage.getItem(fileKey(id));
    return raw !== null ? raw : "";
  },

  createFile(name = "main.bs", content = "") {
    const index = loadIndex();
    const id = makeId();
    const entry = { id, name: sanitizeName(name), updatedAt: Date.now(), projectId: id };
    index.push(entry);
    saveIndex(index);
    localStorage.setItem(fileKey(entry.id), content);
    return entry;
  },

  // A new sibling module file within an existing project (spec section 6):
  // importable by name from any file that shares this projectId.
  createProjectFile(projectId, name, content = "") {
    const index = loadIndex();
    const entry = { id: makeId(), name: sanitizeName(name), updatedAt: Date.now(), projectId };
    index.push(entry);
    saveIndex(index);
    localStorage.setItem(fileKey(entry.id), content);
    return entry;
  },

  // Every file sharing a project, entry file first, then siblings
  // alphabetically — spec section 6.3's "flat folder" of main.bs + siblings.
  listProjectFiles(projectId) {
    const files = loadIndex().filter((f) => f.projectId === projectId);
    files.sort((a, b) => {
      if (a.id === projectId) return -1;
      if (b.id === projectId) return 1;
      return a.name.localeCompare(b.name);
    });
    return files;
  },

  saveFile(id, content) {
    const index = loadIndex();
    const entry = index.find((f) => f.id === id);
    if (!entry) throw new Error(`No saved sketch with id '${id}'.`);
    entry.updatedAt = Date.now();
    saveIndex(index);
    localStorage.setItem(fileKey(id), content);
  },

  renameFile(id, newName) {
    const index = loadIndex();
    const entry = index.find((f) => f.id === id);
    if (!entry) throw new Error(`No saved sketch with id '${id}'.`);
    entry.name = sanitizeName(newName);
    entry.updatedAt = Date.now();
    saveIndex(index);
    return entry;
  },

  deleteFile(id) {
    saveIndex(loadIndex().filter((f) => f.id !== id));
    localStorage.removeItem(fileKey(id));
  },
};

// Builds a `getModuleSource(name)` lookup (see src/modules.js) backed by
// every file in the given project.
export function makeModuleSourceLookup(projectId) {
  const files = storage.listProjectFiles(projectId);
  return (name) => {
    const match = files.find((f) => moduleNameOf(f) === name);
    return match ? storage.getFile(match.id) : null;
  };
}

export function downloadFile(name, content) {
  const blob = new Blob([content], { type: "text/x-bamboo-script" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = sanitizeName(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function readUploadedFile(file) {
  return file.text();
}
