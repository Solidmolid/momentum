"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Pomodoro = require("../pomodoro.js");

const MINUTE = 60_000;
const at = (year, month, day, hour = 12, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime();
const transition = (state, type, now, extra = {}) => Pomodoro.dispatch(state, { type, ...extra }, now);

(() => {
  const context = vm.createContext({ window: {} });
  const source = fs.readFileSync(path.join(__dirname, "..", "pomodoro.js"), "utf8");
  vm.runInContext(source, context);
  assert.equal(typeof context.window.MomentumPomodoro?.dispatch, "function", "browser build must expose window.MomentumPomodoro");
})();

(() => {
  const state = Pomodoro.createDefault();
  assert.equal(state.settings.focusMinutes, 25);
  assert.equal(state.timer.phase, "focus");
  assert.equal(state.timer.status, "idle");
  assert.equal(state.timer.plannedMs, 25 * MINUTE);
  assert.equal(Pomodoro.durationMs(state.settings, "focus"), 25 * MINUTE);
  assert.equal(Pomodoro.durationMs(state.settings, "shortBreak"), 5 * MINUTE);
})();

(() => {
  const now = at(2026, 7, 19, 9);
  const original = Pomodoro.createDefault();
  const before = JSON.stringify(original);
  const started = transition(original, "START", now, { token: "focus-1" });
  assert.equal(JSON.stringify(original), before, "dispatch must not mutate its input");
  assert.equal(started.changed, true);
  assert.equal(started.state.timer.status, "running");
  assert.equal(started.state.timer.startedAt, now);
  assert.equal(started.state.timer.endsAt, now + 25 * MINUTE);
  assert.equal(started.state.timer.plannedMs, 25 * MINUTE);
  assert.equal(Pomodoro.remainingMs(started.state, now + 10 * MINUTE), 15 * MINUTE);
  assert.equal(started.state.timer.endsAt, now + 25 * MINUTE, "reading time must not mutate the timer");
})();

(() => {
  const start = at(2026, 7, 19, 9);
  let state = transition(Pomodoro.createDefault(), "START", start, { token: "focus-pause" }).state;
  state = transition(state, "PAUSE", start + 7 * MINUTE).state;
  assert.equal(state.timer.status, "paused");
  assert.equal(state.timer.remainingMs, 18 * MINUTE);
  assert.equal(Pomodoro.remainingMs(state, start + 90 * MINUTE), 18 * MINUTE);

  state = transition(state, "RESUME", start + 90 * MINUTE).state;
  assert.equal(state.timer.status, "running");
  assert.equal(state.timer.endsAt, start + 108 * MINUTE);
  assert.equal(state.timer.remainingMs, 18 * MINUTE, "the stored remainder changes only on transitions");
  assert.equal(state.timer.plannedMs, 25 * MINUTE, "the planned duration remains immutable");

  state = transition(state, "RESET", start + 91 * MINUTE).state;
  assert.equal(state.timer.status, "idle");
  assert.equal(state.timer.phase, "focus");
  assert.equal(state.timer.remainingMs, 25 * MINUTE);
  assert.equal(state.sessions.length, 0);
})();

(() => {
  const start = at(2026, 7, 19, 9);
  let state = transition(Pomodoro.createDefault(), "START", start, { token: "immutable-plan" }).state;
  state = transition(state, "PAUSE", start + 10 * MINUTE).state;
  assert.equal(state.timer.remainingMs, 15 * MINUTE);
  assert.equal(state.timer.plannedMs, 25 * MINUTE);

  state = transition(state, "CONFIG_UPDATE", start + 10 * MINUTE, {
    settings: { focusMinutes: 60 },
  }).state;
  assert.equal(state.settings.focusMinutes, 60);
  assert.equal(state.timer.remainingMs, 15 * MINUTE);
  assert.equal(state.timer.plannedMs, 25 * MINUTE, "later settings must not rewrite the active round plan");

  state = Pomodoro.normalize(JSON.parse(JSON.stringify(state)));
  assert.equal(state.timer.remainingMs, 15 * MINUTE);
  assert.equal(state.timer.plannedMs, 25 * MINUTE, "the immutable plan must survive serialization and reload");

  state = transition(state, "RESUME", start + 10 * MINUTE).state;
  assert.equal(state.timer.endsAt, start + 25 * MINUTE);
  state = transition(state, "RECONCILE", start + 25 * MINUTE).state;
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].durationMs, 25 * MINUTE, "history must record the original 25-minute plan");
  assert.equal(Pomodoro.stats(state, start + 26 * MINUTE).today.focusMinutes, 25);
})();

