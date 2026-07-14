const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function appSecurityApi() {
  const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const instrumented = source.replace(
    /  \/\/ Robust starten[\s\S]*?\}\)\(\);\s*$/,
    "  window.__securityTest = { normalizeState, stateHasDuplicateHabits, escapeHtml, purgePrivateBrowserData };\n})();"
  );
  assert.notEqual(instrumented, source, "app.js test hook could not be injected");

  const values = new Map([
    ["momentum_v1", "legacy"],
    ["momentum_legacy_owner", "user-1"],
    ["momentum_v1_user_user-1", "private"],
    ["momentum_cloud_session", "session"],
    ["unrelated", "keep"],
  ]);
  const localStorage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  const deletedCaches = [];
  const deletedRequests = [];
  const currentRequests = [
    { url: "http://127.0.0.1:8124/app.js?v=24" },
    { url: "https://uytacdogqercenlgbpgb.supabase.co/rest/v1/user_states" },
  ];
  const caches = {
    async keys() { return ["momentum-v22", "momentum-v23", "momentum-v24", "another-app-v1"]; },
    async delete(name) { deletedCaches.push(name); return true; },
    async open(name) {
      assert.equal(name, "momentum-v24");
      return {
        async keys() { return currentRequests; },
        async delete(request) { deletedRequests.push(request.url); return true; },
      };
    },
  };
  const window = { caches };
  const context = {
    window,
    localStorage,
    caches,
    location: { origin: "http://127.0.0.1:8124" },
    console,
    Date,
    Math,
    JSON,
    Map,
    Set,
    Object,
    Array,
    String,
    Number,
    RegExp,
    URL,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(instrumented, context, { filename: "app.js" });
  return { api: window.__securityTest, values, deletedCaches, deletedRequests };
}

async function testStateSanitizingAndLogoutPurge() {
  const { api, values, deletedCaches, deletedRequests } = appSecurityApi();
  const firstHabitId = "bad\" onmouseover=\"alert(1)";
  const duplicateHabitId = "duplicate-habit";
  const malicious = {
    meta: { updatedAt: Date.now(), unexpected: "drop" },
    settings: { startDate: "2026-07-01", theme: "<img>" },
    habits: [{
      id: firstHabitId,
      emoji: "<img src=x onerror=alert(1)>",
      name: "<script>steal()</script>",
      type: "weekly",
      target: 999,
    }, {
      id: duplicateHabitId,
      emoji: "<img src=x onerror=alert(1)>",
      name: "<script>steal()</script>",
      type: "weekly",
      target: 999,
    }],
    log: {
      "2026-07-01": { [firstHabitId]: true },
      "2026-07-02": { [duplicateHabitId]: true },
      "not-a-date": { bad: true },
    },
    taskSections: [{ id: "section\" onclick=\"steal()", name: "<b>Privat</b>" }],
    tasks: {},
    archivedTasks: [],
    events: [{ id: "event\" onload=\"steal()", title: "Test", date: "invalid" }],
    health: { goals: { calories: -1 }, entries: {} },
    injected: "drop me",
  };

  assert.equal(api.stateHasDuplicateHabits(malicious), true);
  const normalized = api.normalizeState(malicious);
  assert.equal(api.stateHasDuplicateHabits(normalized), false);
  assert.equal(normalized.habits.length, 1);
  assert.match(normalized.habits[0].id, /^[A-Za-z0-9_-]{1,80}$/);
  assert.equal(normalized.habits[0].target, 7);
  assert.equal(normalized.settings.theme, "light");
  assert.equal(normalized.events.length, 0);
  assert.equal(normalized.injected, undefined);
  assert.equal(normalized.meta.unexpected, undefined);
  assert.equal(api.escapeHtml(normalized.habits[0].emoji).includes("<img"), false);
  assert.equal(normalized.log["2026-07-01"][normalized.habits[0].id], true);
  assert.equal(normalized.log["2026-07-02"][normalized.habits[0].id], true);

  await api.purgePrivateBrowserData();
  assert.deepEqual([...values.entries()], [["unrelated", "keep"]]);
  assert.deepEqual(deletedCaches, ["momentum-v22", "momentum-v23"]);
  assert.deepEqual(deletedRequests, ["https://uytacdogqercenlgbpgb.supabase.co/rest/v1/user_states"]);
}

function testServiceWorkerCacheBoundary() {
  const source = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  const handlers = {};
  const cache = {
    addAll: async () => {},
    put: async () => {},
  };
  const context = {
    URL,
    Set,
    Promise,
    fetch: async () => ({ clone() { return this; } }),
    self: {
      location: new URL("https://solidmolid.github.io/momentum/service-worker.js"),
      clients: { claim: async () => {} },
      skipWaiting: async () => {},
      addEventListener(name, handler) { handlers[name] = handler; },
    },
    caches: {
      open: async () => cache,
      keys: async () => [],
      delete: async () => true,
      match: async () => null,
    },
  };
  vm.runInNewContext(source, context, { filename: "service-worker.js" });

  const isIntercepted = (url, mode = "cors") => {
    let intercepted = false;
    handlers.fetch({
      request: { method: "GET", mode, url },
      respondWith() { intercepted = true; },
    });
    return intercepted;
  };

  assert.equal(isIntercepted("https://uytacdogqercenlgbpgb.supabase.co/rest/v1/user_states"), false);
  assert.equal(isIntercepted("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.3/dist/umd/supabase.js"), false);
  assert.equal(isIntercepted("https://solidmolid.github.io/momentum/app.js?v=24"), true);
  assert.equal(isIntercepted("https://solidmolid.github.io/momentum/private.json"), false);
  assert.equal(isIntercepted("https://solidmolid.github.io/momentum/", "navigate"), true);
}

Promise.resolve()
  .then(testStateSanitizingAndLogoutPurge)
  .then(testServiceWorkerCacheBoundary)
  .then(() => console.log("Security regression tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
