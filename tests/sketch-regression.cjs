const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadSketchApi() {
  const source = fs.readFileSync(path.join(root, "sketch.js"), "utf8");
  let nextId = 0;
  const window = {
    crypto: { randomUUID: () => `generated-${++nextId}` },
    setTimeout,
    clearTimeout,
  };
  const context = {
    window,
    globalThis: window,
    console,
    Date,
    Math,
    JSON,
    Map,
    Set,
    Uint8Array,
    Uint32Array,
    Number,
    String,
    RegExp,
    Object,
    Array,
    Promise,
    TextEncoder,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, context, { filename: "sketch.js" });
  assert.ok(window.MomentumSketch, "MomentumSketch was not exposed");
  return window.MomentumSketch;
}

function fakeIndexedDB() {
  const records = new Map();
  let storeCreated = false;

  const compoundKey = (key) => JSON.stringify(key);
  const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

  class Transaction {
    constructor() {
      this.pending = 0;
      this.oncomplete = null;
      this.onerror = null;
      this.onabort = null;
      this.error = null;
      this.completionScheduled = false;
    }

    request(operation) {
      this.pending += 1;
      const request = { result: undefined, error: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        try {
          request.result = operation();
          request.onsuccess?.();
        } catch (error) {
          request.error = error;
          this.error = error;
          request.onerror?.();
          this.onerror?.();
        } finally {
          this.pending -= 1;
          this.scheduleCompletion();
        }
      });
      return request;
    }

    scheduleCompletion() {
      if (this.pending || this.completionScheduled) return;
      this.completionScheduled = true;
      setTimeout(() => this.oncomplete?.(), 0);
    }

    objectStore() {
      const transaction = this;
      const index = {
        getAll(userId) {
          return transaction.request(() => [...records.values()].filter((record) => record.userId === userId).map(copy));
        },
        openCursor(userId) {
          transaction.pending += 1;
          const request = { result: undefined, error: null, onsuccess: null, onerror: null };
          const keys = [...records.entries()].filter(([, record]) => record.userId === userId).map(([key]) => key);
          let offset = 0;
          const emit = () => queueMicrotask(() => {
            if (offset >= keys.length) {
              request.result = null;
              request.onsuccess?.();
              transaction.pending -= 1;
              transaction.scheduleCompletion();
              return;
            }
            const key = keys[offset++];
            request.result = {
              value: copy(records.get(key)),
              delete() { records.delete(key); },
              continue: emit,
            };
            request.onsuccess?.();
          });
          emit();
          return request;
        },
      };
      return {
        createIndex() {},
        index() { return index; },
        put(record) {
          return transaction.request(() => {
            records.set(compoundKey([record.userId, record.id]), copy(record));
            return [record.userId, record.id];
          });
        },
        get(key) { return transaction.request(() => copy(records.get(compoundKey(key)))); },
        delete(key) { return transaction.request(() => records.delete(compoundKey(key))); },
      };
    }
  }

  const database = {
    objectStoreNames: { contains: () => storeCreated },
    createObjectStore() {
      storeCreated = true;
      return { createIndex() {} };
    },
    transaction() { return new Transaction(); },
    close() {},
    onversionchange: null,
  };

  return {
    open() {
      const request = { result: database, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      queueMicrotask(() => {
        if (!storeCreated) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

function testDocumentNormalization(api) {
  const excessivePoints = [];
  for (let index = 0; index < api.limits.pointsPerStroke + 300; index += 1) {
    excessivePoints.push(index, -index, 9, -5);
  }
  const source = {
    schemaVersion: 999,
    id: "bad id with spaces",
    title: `  Plan\u0000 ${"x".repeat(200)}  `,
    description: `Zeile 1\r\nZeile 2\u0001`,
    documentDate: "2026-02-31",
    createdAt: -5,
    updatedAt: Infinity,
    cloudVersion: 7,
    lastSyncedUpdatedAt: Date.now() - 1000,
    canvas: { width: 999999, height: -1, background: "url(javascript:evil)" },
    elements: [
      {
        id: "same-id",
        type: "stroke",
        tool: "marker",
        color: "red<script>",
        width: 999,
        opacity: -1,
        points: excessivePoints,
      },
      {
        id: "same-id",
        type: "text",
        x: Infinity,
        y: 99999,
        width: 99999,
        fontSize: 999,
        text: `Hallo\u0000\n${"T".repeat(2500)}`,
        align: "evil",
      },
      { id: "unknown", type: "image", src: "https://evil.example" },
    ],
    injected: "must disappear",
  };

  const normalized = api.normalizeDocument(source);
  assert.equal(normalized.schemaVersion, 1);
  assert.match(normalized.id, /^[A-Za-z0-9_-]+$/);
  assert.equal(normalized.title.length, api.limits.title);
  assert.equal(normalized.description, "Zeile 1\nZeile 2");
  assert.notEqual(normalized.documentDate, "2026-02-31");
  assert.deepEqual({ ...normalized.canvas }, { width: 2048, height: 1536, background: "#ffffff" });
  assert.equal(normalized.injected, undefined);
  assert.equal(normalized.cloudVersion, 7);
  assert.ok(normalized.lastSyncedUpdatedAt > 0);
  assert.equal(normalized.elements.length, 2);
  assert.notEqual(normalized.elements[0].id, normalized.elements[1].id);
  assert.equal(normalized.elements[0].points.length / 4, api.limits.pointsPerStroke);
  assert.equal(normalized.elements[0].width, 100);
  assert.equal(normalized.elements[0].opacity, 0.05);
  assert.equal(normalized.elements[0].color, "#f5c542");
  assert.ok(normalized.elements[0].points.every(Number.isFinite));
  assert.equal(normalized.elements[1].text.length, api.limits.text);
  assert.equal(normalized.elements[1].align, "left");
  assert.ok(normalized.elements[1].x + normalized.elements[1].width <= api.world.width);
  assert.ok(normalized.elements[1].y + normalized.elements[1].height <= api.world.height);
  assert.ok(api.estimatedBytes(normalized) <= api.limits.documentBytes);

  const roundTrip = api.normalizeDocument(normalized);
  assert.equal(JSON.stringify(roundTrip.elements), JSON.stringify(normalized.elements));
}

function testGeometryAndHistory(api) {
  assert.equal(api.pointDistanceToSegment(5, 3, 0, 0, 10, 0), 3);
  const points = [];
  for (let index = 0; index <= 100; index += 1) points.push(index, index * 0.01, 0.5, index);
  const simplified = api.simplifyStrokePoints(points, 0.5);
  assert.ok(simplified.length < points.length);
  assert.deepEqual(Array.from(simplified.slice(0, 4)), Array.from(points.slice(0, 4)));
  assert.deepEqual(Array.from(simplified.slice(-4)), Array.from(points.slice(-4)));

  const elements = [];
  let changes = 0;
  const history = api._test.makeHistory(() => elements, () => { changes += 1; }, 10);
  const first = { id: "a", type: "text", x: 1, y: 2, width: 100, height: 30, text: "A" };
  elements.push(first);
  history.push({ type: "add", element: first, index: 0 });
  assert.equal(history.undo(), true);
  assert.equal(elements.length, 0);
  assert.equal(history.redo(), true);
  assert.equal(elements[0].id, "a");

  const after = { ...first, x: 50 };
  elements.splice(0, 1, after);
  history.push({ type: "update", before: first, after });
  history.undo();
  assert.equal(elements[0].x, 1);
  history.redo();
  assert.equal(elements[0].x, 50);

  elements.splice(0, 1);
  history.push({ type: "delete", items: [{ element: after, index: 0 }] });
  history.undo();
  assert.equal(elements[0].id, "a");
  history.redo();
  assert.equal(elements.length, 0);
  assert.equal(changes, 6);
}

async function testIndexedDbIsolation(api) {
  const store = api.createStore({ indexedDB: fakeIndexedDB(), databaseName: "test-sketches" });
  const aliceFirst = api.createDocument({ id: "alice-1", title: "Erste", documentDate: "2026-07-18" });
  aliceFirst.updatedAt = Date.now() + 100;
  const aliceSecond = api.createDocument({ id: "alice-2", title: "Zweite", documentDate: "2026-07-19" });
  aliceSecond.updatedAt = Date.now() + 200;
  const bob = api.createDocument({ id: "bob-1", title: "Privat" });

  await store.put("alice-user", aliceFirst);
  await store.put("alice-user", aliceSecond);
  await store.put("bob-user", bob);

  const alice = await store.list("alice-user");
  assert.deepEqual(alice.map((document) => document.id), ["alice-2", "alice-1"]);
  assert.equal((await store.get("alice-user", "alice-1")).title, "Erste");
  assert.equal(await store.get("bob-user", "alice-1"), null);

  const tombstone = await store.markDeleted("alice-user", "alice-1");
  assert.equal(tombstone.deletedAt > 0, true);
  assert.equal(tombstone.updatedAt, tombstone.deletedAt);
  assert.equal((await store.get("alice-user", "alice-1")).deletedAt, tombstone.deletedAt);
  assert.equal(await store.delete("alice-user", "alice-1"), true);
  assert.equal(await store.purge("alice-user"), 1);
  assert.equal((await store.list("alice-user")).length, 0);
  assert.equal((await store.list("bob-user")).length, 1);
  await store.close();
}

async function main() {
  const api = loadSketchApi();
  testDocumentNormalization(api);
  testGeometryAndHistory(api);
  await testIndexedDbIsolation(api);
  console.log("Sketch regression tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
