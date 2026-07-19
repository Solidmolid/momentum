const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const SECTION_IDS = ["habits", "tasks", "calendar", "health", "focus", "sketches"];

const plain = (value) => JSON.parse(JSON.stringify(value));

function momentum5StateApi() {
  const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const instrumented = source.replace(
    /  \/\/ Robust starten[\s\S]*?\}\)\(\);\s*$/,
    `  window.__momentum5StateTest = {
    seedState,
    normalizeState,
    normalizeSectionLayout,
    APP_SECTIONS,
    DEFAULT_POMODORO_SETTINGS,
    STATE_VERSION,
  };\n})();`
  );
  assert.notEqual(instrumented, source, "app.js test hook could not be injected");

  const window = {};
  const context = {
    window,
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
    setInterval,
    clearInterval,
  };
  vm.runInNewContext(instrumented, context, { filename: "app.js" });
  return window.__momentum5StateTest;
}

function legacyV6Fixture() {
  return {
    version: 6,
    meta: { updatedAt: 1_720_000_000_000 },
    settings: {
      startDate: "2026-07-01",
      startMonday: "2026-06-29",
      theme: "dark",
    },
    habits: [
      { id: "habit-read", emoji: "📖", name: "Lesen", type: "daily", target: 1 },
      { id: "habit-gym", emoji: "🏋️", name: "Gym", type: "weekly", target: 3 },
    ],
    log: {
      "2026-07-01": { "habit-read": true },
      "2026-07-03": { "habit-read": true, "habit-gym": true },
    },
    taskSections: [
      { id: "short", name: "Kurzfristig" },
      { id: "long", name: "Langfristig" },
    ],
    tasks: {
      short: [{ id: "task-one", text: "Milch kaufen", dueDate: "2026-07-03", done: false, createdAt: 1_720_000_000_100 }],
      long: [{ id: "task-two", text: "Prüfung lernen", dueDate: "", done: true, createdAt: 1_720_000_000_200 }],
    },
    archivedTasks: [{
      id: "task-archived",
      text: "Alte Aufgabe",
      dueDate: "2026-06-30",
      done: true,
      createdAt: 1_719_000_000_000,
      sectionId: "short",
      archivedAt: 1_720_000_000_300,
    }],
    events: [{
      id: "event-one",
      title: "Zahnarzt",
      date: "2026-07-04",
      startTime: "09:30",
      endTime: "10:15",
      notes: "Versichertenkarte mitnehmen",
    }],
    health: {
      goals: { calories: 2400, protein: 180, carbs: 250, fat: 80, steps: 10_000 },
      entries: {
        "2026-07-02": {
          foods: [{
            id: "food-one",
            name: "Skyr",
            time: "08:15",
            createdAt: 1_720_000_000_400,
            calories: 220,
            protein: 35,
            carbs: 12,
            fat: 1,
          }],
          steps: 8_432,
        },
      },
    },
  };
}

function assertSixUniqueSections(layout) {
  assert.equal(layout.length, 6, "the layout must contain exactly six sections");
  assert.deepEqual([...new Set(layout.map((section) => section.id))].sort(), [...SECTION_IDS].sort());
  assert.equal(layout.some((section) => section.visible), true, "at least one section must remain visible");
}

function testSeedState() {
  const api = momentum5StateApi();
  const seeded = plain(api.seedState());

  assert.equal(api.STATE_VERSION, 7);
  assert.equal(seeded.version, 7);
  assertSixUniqueSections(seeded.settings.sections);
  assert.deepEqual(seeded.settings.sections.map((section) => section.id), SECTION_IDS);
  assert.equal(seeded.settings.sections.every((section) => section.visible), true);
  assert.equal(seeded.settings.lastScreen, "habits");
  assert.deepEqual(seeded.pomodoro.settings, plain(api.DEFAULT_POMODORO_SETTINGS));
  assert.equal(seeded.pomodoro.timer.phase, "focus");
  assert.equal(seeded.pomodoro.timer.status, "idle");
  assert.equal(seeded.pomodoro.timer.remainingMs, 25 * 60_000);
  assert.deepEqual(seeded.pomodoro.sessions, []);
}

function testV6MigrationPreservesExistingData() {
  const api = momentum5StateApi();
  const legacy = legacyV6Fixture();
  const before = plain(legacy);
  const migrated = plain(api.normalizeState(plain(legacy)));

  assert.equal(migrated.version, 7);
  assert.equal(migrated.meta.updatedAt, before.meta.updatedAt);
  assert.deepEqual(
    {
      startDate: migrated.settings.startDate,
      startMonday: migrated.settings.startMonday,
      theme: migrated.settings.theme,
    },
    before.settings
  );
  assert.deepEqual(migrated.habits, before.habits);
  assert.deepEqual(migrated.log, before.log);
  assert.deepEqual(migrated.taskSections, before.taskSections);
  assert.deepEqual(migrated.tasks, before.tasks);
  assert.deepEqual(migrated.archivedTasks, before.archivedTasks);
  assert.deepEqual(migrated.events, before.events);
  assert.deepEqual(migrated.health, before.health);

  assertSixUniqueSections(migrated.settings.sections);
  assert.deepEqual(migrated.settings.sections.map((section) => section.id), SECTION_IDS);
  assert.equal(migrated.settings.sections.every((section) => section.visible), true);
  assert.equal(migrated.settings.lastScreen, "habits");
  assert.deepEqual(migrated.pomodoro.settings, plain(api.DEFAULT_POMODORO_SETTINGS));

  // normalizeState receives a clone; the authoritative v6 backup stays untouched.
  assert.deepEqual(legacy, before);
}

