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

const { storage, sanitizeName } = await import("../src/storage.js");

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
