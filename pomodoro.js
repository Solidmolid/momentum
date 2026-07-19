/* Momentum Pomodoro – pure timer state machine (browser + CommonJS tests). */
(function (root, factory) {
  "use strict";

  const api = factory();
  if (root) root.MomentumPomodoro = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const MINUTE_MS = 60_000;
  const AUTO_START_GRACE_MS = 5_000;
  const MAX_SESSIONS = 1_000;
  const MAX_TIMER_MS = 180 * MINUTE_MS;
  const PHASES = new Set(["focus", "shortBreak", "longBreak"]);
  const STATUSES = new Set(["idle", "running", "paused"]);

  const DEFAULT_SETTINGS = Object.freeze({
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    longBreakEvery: 4,
    autoStartBreaks: false,
    autoStartFocus: false,
    sound: true,
    vibration: true,
    notifications: false,
  });

  const finiteNumber = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const boundedInteger = (value, fallback, minimum, maximum) => Math.max(
    minimum,
    Math.min(maximum, Math.round(finiteNumber(value, fallback))),
  );
  const cleanTimestamp = (value) => {
    const number = finiteNumber(value, 0);
    return number > 0 && number <= Number.MAX_SAFE_INTEGER ? Math.round(number) : null;
  };
  const cleanToken = (value) => {
    const token = String(value ?? "")
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .trim()
      .replace(/[^A-Za-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80);
    return token || null;
  };
  const clampMs = (value, maximum, fallback = maximum) => Math.max(
    0,
    Math.min(maximum, Math.round(finiteNumber(value, fallback))),
  );
  const sameSettings = (a, b) => Object.keys(DEFAULT_SETTINGS).every((key) => a[key] === b[key]);

  function normalizeSettings(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      focusMinutes: boundedInteger(source.focusMinutes, DEFAULT_SETTINGS.focusMinutes, 1, 180),
      shortBreakMinutes: boundedInteger(source.shortBreakMinutes, DEFAULT_SETTINGS.shortBreakMinutes, 1, 60),
      longBreakMinutes: boundedInteger(source.longBreakMinutes, DEFAULT_SETTINGS.longBreakMinutes, 1, 120),
      longBreakEvery: boundedInteger(source.longBreakEvery, DEFAULT_SETTINGS.longBreakEvery, 2, 12),
      autoStartBreaks: source.autoStartBreaks === true,
      autoStartFocus: source.autoStartFocus === true,
      sound: source.sound !== false,
      vibration: source.vibration !== false,
      notifications: source.notifications === true,
    };
  }

  function durationMs(rawSettings, phase = "focus") {
    const settings = normalizeSettings(rawSettings?.settings || rawSettings);
    if (phase === "shortBreak") return settings.shortBreakMinutes * MINUTE_MS;
    if (phase === "longBreak") return settings.longBreakMinutes * MINUTE_MS;
    return settings.focusMinutes * MINUTE_MS;
  }

  function createDefault() {
    const settings = normalizeSettings();
    return {
      settings,
      timer: {
        phase: "focus",
        status: "idle",
        startedAt: null,
        endsAt: null,
        remainingMs: durationMs(settings, "focus"),
        plannedMs: durationMs(settings, "focus"),
        focusRound: 0,
        completionToken: null,
      },
      sessions: [],
    };
  }

  function normalizeSession(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = cleanToken(raw.id || raw.completionToken);
    const phase = raw.phase === undefined ? "focus" : PHASES.has(raw.phase) ? raw.phase : null;
    const startedAt = cleanTimestamp(raw.startedAt);
    const completedAt = cleanTimestamp(raw.completedAt);
    if (!id || !phase || !startedAt || !completedAt || completedAt < startedAt) return null;
    const session = {
      id,
      phase,
      startedAt,
      completedAt,
      durationMs: boundedInteger(raw.durationMs, Math.max(0, completedAt - startedAt), 0, 24 * 60 * MINUTE_MS),
    };
    return session.durationMs > 0 ? session : null;
  }

  function normalize(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const settings = normalizeSettings(source.settings);
    const rawTimer = source.timer && typeof source.timer === "object" ? source.timer : {};
    const phase = PHASES.has(rawTimer.phase) ? rawTimer.phase : "focus";
    let status = STATUSES.has(rawTimer.status) ? rawTimer.status : "idle";
    const phaseDuration = durationMs(settings, phase);
    let startedAt = cleanTimestamp(rawTimer.startedAt);
    let endsAt = cleanTimestamp(rawTimer.endsAt);
    let completionToken = cleanToken(rawTimer.completionToken);
    let storedRemainingMs = clampMs(rawTimer.remainingMs, MAX_TIMER_MS, phaseDuration);
    const legacyPlannedMs = rawTimer.plannedMs ?? rawTimer.plannedDurationMs ?? rawTimer.durationMs;
    let plannedMs = clampMs(legacyPlannedMs, MAX_TIMER_MS, 0);
    const focusRound = boundedInteger(rawTimer.focusRound, 0, 0, 12);

    if (status === "running" && (!endsAt || !completionToken)) status = "idle";
    if (status === "paused" && (!startedAt || !completionToken || storedRemainingMs <= 0)) status = "idle";

    if (status === "idle") {
      startedAt = null;
      endsAt = null;
      completionToken = null;
      storedRemainingMs = phaseDuration;
      plannedMs = phaseDuration;
    } else if (status === "running") {
      startedAt ||= Math.max(1, endsAt - phaseDuration);
      // Older states did not have plannedMs. Their running remainingMs held
      // the planned round length, so it is the safest lossless migration.
      plannedMs ||= storedRemainingMs || phaseDuration;
      plannedMs = Math.max(plannedMs, Math.min(storedRemainingMs, MAX_TIMER_MS));
    } else {
      endsAt = null;
      // A legacy paused timer only stored its remainder. With unchanged
      // settings, the configured phase duration reconstructs its plan; if the
      // remainder is larger, never truncate it during migration.
      plannedMs ||= Math.max(phaseDuration, storedRemainingMs);
      plannedMs = Math.max(plannedMs, storedRemainingMs);
    }

    const sessionsById = new Map();
    const rawSessions = Array.isArray(source.sessions) ? source.sessions.slice(-MAX_SESSIONS * 2) : [];
    rawSessions.forEach((rawSession) => {
      const session = normalizeSession(rawSession);
      if (!session) return;
      const previous = sessionsById.get(session.id);
      if (!previous || session.completedAt >= previous.completedAt) sessionsById.set(session.id, session);
    });
    const sessions = [...sessionsById.values()]
      .sort((a, b) => a.completedAt - b.completedAt || a.id.localeCompare(b.id))
      .slice(-MAX_SESSIONS);

    return {
      settings,
      timer: {
        phase,
        status,
        startedAt,
        endsAt,
        remainingMs: storedRemainingMs,
        plannedMs,
        focusRound,
        completionToken,
      },
      sessions,
    };
  }

  function remainingMs(raw, now = Date.now()) {
    const state = normalize(raw);
    if (state.timer.status !== "running") return state.timer.remainingMs;
    return Math.max(0, state.timer.endsAt - finiteNumber(now, Date.now()));
  }

  function createToken(now) {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
    return `p-${Math.round(now).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function eventToken(event, key, now) {
    return cleanToken(event?.[key]) || createToken(now);
  }

  function idleTimer(phase, settings, focusRound) {
    return {
      phase,
      status: "idle",
      startedAt: null,
      endsAt: null,
      remainingMs: durationMs(settings, phase),
      plannedMs: durationMs(settings, phase),
      focusRound,
      completionToken: null,
    };
  }

  function runningTimer(timer, now, token) {
    const rest = timer.remainingMs;
    const planned = timer.plannedMs || rest;
    return {
      ...timer,
      status: "running",
      startedAt: timer.startedAt || now,
      endsAt: now + rest,
      remainingMs: rest,
      plannedMs: planned,
      completionToken: token,
    };
  }

  function effectsForCompletion(settings, session, nextPhase) {
    const effects = [
      { type: "completed", phase: session.phase, session },
      { type: "phase-changed", phase: nextPhase },
      { type: "persist" },
    ];
    if (settings.sound) effects.push({ type: "sound", phase: session.phase });
    if (settings.vibration) effects.push({ type: "vibration", phase: session.phase });
    if (settings.notifications) effects.push({ type: "notification", phase: session.phase, nextPhase });
    return effects;
  }

  function finishDue(state, event, now) {
    const timer = state.timer;
    if (timer.status !== "running" || timer.endsAt > now) return { state, effects: [], changed: false };

    const completedAt = timer.endsAt;
    const alreadyCompleted = state.sessions.some((session) => session.id === timer.completionToken);
    const plannedDuration = timer.plannedMs || durationMs(state.settings, timer.phase);
    const session = {
      id: timer.completionToken,
      phase: timer.phase,
      startedAt: timer.startedAt || Math.max(1, completedAt - plannedDuration),
      completedAt,
      durationMs: plannedDuration,
    };
    const sessions = alreadyCompleted ? state.sessions : [...state.sessions, session]
      .sort((a, b) => a.completedAt - b.completedAt || a.id.localeCompare(b.id))
      .slice(-MAX_SESSIONS);

    let focusRound = timer.focusRound;
    let nextPhase;
    if (timer.phase === "focus") {
      if (!alreadyCompleted) focusRound += 1;
      nextPhase = focusRound >= state.settings.longBreakEvery ? "longBreak" : "shortBreak";
    } else {
      nextPhase = "focus";
      if (timer.phase === "longBreak") focusRound = 0;
    }

    let nextTimer = idleTimer(nextPhase, state.settings, focusRound);
    const autoStartEnabled = timer.phase === "focus" ? state.settings.autoStartBreaks : state.settings.autoStartFocus;
    const lateness = Math.max(0, now - completedAt);
    const allowAutoStart = !alreadyCompleted && event.allowAutoStart === true && lateness <= AUTO_START_GRACE_MS;
    if (autoStartEnabled && allowAutoStart) {
      nextTimer = runningTimer(nextTimer, completedAt, eventToken(event, "nextToken", completedAt));
    }

    const nextState = { ...state, timer: nextTimer, sessions };
    const effects = alreadyCompleted
      ? [{ type: "phase-changed", phase: nextPhase }, { type: "persist" }]
      : effectsForCompletion(state.settings, session, nextPhase);
    return { state: nextState, effects, changed: true };
  }

  function dispatch(raw, rawEvent, rawNow = Date.now()) {
    const state = normalize(raw);
    const event = typeof rawEvent === "string" ? { type: rawEvent } : (rawEvent || {});
    const type = String(event.type || "").toUpperCase();
    const now = Math.max(0, finiteNumber(event.now, finiteNumber(rawNow, Date.now())));

    if (type === "RECONCILE") return finishDue(state, event, now);

    if (type === "CONFIG_UPDATE") {
      const settled = finishDue(state, { ...event, allowAutoStart: false }, now);
      const current = settled.state;
      const patch = event.settings && typeof event.settings === "object"
        ? event.settings
        : event.patch && typeof event.patch === "object" ? event.patch : {};
      const settings = normalizeSettings({ ...current.settings, ...patch });
      if (sameSettings(settings, current.settings)) return settled;

      // The current running/paused countdown remains stable. New durations are
      // applied as soon as the next idle phase is created.
      const timer = current.timer.status === "idle"
        ? idleTimer(current.timer.phase, settings, current.timer.focusRound)
        : current.timer;
      const effects = settled.effects.some((effect) => effect.type === "persist")
        ? settled.effects
        : [...settled.effects, { type: "persist" }];
      return { state: { ...current, settings, timer }, effects, changed: true };
    }

    // User actions always settle an expired timer first. A tap at 00:00 must
    // complete the round instead of producing a paused/reset zero timer.
    if (["PAUSE", "RESUME", "RESET", "SKIP"].includes(type)) {
      const settled = finishDue(state, { ...event, allowAutoStart: false }, now);
      if (settled.changed) return settled;
    }

    if (type === "START") {
      if (state.timer.status !== "idle") return { state, effects: [], changed: false };
      const timer = runningTimer(state.timer, now, eventToken(event, "token", now));
      return { state: { ...state, timer }, effects: [{ type: "persist" }], changed: true };
    }

    if (type === "PAUSE") {
      if (state.timer.status !== "running") return { state, effects: [], changed: false };
      const rest = Math.max(0, state.timer.endsAt - now);
      const timer = { ...state.timer, status: "paused", endsAt: null, remainingMs: rest };
      return { state: { ...state, timer }, effects: [{ type: "persist" }], changed: true };
    }

    if (type === "RESUME") {
      if (state.timer.status !== "paused") return { state, effects: [], changed: false };
      const rest = state.timer.remainingMs;
      const timer = {
        ...state.timer,
        status: "running",
        endsAt: now + rest,
        // The last known remainder is persisted only on transitions. The live
        // remainder still comes exclusively from endsAt.
        remainingMs: rest,
      };
      return { state: { ...state, timer }, effects: [{ type: "persist" }], changed: true };
    }

    if (type === "RESET") {
      const timer = idleTimer(state.timer.phase, state.settings, state.timer.focusRound);
      const changed = state.timer.status !== "idle" || state.timer.remainingMs !== timer.remainingMs;
      return { state: changed ? { ...state, timer } : state, effects: changed ? [{ type: "persist" }] : [], changed };
    }

    if (type === "SKIP") {
      let focusRound = state.timer.focusRound;
      const nextPhase = state.timer.phase === "focus" ? "shortBreak" : "focus";
      if (state.timer.phase === "longBreak") focusRound = 0;
      const timer = idleTimer(nextPhase, state.settings, focusRound);
      return {
        state: { ...state, timer },
        effects: [{ type: "phase-changed", phase: nextPhase }, { type: "persist" }],
        changed: true,
      };
    }

    return { state, effects: [], changed: false };
  }

  function reduce(raw, event, now = Date.now()) {
    return dispatch(raw, event, now).state;
  }

  const dateKey = (timestamp) => {
    const date = new Date(timestamp);
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  function stats(raw, rawNow = Date.now()) {
    const state = normalize(raw);
    const now = new Date(finiteNumber(rawNow, Date.now()));
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(todayStart);
      date.setDate(date.getDate() - (6 - index));
      return { date: dateKey(date.getTime()), focusMs: 0, sessions: 0 };
    });
    const byDate = new Map(days.map((day) => [day.date, day]));

    state.sessions.forEach((session) => {
      if (session.phase !== "focus" || session.completedAt > now.getTime()) return;
      const day = byDate.get(dateKey(session.completedAt));
      if (!day) return;
      day.focusMs += session.durationMs;
      day.sessions += 1;
    });

    const today = days[days.length - 1];
    const sevenDayFocusMs = days.reduce((total, day) => total + day.focusMs, 0);
    const sevenDaySessions = days.reduce((total, day) => total + day.sessions, 0);
    return {
      today: { ...today, focusMinutes: Math.round(today.focusMs / MINUTE_MS) },
      last7Days: {
        from: days[0].date,
        to: days[days.length - 1].date,
        focusMs: sevenDayFocusMs,
        focusMinutes: Math.round(sevenDayFocusMs / MINUTE_MS),
        sessions: sevenDaySessions,
        days: days.map((day) => ({ ...day, focusMinutes: Math.round(day.focusMs / MINUTE_MS) })),
      },
    };
  }

  return Object.freeze({
    AUTO_START_GRACE_MS,
    DEFAULT_SETTINGS,
    MAX_SESSIONS,
    createDefault,
    normalize,
    durationMs,
    remainingMs,
    dispatch,
    reduce,
    stats,
  });
});
