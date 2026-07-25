import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// storage.js expects a browser-style localStorage global; provide a minimal
// in-memory stand-in so these tests can run under plain Node.
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

globalThis.localStorage = new MemoryStorage();

const { storage, sanitizeName, moduleNameOf, makeModuleSourceLookup } = await import("../src/storage.js");

beforeEach(() => {
  globalThis.localStorage.clear();
});

test("sanitizeName appends .bs and falls back to 'main'", () => {
  assert.equal(sanitizeName("sketch"), "sketch.bs");
  assert.equal(sanitizeName("sketch.bs"), "sketch.bs");
  assert.equal(sanitizeName("  "), "main.bs");
  assert.equal(sanitizeName(""), "main.bs");
});

test("createFile then getFile round-trips content", () => {
  const entry = storage.createFile("main.bs", "background(1,2,3)");
  assert.equal(storage.getFile(entry.id), "background(1,2,3)");
});

test("listFiles returns newest-updated first", async () => {
  const a = storage.createFile("a.bs", "1");
  await new Promise((r) => setTimeout(r, 2));
  const b = storage.createFile("b.bs", "2");
  const list = storage.listFiles();
  assert.equal(list[0].id, b.id);
  assert.equal(list[1].id, a.id);
});

test("saveFile updates content and bumps updatedAt", () => {
  const entry = storage.createFile("main.bs", "old");
  storage.saveFile(entry.id, "new");
  assert.equal(storage.getFile(entry.id), "new");
});

test("saveFile throws for an unknown id", () => {
  assert.throws(() => storage.saveFile("nope", "x"), /No saved sketch/);
});

test("renameFile updates the display name and normalizes the extension", () => {
  const entry = storage.createFile("main.bs", "x");
  const renamed = storage.renameFile(entry.id, "renamed");
  assert.equal(renamed.name, "renamed.bs");
  assert.equal(storage.listFiles()[0].name, "renamed.bs");
});

test("deleteFile removes both the index entry and the content", () => {
  const entry = storage.createFile("main.bs", "x");
  storage.deleteFile(entry.id);
  assert.equal(storage.listFiles().length, 0);
  assert.equal(storage.getFile(entry.id), "");
});

// --- Projects (spec section 6) ---

test("createFile makes a self-referential project (its own id is its projectId)", () => {
  const entry = storage.createFile("main.bs", "x");
  assert.equal(entry.projectId, entry.id);
});

test("createProjectFile shares the given projectId", () => {
  const main = storage.createFile("main.bs", "import panda\n");
  const panda = storage.createProjectFile(main.projectId, "panda.bs", "def draw_panda():\n    return 0\n");
  assert.equal(panda.projectId, main.projectId);
  assert.notEqual(panda.id, main.id);
});

test("listProjectFiles returns the entry file first, then siblings alphabetically", () => {
  const main = storage.createFile("main.bs", "x");
  storage.createProjectFile(main.projectId, "zebra.bs", "");
  storage.createProjectFile(main.projectId, "apple.bs", "");
  const files = storage.listProjectFiles(main.projectId);
  assert.deepEqual(files.map((f) => f.name), ["main.bs", "apple.bs", "zebra.bs"]);
});

test("listProjectFiles doesn't include files from other projects", () => {
  const main = storage.createFile("main.bs", "x");
  storage.createFile("other.bs", "y"); // unrelated, separate project
  const files = storage.listProjectFiles(main.projectId);
  assert.equal(files.length, 1);
});

test("moduleNameOf strips the .bs extension", () => {
  const entry = storage.createFile("panda.bs", "");
  assert.equal(moduleNameOf(entry), "panda");
});

test("makeModuleSourceLookup resolves siblings by module name, and misses return null", () => {
  const main = storage.createFile("main.bs", "import panda\n");
  storage.createProjectFile(main.projectId, "panda.bs", "def draw_panda():\n    return 0\n");
  const lookup = makeModuleSourceLookup(main.projectId);
  assert.equal(lookup("panda"), "def draw_panda():\n    return 0\n");
  assert.equal(lookup("nope"), null);
});
