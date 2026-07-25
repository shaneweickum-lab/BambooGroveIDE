// Client-side-only file management (spec section 5.2): sketches persist in
// localStorage, keyed through a small index. There is no backend in v0.1 —
// Save As / Open cover cross-device use via file download/upload instead.
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
    const entry = { id: makeId(), name: sanitizeName(name), updatedAt: Date.now() };
    index.push(entry);
    saveIndex(index);
    localStorage.setItem(fileKey(entry.id), content);
    return entry;
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