(() => {
  const start = at(2026, 7, 19, 9);
  const legacyRunning = Pomodoro.normalize({
    settings: { focusMinutes: 25 },
    timer: {
      phase: "focus",
      status: "running",
      startedAt: start,
      endsAt: start + 25 * MINUTE,
      remainingMs: 25 * MINUTE,
      focusRound: 0,
      completionToken: "legacy-running",
    },
    sessions: [],
  });
  assert.equal(legacyRunning.timer.plannedMs, 25 * MINUTE);

  const legacyPaused = Pomodoro.normalize({
    settings: { focusMinutes: 25 },
    timer: {
      phase: "focus",
      status: "paused",
      startedAt: start,
      remainingMs: 15 * MINUTE,
      focusRound: 0,
      completionToken: "legacy-paused",
    },
    sessions: [],
  });
  assert.equal(legacyPaused.timer.remainingMs, 15 * MINUTE);
  assert.equal(legacyPaused.timer.plannedMs, 25 * MINUTE, "legacy paused timers must migrate without shortening their plan");
})();

(() => {
  const start = at(2026, 7, 19, 10);
  let state = transition(Pomodoro.createDefault(), "START", start, { token: "completed-once" }).state;
  const justBefore = transition(state, "RECONCILE", start + 25 * MINUTE - 1);
  assert.equal(justBefore.changed, false);
  assert.equal(justBefore.state.timer.status, "running");

  const completed = transition(state, "RECONCILE", start + 25 * MINUTE);
  assert.equal(completed.changed, true);
  assert.equal(completed.state.timer.status, "idle");
  assert.equal(completed.state.timer.phase, "shortBreak");
  assert.equal(completed.state.timer.focusRound, 1);
  assert.equal(completed.state.sessions.length, 1);
  assert.equal(completed.state.sessions[0].completedAt, start + 25 * MINUTE);

  const repeated = transition(completed.state, "RECONCILE", start + 50 * MINUTE);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.state.sessions.length, 1, "completion must be idempotent");

  const staleRunningCopy = {
    ...completed.state,
    settings: { ...completed.state.settings, autoStartBreaks: true },
    timer: { ...state.timer, focusRound: 1 },
  };
  const repaired = transition(staleRunningCopy, "RECONCILE", start + 25 * MINUTE, {
    allowAutoStart: true,
    nextToken: "must-not-start-again",
  });
  assert.equal(repaired.state.sessions.length, 1);
  assert.equal(repaired.state.timer.status, "idle", "an already recorded token must not auto-start twice");
  assert.equal(repaired.effects.some((effect) => effect.type === "completed"), false);
})();

(() => {
  const base = Pomodoro.createDefault();
  const skippedFocus = transition(base, "SKIP", at(2026, 7, 19, 11)).state;
  assert.equal(skippedFocus.timer.phase, "shortBreak");
  assert.equal(skippedFocus.timer.focusRound, 0);
  assert.equal(skippedFocus.sessions.length, 0);
  const skippedBreak = transition(skippedFocus, "SKIP", at(2026, 7, 19, 11, 1)).state;
  assert.equal(skippedBreak.timer.phase, "focus");
})();

(() => {
  let state = Pomodoro.reduce(Pomodoro.createDefault(), {
    type: "CONFIG_UPDATE",
    settings: { focusMinutes: 1, shortBreakMinutes: 1, longBreakMinutes: 2, longBreakEvery: 4 },
  }, at(2026, 7, 19, 8));
  let now = at(2026, 7, 19, 8);

  for (let round = 1; round <= 4; round += 1) {
    state = transition(state, "START", now, { token: `round-${round}` }).state;
    now += MINUTE;
    state = transition(state, "RECONCILE", now).state;
    assert.equal(state.timer.focusRound, round);
    assert.equal(state.timer.phase, round === 4 ? "longBreak" : "shortBreak");
    if (round < 4) {
      state = transition(state, "SKIP", now + 1).state;
      now += 2;
    }
  }

  state = transition(state, "START", now, { token: "long-break" }).state;
  now += 2 * MINUTE;
  state = transition(state, "RECONCILE", now).state;
  assert.equal(state.timer.phase, "focus");
  assert.equal(state.timer.focusRound, 0);
})();

(() => {
  const start = at(2026, 7, 19, 13);
  let state = Pomodoro.reduce(Pomodoro.createDefault(), {
    type: "CONFIG_UPDATE",
    settings: { focusMinutes: 1, shortBreakMinutes: 1, autoStartBreaks: true },
  }, start);
  state = transition(state, "START", start, { token: "auto-focus" }).state;

  const visible = transition(state, "RECONCILE", start + MINUTE + 500, {
    allowAutoStart: true,
    nextToken: "auto-break",
  }).state;
  assert.equal(visible.timer.phase, "shortBreak");
  assert.equal(visible.timer.status, "running");
  assert.equal(visible.timer.startedAt, start + MINUTE);

  const hidden = transition(state, "RECONCILE", start + MINUTE + 500, { allowAutoStart: false }).state;
  assert.equal(hidden.timer.status, "idle");

  const late = transition(state, "RECONCILE", start + MINUTE + Pomodoro.AUTO_START_GRACE_MS + 1, {
    allowAutoStart: true,
  }).state;
  assert.equal(late.timer.status, "idle");
})();