function testV7NormalizationIsIdempotent() {
  const api = momentum5StateApi();
  const first = plain(api.normalizeState({
    ...legacyV6Fixture(),
    version: 7,
    settings: {
      ...legacyV6Fixture().settings,
      sections: [
        { id: "sketches", visible: true },
        { id: "habits", visible: false },
        { id: "tasks", visible: true },
        { id: "calendar", visible: true },
        { id: "health", visible: false },
        { id: "focus", visible: true },
      ],
      lastScreen: "sketches",
    },
    pomodoro: {
      settings: {
        focusMinutes: 40,
        shortBreakMinutes: 8,
        longBreakMinutes: 25,
        longBreakEvery: 3,
        autoStartBreaks: true,
        autoStartFocus: false,
        sound: false,
        vibration: true,
        notifications: true,
      },
      timer: {
        phase: "shortBreak",
        status: "paused",
        startedAt: 1_720_000_001_000,
        endsAt: 1_720_000_481_000,
        remainingMs: 180_000,
        focusRound: 2,
        completionToken: "round-two",
      },
      sessions: [{
        id: "focus-session-one",
        startedAt: 1_720_000_000_000,
        endedAt: 1_720_001_500_000,
        durationSeconds: 1_500,
        date: "2026-07-03",
      }],
    },
  }));
  const second = plain(api.normalizeState(plain(first)));

  assert.deepEqual(second, first, "normalizing a valid v7 state twice must be a no-op");
  assertSixUniqueSections(second.settings.sections);
}

function testSectionLayoutRepair() {
  const api = momentum5StateApi();
  const repaired = plain(api.normalizeSectionLayout([
    { id: "health", visible: false },
    { id: "unknown", visible: true },
    { id: "health", visible: true },
    { id: "focus", visible: false },
    { id: "tasks", visible: true },
  ]));

  assertSixUniqueSections(repaired);
  assert.deepEqual(repaired, [
    { id: "health", visible: false },
    { id: "focus", visible: false },
    { id: "tasks", visible: true },
    { id: "habits", visible: true },
    { id: "calendar", visible: true },
    { id: "sketches", visible: true },
  ]);

  const allHidden = plain(api.normalizeSectionLayout([
    { id: "sketches", visible: false },
    { id: "focus", visible: false },
    { id: "health", visible: false },
    { id: "calendar", visible: false },
    { id: "tasks", visible: false },
    { id: "habits", visible: false },
  ]));
  assertSixUniqueSections(allHidden);
  assert.equal(allHidden.filter((section) => section.visible).length, 1);
  assert.deepEqual(allHidden[0], { id: "sketches", visible: true });

  const defaults = plain(api.normalizeSectionLayout(null));
  assertSixUniqueSections(defaults);
  assert.deepEqual(defaults.map((section) => section.id), SECTION_IDS);
  assert.equal(defaults.every((section) => section.visible), true);
}

function testPomodoroBounds() {
  const api = momentum5StateApi();
  const normalized = plain(api.normalizeState({
    ...legacyV6Fixture(),
    version: 7,
    pomodoro: {
      settings: {
        focusMinutes: -50,
        shortBreakMinutes: 999,
        longBreakMinutes: 999,
        longBreakEvery: 1,
        autoStartBreaks: "yes",
        autoStartFocus: 1,
        sound: false,
        vibration: false,
        notifications: true,
      },
      timer: {
        phase: "invalid",
        status: "invalid",
        remainingMs: -1,
        focusRound: -5,
      },
      sessions: [],
    },
  }));

  assert.deepEqual(normalized.pomodoro.settings, {
    focusMinutes: 1,
    shortBreakMinutes: 60,
    longBreakMinutes: 120,
    longBreakEvery: 2,
    autoStartBreaks: false,
    autoStartFocus: false,
    sound: false,
    vibration: false,
    notifications: true,
  });
  assert.equal(normalized.pomodoro.timer.phase, "focus");
  assert.equal(normalized.pomodoro.timer.status, "idle");
  assert.equal(normalized.pomodoro.timer.remainingMs, 60_000);
  assert.equal(normalized.pomodoro.timer.focusRound, 0);

  const fallback = plain(api.normalizeState({
    ...legacyV6Fixture(),
    version: 7,
    pomodoro: { settings: { focusMinutes: "invalid", longBreakEvery: null } },
  }));
  assert.equal(fallback.pomodoro.settings.focusMinutes, 25);
  assert.equal(fallback.pomodoro.settings.longBreakEvery, 2);
}

Promise.resolve()
  .then(testSeedState)
  .then(testV6MigrationPreservesExistingData)
  .then(testV7NormalizationIsIdempotent)
  .then(testSectionLayoutRepair)
  .then(testPomodoroBounds)
  .then(() => console.log("Momentum 5 state regression tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