(() => {
  const start = at(2026, 7, 19, 14);
  let state = transition(Pomodoro.createDefault(), "START", start, { token: "stable-config" }).state;
  const originalEnd = state.timer.endsAt;
  state = transition(state, "CONFIG_UPDATE", start + MINUTE, { settings: { focusMinutes: 50 } }).state;
  assert.equal(state.settings.focusMinutes, 50);
  assert.equal(state.timer.endsAt, originalEnd, "config changes must not alter the current countdown");

  state = transition(state, "RESET", start + 2 * MINUTE).state;
  assert.equal(state.timer.remainingMs, 50 * MINUTE);

  state = Pomodoro.reduce(state, { type: "CONFIG_UPDATE", settings: {
    focusMinutes: 999,
    shortBreakMinutes: -5,
    longBreakEvery: 99,
  } }, start);
  assert.equal(state.settings.focusMinutes, 180);
  assert.equal(state.settings.shortBreakMinutes, 1);
  assert.equal(state.settings.longBreakEvery, 12);

  state = Pomodoro.reduce(state, { type: "CONFIG_UPDATE", settings: { longBreakEvery: 1 } }, start);
  assert.equal(state.settings.longBreakEvery, 2);

  let due = Pomodoro.reduce(Pomodoro.createDefault(), {
    type: "CONFIG_UPDATE",
    settings: { focusMinutes: 1 },
  }, start);
  due = transition(due, "START", start, { token: "due-config" }).state;
  const configuredAtBoundary = transition(due, "CONFIG_UPDATE", start + MINUTE, {
    settings: { shortBreakMinutes: 9 },
  });
  assert.equal(configuredAtBoundary.state.sessions.length, 1);
  assert.equal(configuredAtBoundary.state.settings.shortBreakMinutes, 9);
  assert.equal(configuredAtBoundary.state.timer.remainingMs, 9 * MINUTE);

  state = Pomodoro.reduce(state, { type: "CONFIG_UPDATE", settings: { longBreakEvery: null } }, start);
  assert.equal(state.settings.longBreakEvery, 2);
})();

(() => {
  const now = at(2026, 7, 19, 18);
  const state = Pomodoro.normalize({
    settings: {},
    timer: { phase: "focus", status: "idle" },
    sessions: [
      { id: "today-a", phase: "focus", startedAt: at(2026, 7, 19, 9), completedAt: at(2026, 7, 19, 9, 25), durationMs: 25 * MINUTE },
      { id: "today-b", phase: "focus", startedAt: at(2026, 7, 19, 10), completedAt: at(2026, 7, 19, 10, 25), durationMs: 25 * MINUTE },
      { id: "break", phase: "shortBreak", startedAt: at(2026, 7, 19, 10, 25), completedAt: at(2026, 7, 19, 10, 30), durationMs: 5 * MINUTE },
      { id: "week", phase: "focus", startedAt: at(2026, 7, 14, 9), completedAt: at(2026, 7, 14, 9, 25), durationMs: 25 * MINUTE },
      { id: "old", phase: "focus", startedAt: at(2026, 7, 10, 9), completedAt: at(2026, 7, 10, 9, 25), durationMs: 25 * MINUTE },
    ],
  });
  const result = Pomodoro.stats(state, now);
  assert.equal(result.today.focusMinutes, 50);
  assert.equal(result.today.sessions, 2);
  assert.equal(result.last7Days.focusMinutes, 75);
  assert.equal(result.last7Days.sessions, 3);
  assert.equal(result.last7Days.days.length, 7);
})();

(() => {
  const normalized = Pomodoro.normalize({
    settings: { focusMinutes: "nope", sound: false },
    timer: { phase: "wat", status: "running", endsAt: 0, completionToken: "" },
    sessions: [
      { id: "same", phase: "focus", startedAt: 10, completedAt: 20, durationMs: 10 },
      { id: "same", phase: "focus", startedAt: 10, completedAt: 30, durationMs: 20 },
      { id: "bad", startedAt: 30, completedAt: 20 },
    ],
  });
  assert.equal(normalized.settings.focusMinutes, 25);
  assert.equal(normalized.settings.sound, false);
  assert.equal(normalized.timer.phase, "focus");
  assert.equal(normalized.timer.status, "idle");
  assert.equal(normalized.sessions.length, 1);
  assert.equal(normalized.sessions[0].completedAt, 30);
})();

console.log("Pomodoro regression tests passed.");
