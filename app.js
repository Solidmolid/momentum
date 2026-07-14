/* ============================================================
   Momentum – App-Logik (Vanilla JS, keine Abhängigkeiten)
   Daten liegen lokal im Browser (localStorage).
   ============================================================ */
(function () {
  "use strict";

  const KEY = "momentum_v1";
  const LEGACY_OWNER_KEY = "momentum_legacy_owner";
  const APP_VERSION = "4.4";
  const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const HEALTH_FIELDS = [
    { key: "calories", label: "Kalorien", short: "kcal", unit: "kcal" },
    { key: "protein", label: "Eiweiß", short: "Eiweiß", unit: "g" },
    { key: "carbs", label: "Kohlenhydrate", short: "KH", unit: "g" },
    { key: "fat", label: "Fett", short: "Fett", unit: "g" },
    { key: "steps", label: "Schritte", short: "Schritte", unit: "" },
  ];
  const NUTRITION_FIELDS = HEALTH_FIELDS.filter((field) => field.key !== "steps");
  const CHECK_SVG =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

  /* ---------- Datum-Helfer (lokale Zeit) ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  const timeMinutes = (time) => { const [hours, minutes] = String(time || "0:0").split(":").map(Number); return hours * 60 + minutes; };
  const defaultEndTime = (startTime) => {
    const total = Math.min(23 * 60 + 59, timeMinutes(startTime) + 60);
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  };
  const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const todayStr = () => dateStr(new Date());
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  function mondayOf(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const wd = (x.getDay() + 6) % 7; // Mo=0 … So=6
    return addDays(x, -wd);
  }
  const weekDays = (mondayStr) => { const m = parseDate(mondayStr); return Array.from({ length: 7 }, (_, i) => addDays(m, i)); };
  const fmtDM = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ---------- Standard-Daten ---------- */
  function seedState() {
    const startDate = todayStr();
    const startMonday = dateStr(mondayOf(parseDate(startDate)));
    return {
      version: 6,
      meta: { updatedAt: Date.now() },
      settings: { startDate, startMonday, theme: "light" },
      habits: [
        { id: uid(), emoji: "🌅", name: "Aufstehen um 5 Uhr", type: "daily", target: 1 },
        { id: uid(), emoji: "🏋️", name: "Gym", type: "weekly", target: 3 },
        { id: uid(), emoji: "🚫", name: "Kein Alkohol", type: "daily", target: 1 },
        { id: uid(), emoji: "📵", name: "Kein Social Media", type: "daily", target: 1 },
        { id: uid(), emoji: "💶", name: "Budget getrackt", type: "daily", target: 1 },
        { id: uid(), emoji: "💻", name: "Projektarbeit", type: "daily", target: 1 },
        { id: uid(), emoji: "📖", name: "Lesen", type: "daily", target: 1 },
        { id: uid(), emoji: "🎓", name: "Lernen", type: "daily", target: 1 },
      ],
      log: {},
      tasks: { short: [], long: [] },
      taskSections: [{ id: "short", name: "Kurzfristig" }, { id: "long", name: "Langfristig" }],
      archivedTasks: [],
      events: [],
      health: { goals: { calories: 0, protein: 0, carbs: 0, fat: 0, steps: 0 }, entries: {} },
    };
  }

  /* ---------- State laden / speichern ---------- */
  let state;
  const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
  const SAFE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  const cleanText = (value, maxLength, fallback = "") => {
    const cleaned = String(value ?? fallback).replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, maxLength);
    return cleaned || fallback;
  };
  const cleanId = (value, fallback = uid()) => {
    const candidate = String(value ?? "");
    return SAFE_ID.test(candidate) ? candidate : fallback;
  };
  const cleanDate = (value, fallback = "") => {
    const candidate = String(value ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return fallback;
    const [year, month, day] = candidate.split("-").map(Number);
    const parsed = new Date(year, month - 1, day);
    return dateStr(parsed) === candidate ? candidate : fallback;
  };
  const cleanTime = (value) => SAFE_TIME.test(String(value ?? "")) ? String(value) : "";
  const cleanNumber = (value, fallback = 0, max = 1_000_000) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.min(number, max) : fallback;
  };
  const cleanHabitDefinition = (rawHabit) => ({
    emoji: cleanText(rawHabit?.emoji, 8, "•"),
    name: cleanText(rawHabit?.name, 60, "Gewohnheit"),
    type: rawHabit?.type === "weekly" ? "weekly" : "daily",
    target: Math.max(1, Math.min(7, Math.round(cleanNumber(rawHabit?.target, 1, 7)))),
  });
  const habitFingerprint = (habit) => JSON.stringify([
    habit.type,
    habit.name.toLocaleLowerCase("de-DE"),
    habit.emoji,
    habit.target,
  ]);
  const stateHasDuplicateHabits = (value) => {
    const rawHabits = Array.isArray(value?.habits) ? value.habits.slice(0, 100) : [];
    const ids = new Set();
    const fingerprints = new Set();
    return rawHabits.some((rawHabit) => {
      const rawId = String(rawHabit?.id ?? "");
      const fingerprint = habitFingerprint(cleanHabitDefinition(rawHabit));
      const duplicate = (rawId && ids.has(rawId)) || fingerprints.has(fingerprint);
      if (rawId) ids.add(rawId);
      fingerprints.add(fingerprint);
      return duplicate;
    });
  };

  function normalizeState(s) {
    s = s && typeof s === "object" ? s : seedState();
    const rawSettings = s.settings && typeof s.settings === "object" ? s.settings : {};
    const requestedStart = cleanDate(rawSettings.startDate || rawSettings.startMonday, todayStr());
    const startDate = requestedStart > todayStr() ? todayStr() : requestedStart;
    const updatedAt = Number(s.meta?.updatedAt);
    s.meta = { updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0 };
    s.settings = {
      startDate,
      startMonday: dateStr(mondayOf(parseDate(startDate))),
      theme: rawSettings.theme === "dark" ? "dark" : "light",
    };

    const habitIds = new Map();
    const usedHabitIds = new Set();
    const habitsByFingerprint = new Map();
    const rawHabits = Array.isArray(s.habits) ? s.habits.slice(0, 100) : [];
    s.habits = [];
    rawHabits.forEach((rawHabit) => {
      const rawId = String(rawHabit?.id ?? "");
      if (rawId && habitIds.has(rawId)) return;
      const definition = cleanHabitDefinition(rawHabit);
      const fingerprint = habitFingerprint(definition);
      const existing = habitsByFingerprint.get(fingerprint);
      if (existing) {
        if (rawId) habitIds.set(rawId, existing.id);
        return;
      }
      let id = cleanId(rawId);
      while (usedHabitIds.has(id)) id = uid();
      usedHabitIds.add(id);
      if (rawId) habitIds.set(rawId, id);
      const habit = { id, ...definition };
      habitsByFingerprint.set(fingerprint, habit);
      s.habits.push(habit);
    });

    const rawLog = s.log && typeof s.log === "object" ? s.log : {};
    s.log = {};
    Object.entries(rawLog).slice(0, 1500).forEach(([rawDate, rawRecord]) => {
      const date = cleanDate(rawDate);
      if (!date || !rawRecord || typeof rawRecord !== "object") return;
      const record = {};
      Object.entries(rawRecord).forEach(([rawHabitId, completed]) => {
        const id = habitIds.get(rawHabitId);
        if (id && completed === true) record[id] = true;
      });
      if (Object.keys(record).length) s.log[date] = record;
    });

    const rawTasks = s.tasks && typeof s.tasks === "object" ? s.tasks : {};
    const defaultSections = [{ id: "short", name: "Kurzfristig" }, { id: "long", name: "Langfristig" }];
    const rawSections = Array.isArray(s.taskSections) && s.taskSections.length ? s.taskSections.slice(0, 20) : defaultSections;
    const usedSectionIds = new Set();
    const sectionIds = new Map();
    const sectionEntries = rawSections.map((rawSection) => {
      const rawId = String(rawSection?.id ?? "");
      let id = cleanId(rawId);
      while (usedSectionIds.has(id)) id = uid();
      usedSectionIds.add(id);
      if (rawId) sectionIds.set(rawId, id);
      return { rawId, section: { id, name: cleanText(rawSection?.name, 40, "Aufgaben") } };
    });
    s.taskSections = sectionEntries.map((entry) => entry.section);

    const usedTaskIds = new Set();
    const cleanTask = (rawTask) => {
      let id = cleanId(rawTask?.id);
      while (usedTaskIds.has(id)) id = uid();
      usedTaskIds.add(id);
      const task = {
        id,
        text: cleanText(rawTask?.text, 140, "Aufgabe"),
        dueDate: cleanDate(rawTask?.dueDate),
        done: rawTask?.done === true,
        createdAt: cleanNumber(rawTask?.createdAt, Date.now(), Number.MAX_SAFE_INTEGER),
      };
      return task;
    };
    s.tasks = {};
    sectionEntries.forEach(({ rawId, section }) => {
      const source = Array.isArray(rawTasks[rawId]) ? rawTasks[rawId] : Array.isArray(rawTasks[section.id]) ? rawTasks[section.id] : [];
      s.tasks[section.id] = source.slice(0, 500).map(cleanTask);
    });
    const fallbackSectionId = s.taskSections[0]?.id || "short";
    const rawArchivedTasks = Array.isArray(s.archivedTasks) ? s.archivedTasks.slice(0, 1000) : [];
    s.archivedTasks = rawArchivedTasks.map((rawTask) => ({
      ...cleanTask(rawTask),
      sectionId: sectionIds.get(String(rawTask?.sectionId ?? "")) || fallbackSectionId,
      archivedAt: cleanNumber(rawTask?.archivedAt, Date.now(), Number.MAX_SAFE_INTEGER),
    }));

    const usedEventIds = new Set();
    const rawEvents = Array.isArray(s.events) ? s.events.slice(0, 2000) : [];
    s.events = rawEvents.map((rawEvent) => {
      const date = cleanDate(rawEvent?.date);
      if (!date) return null;
      let id = cleanId(rawEvent?.id);
      while (usedEventIds.has(id)) id = uid();
      usedEventIds.add(id);
      const startTime = cleanTime(rawEvent?.startTime || rawEvent?.time);
      let endTime = cleanTime(rawEvent?.endTime);
      if (startTime && (!endTime || timeMinutes(endTime) <= timeMinutes(startTime))) endTime = defaultEndTime(startTime);
      return {
        id,
        title: cleanText(rawEvent?.title, 100, "Termin"),
        date,
        startTime,
        endTime,
        notes: cleanText(rawEvent?.notes, 300),
      };
    }).filter(Boolean);

    const rawHealth = s.health && typeof s.health === "object" ? s.health : {};
    const rawGoals = rawHealth.goals && typeof rawHealth.goals === "object" ? rawHealth.goals : {};
    s.health = { goals: {}, entries: {} };
    HEALTH_FIELDS.forEach((field) => {
      s.health.goals[field.key] = cleanNumber(rawGoals[field.key]);
    });
    const rawHealthEntries = rawHealth.entries && typeof rawHealth.entries === "object" ? rawHealth.entries : {};
    s.health.entries = Object.fromEntries(Object.entries(rawHealthEntries).map(([date, rawEntry]) => {
      const safeDate = cleanDate(date);
      if (!safeDate) return null;
      const entry = {};
      const rawFoods = Array.isArray(rawEntry?.foods) ? rawEntry.foods.slice(0, 100) : [];
      const usedFoodIds = new Set();
      entry.foods = rawFoods.map((rawFood, index) => {
        let id = cleanId(rawFood?.id, `${safeDate}-${index}`);
        while (usedFoodIds.has(id)) id = uid();
        usedFoodIds.add(id);
        const food = {
          id,
          name: cleanText(rawFood?.name, 80, "Eintrag"),
          time: cleanTime(rawFood?.time),
          createdAt: cleanNumber(rawFood?.createdAt, 0, Number.MAX_SAFE_INTEGER),
        };
        NUTRITION_FIELDS.forEach((field) => {
          if (rawFood?.[field.key] !== "" && rawFood?.[field.key] !== undefined) food[field.key] = cleanNumber(rawFood[field.key]);
        });
        return food;
      });
      if (!entry.foods.length) {
        const legacyFood = { id: `legacy-${safeDate}`, name: "Bisheriger Tagesstand", time: "", createdAt: 0 };
        let hasLegacyNutrition = false;
        NUTRITION_FIELDS.forEach((field) => {
          const value = Number(rawEntry?.[field.key]);
          if (rawEntry?.[field.key] !== "" && rawEntry?.[field.key] !== undefined && Number.isFinite(value) && value >= 0) {
            legacyFood[field.key] = cleanNumber(value);
            hasLegacyNutrition = true;
          }
        });
        if (hasLegacyNutrition) entry.foods.push(legacyFood);
      }
      if (rawEntry?.steps !== "" && rawEntry?.steps !== undefined) entry.steps = cleanNumber(rawEntry.steps);
      if (!entry.foods.length) delete entry.foods;
      return [safeDate, entry];
    }).filter((pair) => pair && Object.keys(pair[1]).length).slice(0, 1500));
    return {
      version: 6,
      meta: s.meta,
      settings: s.settings,
      habits: s.habits,
      log: s.log,
      tasks: s.tasks,
      taskSections: s.taskSections,
      archivedTasks: s.archivedTasks,
      events: s.events,
      health: s.health,
    };
  }
  const stateRevision = (value) => Number(value?.meta?.updatedAt) || 0;
  const cloneState = (value) => JSON.parse(JSON.stringify(value));
  function mergeById(base, preferred) {
    const items = new Map();
    [...(base || []), ...(preferred || [])].forEach((item) => { if (item?.id) items.set(item.id, { ...items.get(item.id), ...item }); });
    return [...items.values()];
  }
  function mergeLegacyStates(baseState, preferredState) {
    const base = normalizeState(cloneState(baseState));
    const preferred = normalizeState(cloneState(preferredState));
    const merged = normalizeState(cloneState(base));
    merged.settings = { ...base.settings, ...preferred.settings };
    merged.habits = mergeById(base.habits, preferred.habits);
    merged.log = { ...base.log };
    Object.entries(preferred.log || {}).forEach(([date, record]) => { merged.log[date] = { ...(merged.log[date] || {}), ...record }; });
    merged.taskSections = mergeById(base.taskSections, preferred.taskSections);
    const sectionIds = new Set([...Object.keys(base.tasks || {}), ...Object.keys(preferred.tasks || {}), ...merged.taskSections.map((section) => section.id)]);
    merged.tasks = {};
    sectionIds.forEach((sectionId) => { merged.tasks[sectionId] = mergeById(base.tasks?.[sectionId], preferred.tasks?.[sectionId]); });
    merged.archivedTasks = mergeById(base.archivedTasks, preferred.archivedTasks);
    const preferredActiveIds = new Set(Object.values(preferred.tasks || {}).flat().map((task) => task.id));
    const preferredArchivedIds = new Set((preferred.archivedTasks || []).map((task) => task.id));
    Object.keys(merged.tasks).forEach((sectionId) => { merged.tasks[sectionId] = merged.tasks[sectionId].filter((task) => !preferredArchivedIds.has(task.id)); });
    merged.archivedTasks = merged.archivedTasks.filter((task) => !preferredActiveIds.has(task.id));
    merged.events = mergeById(base.events, preferred.events);
    merged.health.goals = { ...base.health.goals, ...preferred.health.goals };
    merged.health.entries = { ...base.health.entries };
    Object.entries(preferred.health.entries || {}).forEach(([date, entry]) => {
      const baseEntry = merged.health.entries[date] || {};
      merged.health.entries[date] = { ...baseEntry, ...entry };
      const foods = mergeById(baseEntry.foods, entry.foods);
      if (foods.length) merged.health.entries[date].foods = foods;
    });
    merged.meta = { updatedAt: Math.max(Date.now(), stateRevision(base), stateRevision(preferred)) + 1, mergedLegacy: true };
    return normalizeState(merged);
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? normalizeState(JSON.parse(raw)) : seedState();
    } catch (e) {
      console.warn("Konnte Daten nicht laden, starte neu.", e);
      return seedState();
    }
  }
  const userStorageKey = (userId) => `${KEY}_user_${userId}`;
  function loadUserLocal(userId) {
    try {
      const raw = localStorage.getItem(userStorageKey(userId));
      return raw ? JSON.parse(raw) : null;
    } catch (_error) { return null; }
  }
  function save() {
    try {
      state.meta = state.meta || {};
      state.meta.updatedAt = Math.max(Date.now(), stateRevision(state) + 1);
      localStorage.setItem(cloudUser ? userStorageKey(cloudUser.id) : KEY, JSON.stringify(state));
      scheduleCloudSave();
    }
    catch (e) { console.error("Speichern fehlgeschlagen", e); }
  }

  async function purgePrivateBrowserData() {
    // Nach dem Abmelden darf kein Kontostand in diesem Browserprofil bleiben.
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key === KEY || key === LEGACY_OWNER_KEY || key === "momentum_cloud_session" || key?.startsWith(`${KEY}_user_`)) {
        localStorage.removeItem(key);
      }
    }

    if (!("caches" in window)) return;
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.filter((name) => name.startsWith("momentum-")).map(async (name) => {
      if (name !== "momentum-v24") return caches.delete(name);
      const cache = await caches.open(name);
      const requests = await cache.keys();
      return Promise.all(requests
        .filter((request) => new URL(request.url).origin !== location.origin)
        .map((request) => cache.delete(request)));
    }));
  }

  /* ---------- View-State (nicht gespeichert) ---------- */
  let currentMonday;      // Mo der angezeigten Woche (String)
  let selectedDate;       // ausgewählter Tag (String)
  let screen = "habits";
  let calendarMonth;
  let calendarSelected;
  let healthSelected;
  let healthMetric = "calories";
  let healthRange = "week";
  let trendRange = "start";
  let archiveExpanded = false;
  let cloudUser = null;
  let cloudProfile = null;
  let cloudIsAdmin = false;
  let cloudSyncTimer = null;
  let cloudSaveInFlight = null;
  let cloudSaveRequested = false;
  let cloudSyncLabel = "Noch nicht synchronisiert";
  let activatingUserId = null;

  /* ---------- Berechnungen ---------- */
  const dailyHabits = () => state.habits.filter((h) => h.type === "daily");
  const weeklyHabits = () => state.habits.filter((h) => h.type === "weekly");
  const allTasks = () => state.taskSections.flatMap((section) => (state.tasks[section.id] || []).map((task) => ({ ...task, sectionId: section.id })));
  function findTask(id) {
    for (const section of state.taskSections) {
      const arr = state.tasks[section.id] || [];
      const task = arr.find((item) => item.id === id);
      if (task) return { task, section, arr };
    }
    return null;
  }

  function dayPercent(ds) {
    const daily = dailyHabits();
    if (daily.length === 0) return null;
    const rec = state.log[ds] || {};
    const done = daily.filter((h) => rec[h.id]).length;
    return Math.round((done / daily.length) * 100);
  }
  function dayCounts(ds) {
    const daily = dailyHabits();
    const rec = state.log[ds] || {};
    return { done: daily.filter((h) => rec[h.id]).length, total: daily.length };
  }
  function weeklyDone(habit, mondayStr) {
    return weekDays(mondayStr).filter((d) => (state.log[dateStr(d)] || {})[habit.id]).length;
  }
  function combinedCounts(ds) {
    const daily = dayCounts(ds);
    const mondayStr = dateStr(mondayOf(parseDate(ds)));
    const weekly = weeklyHabits();
    const weeklyDoneCount = weekly.filter((habit) => weeklyDone(habit, mondayStr) >= habit.target).length;
    return {
      dailyDone: daily.done,
      dailyTotal: daily.total,
      weeklyDone: weeklyDoneCount,
      weeklyTotal: weekly.length,
      done: daily.done + weeklyDoneCount,
      total: daily.total + weekly.length,
    };
  }
  function combinedDayPercent(ds) {
    const counts = combinedCounts(ds);
    return counts.total ? Math.round((counts.done / counts.total) * 100) : null;
  }
  function weekNumber(mondayStr) {
    const start = parseDate(state.settings.startMonday);
    const cur = parseDate(mondayStr);
    return Math.floor((cur - start) / (7 * 864e5)) + 1;
  }
  function earliestHistoryMonday() {
    return dateStr(mondayOf(addDays(new Date(), -370)));
  }
  function isToggle(ds, habitId) { return !!(state.log[ds] || {})[habitId]; }
  function setToggle(ds, habitId, val) {
    if (!state.log[ds]) state.log[ds] = {};
    if (val) state.log[ds][habitId] = true;
    else { delete state.log[ds][habitId]; if (!Object.keys(state.log[ds]).length) delete state.log[ds]; }
    save();
  }

  /* ---------- SVG-Bausteine ---------- */
  function ringSVG(pct, size, stroke) {
    size = size || 66; stroke = stroke || 7;
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    const p = pct == null ? 0 : pct;
    const off = c * (1 - p / 100);
    const gid = "rg" + Math.round(size);
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/>
      </linearGradient></defs>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--ring-track)" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="url(#${gid})" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
    </svg>`;
  }

  function trendData() {
    const today = parseDate(todayStr());
    const start = parseDate(state.settings.startDate);
    const selected = parseDate(selectedDate || todayStr());
    const reference = selected > today ? today : selected;
    if (trendRange === "start") {
      const count = Math.max(1, Math.floor((today - start) / 864e5) + 1);
      const dates = Array.from({ length: count }, (_, i) => addDays(start, i));
      const labelPoints = new Set([0, Math.round((count - 1) * .25), Math.round((count - 1) * .5), Math.round((count - 1) * .75), count - 1]);
      return {
        dates,
        values: dates.map((d) => combinedDayPercent(dateStr(d)) || 0),
        labels: dates.map((d, i) => labelPoints.has(i) ? `${d.getDate()}.${d.getMonth() + 1}.` : ""),
        caption: `seit deinem Start am ${fmtDM(start)}`,
      };
    }
    if (trendRange === "week") {
      const dates = weekDays(currentMonday).filter((d) => d <= today);
      return {
        dates,
        values: dates.map((d) => combinedDayPercent(dateStr(d)) || 0),
        labels: dates.map((d) => WD[(d.getDay() + 6) % 7]),
        caption: "in dieser Woche",
      };
    }
    if (trendRange === "month") {
      const dates = Array.from({ length: 30 }, (_, i) => addDays(reference, i - 29));
      const labelPoints = new Set([0, Math.round((dates.length - 1) * .25), Math.round((dates.length - 1) * .5), Math.round((dates.length - 1) * .75), dates.length - 1]);
      return {
        dates,
        values: dates.map((d) => combinedDayPercent(dateStr(d)) || 0),
        labels: dates.map((d, i) => labelPoints.has(i) ? `${d.getDate()}.${d.getMonth() + 1}.` : ""),
        caption: "in den letzten 30 Tagen",
      };
    }
    const months = Array.from({ length: 12 }, (_, i) => new Date(reference.getFullYear(), reference.getMonth() - 11 + i, 1));
    const monthValues = months.map((monthStart) => {
      const end = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
      const cappedEnd = end > today ? today : end;
      if (monthStart > cappedEnd) return 0;
      const count = Math.floor((cappedEnd - monthStart) / 864e5) + 1;
      const values = Array.from({ length: count }, (_, i) => combinedDayPercent(dateStr(addDays(monthStart, i))) || 0);
      return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
    });
    const statStart = months[0];
    const monthEnd = new Date(reference.getFullYear(), reference.getMonth() + 1, 0);
    const statEnd = monthEnd > today ? today : monthEnd;
    const statDays = Math.floor((statEnd - statStart) / 864e5) + 1;
    return {
      dates: Array.from({ length: Math.max(1, statDays) }, (_, i) => addDays(statStart, i)),
      values: monthValues,
      labels: months.map((d) => MONTHS[d.getMonth()].slice(0, 3)),
      caption: "im 12-Monats-Rückblick",
    };
  }

  function smoothPath(points) {
    if (!points.length) return "";
    if (points.length === 1) return `M${points[0].x},${points[0].y}`;
    let path = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      path += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return path;
  }

  function buildChart() {
    if (!dailyHabits().length && !weeklyHabits().length) return `<p class="empty-hint">Noch keine Gewohnheiten.</p>`;
    const data = trendData();
    const W = 320, H = 154, padX = 7, padY = 13;
    const denom = Math.max(1, data.values.length - 1);
    const points = data.values.map((value, index) => ({
      x: padX + (W - padX * 2) * (index / denom),
      y: padY + (H - padY * 2) * (1 - value / 100),
    }));
    const path = smoothPath(points);
    const base = H - padY;
    const area = points.length ? `${path} L${points[points.length - 1].x.toFixed(1)},${base} L${points[0].x.toFixed(1)},${base} Z` : "";
    const last = points[points.length - 1];
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Fortschrittsverlauf">
      <defs>
        <linearGradient id="trendArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".30"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient>
        <linearGradient id="trendStroke" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/></linearGradient>
      </defs>
      <line x1="${padX}" y1="${padY}" x2="${W - padX}" y2="${padY}" class="trend-gridline"/>
      <line x1="${padX}" y1="${H / 2}" x2="${W - padX}" y2="${H / 2}" class="trend-gridline"/>
      <line x1="${padX}" y1="${base}" x2="${W - padX}" y2="${base}" class="trend-gridline"/>
      <path d="${area}" fill="url(#trendArea)"/>
      <path d="${path}" fill="none" stroke="url(#trendStroke)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
      ${last ? `<circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="5" fill="var(--surface)" stroke="var(--accent-2)" stroke-width="3"/>` : ""}
    </svg>`;
  }

  function renderTrend() {
    const data = trendData();
    const average = data.values.length ? Math.round(data.values.reduce((sum, value) => sum + value, 0) / data.values.length) : 0;
    $("#trend-value").textContent = average + " %";
    $("#trend-caption").textContent = data.caption;
    $("#week-chart").innerHTML = buildChart();
    const labelIndexes = trendRange === "week" ? data.labels.map((_, i) => i) : data.labels.map((label, i) => label ? i : -1).filter((i) => i >= 0);
    $("#trend-axis").innerHTML = labelIndexes.map((i) => `<span style="left:${data.labels.length <= 1 ? 0 : (i / (data.labels.length - 1)) * 100}%">${data.labels[i]}</span>`).join("");
    const summaryDate = parseDate(selectedDate || todayStr()) > parseDate(todayStr()) ? todayStr() : (selectedDate || todayStr());
    const summary = combinedCounts(summaryDate);
    $("#trend-summary").innerHTML = `
      <div class="trend-summary__item"><span>Tagesziele</span><strong>${summary.dailyDone}/${summary.dailyTotal}</strong></div>
      <div class="trend-summary__item"><span>Wochenziele</span><strong>${summary.weeklyDone}/${summary.weeklyTotal}</strong></div>
      <div class="trend-summary__item trend-summary__item--total"><span>Gesamt</span><strong>${summary.done}/${summary.total}</strong></div>`;
    $("#consistency-range").textContent = trendRange === "start"
      ? "Seit Start"
      : trendRange === "week"
        ? "Diese Woche"
        : trendRange === "month"
          ? "30 Tage"
          : "12 Monate";
    const validDates = data.dates.filter((d) => dateStr(d) <= todayStr());
    $("#habit-stats").innerHTML = dailyHabits().map((habit) => {
      const done = validDates.filter((d) => isToggle(dateStr(d), habit.id)).length;
      const rate = validDates.length ? Math.round(done / validDates.length * 100) : 0;
      return `<div class="habit-stat"><span class="habit-stat__emoji">${escapeHtml(habit.emoji || "•")}</span><span class="habit-stat__main"><span><strong>${escapeHtml(habit.name)}</strong><b>${rate} %</b></span><i><em style="width:${rate}%"></em></i></span></div>`;
    }).join("") || `<p class="empty-hint">Noch keine Gewohnheiten vorhanden.</p>`;
  }

  /* ---------- Rendern: Gewohnheiten ---------- */
  const $ = (sel) => document.querySelector(sel);

  function renderHabits() {
    const wn = weekNumber(currentMonday);
    const days = weekDays(currentMonday);
    $("#week-label").textContent = wn > 0 ? "Woche " + wn : "Rückblick";
    $("#week-range").textContent = `${WD[0]} ${fmtDM(days[0])}–${WD[6]} ${fmtDM(days[6])}`;
    $("#week-prev").disabled = currentMonday <= earliestHistoryMonday();

    const today = todayStr();
    const todayPct = dayPercent(today) || 0;
    const openTasks = allTasks().filter((task) => !task.done).length;
    const todayCounts = dayCounts(today);
    $("#welcome-kicker").textContent = "Übersicht";
    $("#welcome-title").textContent = "Heute";
    $("#welcome-copy").textContent = `${todayCounts.done}/${todayCounts.total} Gewohnheiten · ${openTasks} offene ${openTasks === 1 ? "Aufgabe" : "Aufgaben"}`;
    $("#welcome-score").textContent = todayPct + "%";

    // Tagesstreifen
    const strip = days.map((d) => {
      const ds = dateStr(d);
      const pct = dayPercent(ds);
      const future = ds > today;
      const cls = ["day-cell"];
      if (ds === selectedDate) cls.push("is-selected");
      if (ds === today) cls.push("is-today");
      if (future) cls.push("is-future");
      if (pct === 100) cls.push("is-full");
      return `<button class="${cls.join(" ")}" data-date="${ds}" ${future ? "disabled" : ""}>
        <span class="day-cell__wd">${WD[(d.getDay() + 6) % 7]}</span>
        <span class="day-cell__num">${d.getDate()}</span>
        <span class="day-cell__bar"><i style="width:${pct == null ? 0 : pct}%"></i></span>
      </button>`;
    }).join("");
    $("#day-strip").innerHTML = strip;

    // Tagespanel
    const sel = parseDate(selectedDate);
    const isTodaySel = selectedDate === today;
    const locked = selectedDate > today;
    const pct = dayPercent(selectedDate);
    const { done, total } = dayCounts(selectedDate);
    $("#day-ring").innerHTML = ringSVG(pct) + `<span class="ring__label">${pct == null ? "–" : pct + "%"}</span>`;
    $("#day-title").textContent = isTodaySel ? "Heute" : `${WD[(sel.getDay() + 6) % 7]}, ${fmtDM(sel)}`;
    $("#day-count").textContent = `${done} / ${total} erledigt`;

    const daily = dailyHabits();
    $("#habit-list").innerHTML = daily.length
      ? daily.map((h) => {
          const dn = isToggle(selectedDate, h.id);
          return `<li class="habit-item ${dn ? "is-done" : ""} ${locked ? "is-locked" : ""}" data-habit="${h.id}">
            <span class="habit-item__emoji">${escapeHtml(h.emoji || "•")}</span>
            <span class="habit-item__name">${escapeHtml(h.name)}</span>
            <span class="check">${CHECK_SVG}</span>
          </li>`;
        }).join("")
      : `<p class="empty-hint">Noch keine täglichen Gewohnheiten.<br>Tippe oben rechts auf ⚙︎, um welche hinzuzufügen.</p>`;

    // Wochenziele
    const weekly = weeklyHabits();
    const wc = $("#weekly-card");
    if (weekly.length) {
      wc.hidden = false;
      $("#weekly-list").innerHTML = weekly.map((h) => {
        const dcount = weeklyDone(h, currentMonday);
        const met = dcount >= h.target;
        const cells = days.map((d, i) => {
          const ds = dateStr(d);
          const on = isToggle(ds, h.id);
          const fut = ds > today;
          return `<button class="wd-cell ${on ? "is-done" : ""} ${fut ? "is-future" : ""}"
            data-wd-habit="${h.id}" data-date="${ds}" ${fut ? "disabled" : ""}>${WD[i]}</button>`;
        }).join("");
        return `<div class="weekly-item">
          <div class="weekly-item__top">
            <span class="weekly-item__emoji">${escapeHtml(h.emoji || "•")}</span>
            <span class="weekly-item__name">${escapeHtml(h.name)}</span>
            <span class="weekly-item__prog ${met ? "is-met" : ""}">${dcount}/${h.target}${met ? " ✓" : ""}</span>
          </div>
          <div class="weekly-days">${cells}</div>
        </div>`;
      }).join("");
    } else {
      wc.hidden = true;
    }

    // Analyse
    renderTrend();

    // App-Bar Untertitel
    $("#appbar-sub").textContent = wn > 0 ? "Woche " + wn : "Dein Rückblick";
  }

  /* ---------- Rendern: Tasks ---------- */
  function renderTasks() {
    const openTotal = allTasks().filter((task) => !task.done).length;
    if (screen === "tasks") $("#appbar-sub").textContent = `${openTotal} offene ${openTotal === 1 ? "Aufgabe" : "Aufgaben"}`;
    $("#task-sections").innerHTML = state.taskSections.map((section) => {
      const arr = state.tasks[section.id] || [];
      const open = arr.filter((task) => !task.done).length;
      return `<section class="card task-section" data-section-id="${section.id}">
        <div class="task-section__head"><div><h2>${escapeHtml(section.name)}</h2><span>${open} offen</span></div><button data-section-edit="${section.id}" aria-label="Block bearbeiten">•••</button></div>
        <ol class="task-list">${arr.length ? arr.map((task, index) => `<li class="task ${task.done ? "is-done" : ""}" data-task-id="${task.id}">
          <span class="task__number">${index + 1}</span>
          <button class="check task__check" data-task-action="toggle" aria-label="${task.done ? "Als offen markieren" : "Als erledigt markieren"}">${CHECK_SVG}</button>
          <button class="task__content" data-task-action="edit"><span class="task__text">${escapeHtml(task.text)}</span>${task.dueDate ? `<span class="task__date ${task.dueDate < todayStr() && !task.done ? "is-overdue" : ""}">${formatLongDate(task.dueDate)}</span>` : `<span class="task__date is-none">Ohne Datum</span>`}</button>
          <button class="task__archive" data-task-action="archive" aria-label="Archivieren">↓</button>
        </li>`).join("") : `<li class="task-empty">Noch keine Aufgaben</li>`}</ol>
        <button class="section-add" data-add-to-section="${section.id}">＋ Aufgabe</button>
      </section>`;
    }).join("");

    $("#archive-count").textContent = state.archivedTasks.length;
    $("#archive-list").hidden = !archiveExpanded;
    $("#toggle-archive").classList.toggle("is-open", archiveExpanded);
    $("#archive-list").innerHTML = state.archivedTasks.length ? state.archivedTasks.map((task) => `<div class="archived-task" data-archived-id="${task.id}"><span>${escapeHtml(task.text)}</span><button data-restore-task="${task.id}">Wiederherstellen</button><button data-delete-archived="${task.id}" aria-label="Endgültig löschen">✕</button></div>`).join("") : `<p class="task-empty">Das Archiv ist leer</p>`;
  }

  function formatLongDate(ds) {
    const d = parseDate(ds);
    return `${WD[(d.getDay() + 6) % 7]}, ${d.getDate()}. ${MONTHS[d.getMonth()].slice(0, 3)}`;
  }

  function calendarItemsFor(ds) {
    const events = state.events.filter((event) => event.date === ds).map((event) => ({ ...event, kind: "event" }));
    const tasks = allTasks()
      .filter((task) => task.dueDate === ds)
      .map((task) => ({ id: task.id, title: task.text, date: task.dueDate, startTime: "", endTime: "", done: task.done, sectionId: task.sectionId, kind: "task" }));
    return [...events, ...tasks].sort((a, b) => (a.startTime || "99:99").localeCompare(b.startTime || "99:99"));
  }

  function renderCalendar() {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    $("#month-today").textContent = `${MONTHS[month]} ${year}`;
    if (screen === "calendar") $("#appbar-sub").textContent = `${MONTHS[month]} ${year}`;

    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const gridStart = addDays(first, -offset);
    const today = todayStr();
    const cells = Array.from({ length: 42 }, (_, index) => {
      const date = addDays(gridStart, index);
      const ds = dateStr(date);
      const items = calendarItemsFor(ds);
      const classes = ["calendar-day"];
      if (date.getMonth() !== month) classes.push("is-outside");
      if (ds === today) classes.push("is-today");
      if (ds === calendarSelected) classes.push("is-selected");
      return `<button class="${classes.join(" ")}" data-calendar-date="${ds}" aria-label="${date.getDate()}. ${MONTHS[date.getMonth()]} ${date.getFullYear()}">
        <span>${date.getDate()}</span>
        <i class="calendar-day__dots">${items.slice(0, 3).map((item) => `<b class="${item.kind === "task" ? "is-task" : ""}"></b>`).join("")}</i>
      </button>`;
    }).join("");
    $("#calendar-grid").innerHTML = cells;

    const selected = parseDate(calendarSelected);
    $("#agenda-title").textContent = calendarSelected === today ? "Heute" : `${WD[(selected.getDay() + 6) % 7]}, ${selected.getDate()}. ${MONTHS[selected.getMonth()]}`;
    const items = calendarItemsFor(calendarSelected);
    $("#agenda-list").innerHTML = items.length ? items.map((item) => {
      if (item.kind === "task") {
        return `<div class="agenda-item is-task ${item.done ? "is-done" : ""}">
          <span class="agenda-item__time">Task</span><span class="agenda-item__line"></span>
          <button class="agenda-item__content" data-edit-calendar-task="${item.id}"><strong>${escapeHtml(item.title)}</strong><small>${item.done ? "Erledigt" : "Fällig"}</small></button>
          <a class="agenda-item__google" href="${escapeHtml(googleCalendarUrl(item))}" target="_blank" rel="noopener" aria-label="In Google Kalender öffnen">G</a>
        </div>`;
      }
      return `<div class="agenda-item" data-event-id="${item.id}">
        <span class="agenda-item__time">${item.startTime && item.endTime ? `${item.startTime}–${item.endTime}` : "Ganztägig"}</span><span class="agenda-item__line"></span>
        <button class="agenda-item__content" data-edit-event="${item.id}"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.notes || "Momentum-Termin")}</small></button>
        <a class="agenda-item__google" href="${escapeHtml(googleCalendarUrl(item))}" target="_blank" rel="noopener" aria-label="In Google Kalender öffnen">G</a>
      </div>`;
    }).join("") : `<div class="agenda-empty"><span>☀️</span><strong>Noch nichts geplant</strong><small>Genieße den freien Raum oder füge einen Termin hinzu.</small></div>`;
  }

  function googleCalendarUrl(item) {
    const day = item.date.replaceAll("-", "");
    let dates;
    const startTime = item.startTime || item.time || "";
    const endTime = item.endTime || (startTime ? defaultEndTime(startTime) : "");
    if (startTime) {
      const start = `${day}T${startTime.replace(":", "")}00`;
      const end = `${day}T${endTime.replace(":", "")}00`;
      dates = `${start}/${end}`;
    } else {
      dates = `${day}/${dateStr(addDays(parseDate(item.date), 1)).replaceAll("-", "")}`;
    }
    const params = new URLSearchParams({ action: "TEMPLATE", text: item.title, dates, details: item.notes || "Erstellt mit Momentum" });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  /* ---------- Gesundheit ---------- */
  const healthField = (key) => HEALTH_FIELDS.find((field) => field.key === key) || HEALTH_FIELDS[0];
  const healthEntry = (ds) => state.health.entries[ds] || {};
  const healthFoods = (ds) => Array.isArray(healthEntry(ds).foods) ? healthEntry(ds).foods : [];
  const healthValue = (ds, key) => {
    if (key !== "steps") return healthFoods(ds).reduce((sum, food) => {
      const value = Number(food[key]);
      return sum + (Number.isFinite(value) && value >= 0 ? value : 0);
    }, 0);
    const value = Number(healthEntry(ds).steps);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };
  const healthRecorded = (ds, key) => key === "steps"
    ? Object.prototype.hasOwnProperty.call(healthEntry(ds), "steps")
    : healthFoods(ds).some((food) => Object.prototype.hasOwnProperty.call(food, key));
  const formatHealthNumber = (value) => Number(value || 0).toLocaleString("de-DE", { maximumFractionDigits: 1 });

  function healthTrendData() {
    const today = parseDate(todayStr());
    const selected = parseDate(healthSelected || todayStr());
    const reference = selected > today ? today : selected;
    const metric = healthMetric;
    const dateSeries = (dates) => ({
      values: dates.map((date) => healthValue(dateStr(date), metric)),
      recorded: dates.map((date) => healthRecorded(dateStr(date), metric)),
    });
    if (healthRange === "start") {
      const start = parseDate(state.settings.startDate);
      const count = Math.max(1, Math.floor((today - start) / 864e5) + 1);
      const dates = Array.from({ length: count }, (_, index) => addDays(start, index));
      const labelPoints = new Set([0, Math.round((count - 1) * .25), Math.round((count - 1) * .5), Math.round((count - 1) * .75), count - 1]);
      return {
        ...dateSeries(dates),
        labels: dates.map((date, index) => labelPoints.has(index) ? `${date.getDate()}.${date.getMonth() + 1}.` : ""),
        caption: `seit ${fmtDM(start)}`,
      };
    }
    if (healthRange === "week") {
      const dates = weekDays(dateStr(mondayOf(reference))).filter((date) => date <= today);
      return {
        ...dateSeries(dates),
        labels: dates.map((date) => WD[(date.getDay() + 6) % 7]),
        caption: "in dieser Woche",
      };
    }
    if (healthRange === "month") {
      const dates = Array.from({ length: 30 }, (_, index) => addDays(reference, index - 29));
      const points = new Set([0, 7, 14, 21, 29]);
      return {
        ...dateSeries(dates),
        labels: dates.map((date, index) => points.has(index) ? `${date.getDate()}.${date.getMonth() + 1}.` : ""),
        caption: "in den letzten 30 Tagen",
      };
    }
    const months = Array.from({ length: 12 }, (_, index) => new Date(reference.getFullYear(), reference.getMonth() - 11 + index, 1));
    const monthSeries = months.map((monthStart) => {
      const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
      const cappedEnd = monthEnd > today ? today : monthEnd;
      if (monthStart > cappedEnd) return { value: 0, recorded: false };
      const count = Math.floor((cappedEnd - monthStart) / 864e5) + 1;
      const values = Array.from({ length: count }, (_, index) => addDays(monthStart, index))
        .filter((date) => healthRecorded(dateStr(date), metric))
        .map((date) => healthValue(dateStr(date), metric));
      return { value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0, recorded: values.length > 0 };
    });
    return {
      values: monthSeries.map((month) => month.value),
      recorded: monthSeries.map((month) => month.recorded),
      labels: months.map((date) => MONTHS[date.getMonth()].slice(0, 3)),
      caption: "im 12-Monats-Rückblick",
    };
  }

  function buildHealthChart(data, goal) {
    const W = 320, H = 150, padX = 7, padY = 13;
    const maxValue = Math.max(1, goal || 0, ...data.values) * 1.08;
    const denom = Math.max(1, data.values.length - 1);
    const points = data.values.map((value, index) => ({
      x: padX + (W - padX * 2) * (index / denom),
      y: padY + (H - padY * 2) * (1 - value / maxValue),
    }));
    const path = smoothPath(points);
    const base = H - padY;
    const area = points.length ? `${path} L${points[points.length - 1].x.toFixed(1)},${base} L${points[0].x.toFixed(1)},${base} Z` : "";
    const goalY = goal ? padY + (H - padY * 2) * (1 - goal / maxValue) : null;
    const last = points[points.length - 1];
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Gesundheitsverlauf">
      <defs><linearGradient id="healthArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--text)" stop-opacity=".18"/><stop offset="1" stop-color="var(--text)" stop-opacity="0"/></linearGradient></defs>
      <line x1="${padX}" y1="${padY}" x2="${W - padX}" y2="${padY}" class="trend-gridline"/>
      <line x1="${padX}" y1="${H / 2}" x2="${W - padX}" y2="${H / 2}" class="trend-gridline"/>
      <line x1="${padX}" y1="${base}" x2="${W - padX}" y2="${base}" class="trend-gridline"/>
      ${goalY != null ? `<line x1="${padX}" y1="${goalY.toFixed(1)}" x2="${W - padX}" y2="${goalY.toFixed(1)}" class="health-goal-line"/>` : ""}
      <path d="${area}" fill="url(#healthArea)"/>
      <path d="${path}" fill="none" stroke="var(--text)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
      ${last ? `<circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="4.5" fill="var(--surface)" stroke="var(--text)" stroke-width="2.5"/>` : ""}
    </svg>`;
  }

  function renderHealth() {
    const today = todayStr();
    const earliest = dateStr(addDays(new Date(), -370));
    const selected = parseDate(healthSelected);
    const entry = healthEntry(healthSelected);
    const foods = [...healthFoods(healthSelected)].sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99") || (a.createdAt || 0) - (b.createdAt || 0));
    $("#health-date").value = healthSelected;
    $("#health-date").max = today;
    $("#health-date").min = earliest;
    $("#health-prev").disabled = healthSelected <= earliest;
    $("#health-next").disabled = healthSelected >= today;
    $("#health-day-title").textContent = healthSelected === today ? "Heute" : `${WD[(selected.getDay() + 6) % 7]}, ${selected.getDate()}. ${MONTHS[selected.getMonth()]}`;
    $("#health-day-summary").textContent = foods.length ? `${foods.length} ${foods.length === 1 ? "Eintrag" : "Einträge"} · ${formatHealthNumber(healthValue(healthSelected, "calories"))} kcal` : "Noch kein Essen eingetragen";
    $("#health-fields").innerHTML = HEALTH_FIELDS.map((field) => {
      const value = healthValue(healthSelected, field.key);
      const goal = state.health.goals[field.key] || 0;
      const pct = goal ? Math.min(100, Math.round((value / goal) * 100)) : 0;
      const goalText = goal ? `${formatHealthNumber(value)} / ${formatHealthNumber(goal)} ${field.unit}`.trim() : "Kein Ziel gesetzt";
      const valueMarkup = field.key === "steps"
        ? `<span class="health-field__value"><input type="number" min="0" step="1" inputmode="numeric" autocomplete="off" name="momentum-health-steps" data-health-field="steps" value="${entry.steps ?? ""}" placeholder="0"><b>${field.unit}</b></span>`
        : `<span class="health-field__value health-field__value--total"><strong>${formatHealthNumber(value)}</strong><b>${field.unit}</b></span>`;
      return `<label class="health-field health-field--${field.key}">
        <span class="health-field__label">${field.label}</span>
        ${valueMarkup}
        <span class="health-field__goal">${goalText}</span>
        <i><em style="width:${pct}%"></em></i>
      </label>`;
    }).join("");
    $("#health-food-table").innerHTML = foods.length ? `<div class="health-food-table-wrap"><table class="health-food-table">
      <thead><tr><th>Essen</th><th>kcal</th><th>E</th><th>KH</th><th>F</th><th></th></tr></thead>
      <tbody>${foods.map((food) => `<tr>
        <td><button class="health-food-name" data-edit-health-food="${food.id}"><strong>${escapeHtml(food.name)}</strong><small>${food.time || "Ohne Uhrzeit"}</small></button></td>
        <td>${formatHealthNumber(food.calories)}</td><td>${formatHealthNumber(food.protein)}</td><td>${formatHealthNumber(food.carbs)}</td><td>${formatHealthNumber(food.fat)}</td>
        <td><button class="health-food-edit" data-edit-health-food="${food.id}" aria-label="${escapeHtml(food.name)} bearbeiten">•••</button></td>
      </tr>`).join("")}</tbody>
      <tfoot><tr><th>Gesamt</th><th>${formatHealthNumber(healthValue(healthSelected, "calories"))}</th><th>${formatHealthNumber(healthValue(healthSelected, "protein"))}</th><th>${formatHealthNumber(healthValue(healthSelected, "carbs"))}</th><th>${formatHealthNumber(healthValue(healthSelected, "fat"))}</th><th></th></tr></tfoot>
    </table></div>` : `<div class="health-food-empty"><strong>Noch nichts eingetragen</strong><span>Füge eine Mahlzeit, einen Snack oder zum Beispiel einen Proteinshake hinzu.</span></div>`;
    $("#health-metric").querySelectorAll("button").forEach((button) => button.classList.toggle("is-active", button.dataset.healthMetric === healthMetric));
    $("#health-range").querySelectorAll("button").forEach((button) => button.classList.toggle("is-active", button.dataset.healthRange === healthRange));
    const field = healthField(healthMetric);
    const data = healthTrendData();
    const recordedValues = data.values.filter((_, index) => data.recorded[index]);
    const average = recordedValues.length ? recordedValues.reduce((sum, value) => sum + value, 0) / recordedValues.length : 0;
    $("#health-trend-label").textContent = field.label;
    $("#health-trend-value").textContent = `${formatHealthNumber(average)}${field.unit ? " " + field.unit : ""}`;
    $("#health-trend-caption").textContent = data.caption;
    $("#health-chart").innerHTML = buildHealthChart(data, state.health.goals[healthMetric] || 0);
    const labelIndexes = healthRange === "week" ? data.labels.map((_, index) => index) : data.labels.map((label, index) => label ? index : -1).filter((index) => index >= 0);
    $("#health-axis").innerHTML = labelIndexes.map((index) => `<span style="left:${data.labels.length <= 1 ? 0 : (index / (data.labels.length - 1)) * 100}%">${data.labels[index]}</span>`).join("");
    const historyDates = Object.keys(state.health.entries)
      .filter((date) => date <= today && (healthFoods(date).length || healthRecorded(date, "steps")))
      .sort().reverse().slice(0, 8);
    $("#health-day-history").innerHTML = historyDates.length ? historyDates.map((date) => `<button data-health-history-date="${date}" class="health-history-row ${date === healthSelected ? "is-active" : ""}">
      <span><strong>${date === today ? "Heute" : formatLongDate(date)}</strong><small>${healthFoods(date).length} ${healthFoods(date).length === 1 ? "Eintrag" : "Einträge"}</small></span>
      <span><b>${formatHealthNumber(healthValue(date, "calories"))} kcal</b><small>E ${formatHealthNumber(healthValue(date, "protein"))} · KH ${formatHealthNumber(healthValue(date, "carbs"))} · F ${formatHealthNumber(healthValue(date, "fat"))}</small></span>
    </button>`).join("") : `<p class="health-history-empty">Deine vergangenen Tage erscheinen hier, sobald du etwas eingetragen hast.</p>`;
    if (screen === "health") $("#appbar-sub").textContent = healthSelected === today ? "Dein Tagesstand" : formatLongDate(healthSelected);
  }

  function openHealthFoodEditor(food) {
    const isNew = !food;
    const now = new Date();
    const item = food || { name: "", time: healthSelected === todayStr() ? `${pad(now.getHours())}:${pad(now.getMinutes())}` : "", calories: "", protein: "", carbs: "", fat: "" };
    const sheet = openSheet(`
      <div class="sheet__head"><div><span class="sheet__eyebrow">${formatLongDate(healthSelected)}</span><div class="sheet__title">${isNew ? "Essen eintragen" : "Eintrag bearbeiten"}</div></div><button class="sheet__close" data-close>Abbrechen</button></div>
      <div class="field"><label for="food-name">Mahlzeit oder Lebensmittel</label><input class="input" id="food-name" maxlength="80" value="${escapeHtml(item.name || "")}" placeholder="z. B. Frühstück oder Proteinshake" autocomplete="off"></div>
      <div class="field"><label for="food-time">Uhrzeit (optional)</label><input class="input" id="food-time" type="time" value="${escapeHtml(item.time || "")}"></div>
      <div class="health-food-fields">
        <label class="field"><span>Kalorien (kcal)</span><input class="input" id="food-calories" type="number" min="0" step="1" inputmode="decimal" value="${item.calories ?? ""}" placeholder="0"></label>
        <label class="field"><span>Eiweiß (g)</span><input class="input" id="food-protein" type="number" min="0" step="0.1" inputmode="decimal" value="${item.protein ?? ""}" placeholder="0"></label>
        <label class="field"><span>Kohlenhydrate (g)</span><input class="input" id="food-carbs" type="number" min="0" step="0.1" inputmode="decimal" value="${item.carbs ?? ""}" placeholder="0"></label>
        <label class="field"><span>Fett (g)</span><input class="input" id="food-fat" type="number" min="0" step="0.1" inputmode="decimal" value="${item.fat ?? ""}" placeholder="0"></label>
      </div>
      <p class="field-hint">Du kannst auch nur einen Wert eintragen, zum Beispiel 30 g Eiweiß für einen Shake.</p>
      <button class="btn" id="save-health-food">${isNew ? "Hinzufügen" : "Änderungen speichern"}</button>
      ${isNew ? "" : `<button class="btn btn--danger" id="delete-health-food">Eintrag löschen</button>`}`);
    sheet.querySelector("[data-close]").onclick = closeSheet;
    sheet.querySelector("#save-health-food").onclick = () => {
      const foodItem = {
        id: item.id || uid(),
        name: sheet.querySelector("#food-name").value.trim() || "Eintrag",
        time: sheet.querySelector("#food-time").value,
        createdAt: item.createdAt || Date.now(),
      };
      NUTRITION_FIELDS.forEach((field) => {
        const input = sheet.querySelector(`#food-${field.key}`);
        if (input.value !== "") {
          const value = Number(input.value);
          foodItem[field.key] = Number.isFinite(value) && value >= 0 ? value : 0;
        }
      });
      if (!NUTRITION_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(foodItem, field.key))) {
        toast("Trage mindestens einen Wert ein");
        return;
      }
      const day = { ...healthEntry(healthSelected), foods: [...healthFoods(healthSelected)] };
      const existingIndex = day.foods.findIndex((entryFood) => entryFood.id === foodItem.id);
      if (existingIndex >= 0) day.foods[existingIndex] = foodItem;
      else day.foods.push(foodItem);
      state.health.entries[healthSelected] = day;
      save(); closeSheet(); renderHealth(); toast(isNew ? "Eintrag hinzugefügt" : "Eintrag gespeichert");
    };
    if (!isNew) sheet.querySelector("#delete-health-food").onclick = () => {
      const day = { ...healthEntry(healthSelected), foods: healthFoods(healthSelected).filter((entryFood) => entryFood.id !== item.id) };
      if (!day.foods.length) delete day.foods;
      if (Object.keys(day).length) state.health.entries[healthSelected] = day;
      else delete state.health.entries[healthSelected];
      save(); closeSheet(); renderHealth(); toast("Eintrag gelöscht");
    };
  }

  function openHealthGoals() {
    const sheet = openSheet(`
      <div class="sheet__head"><div><span class="sheet__eyebrow">Gesundheit</span><div class="sheet__title">Deine Tagesziele</div></div><button class="sheet__close" data-close>Abbrechen</button></div>
      <p class="field-hint" style="margin:0 0 14px">Lege deine Werte selbst fest. Sie dienen nur deiner persönlichen Übersicht und sind keine medizinische Empfehlung.</p>
      <div class="health-goal-fields">${HEALTH_FIELDS.map((field) => `<label class="field"><span>${field.label}${field.unit ? ` (${field.unit})` : ""}</span><input class="input" type="number" min="0" step="1" inputmode="decimal" autocomplete="off" data-health-goal="${field.key}" value="${state.health.goals[field.key] || ""}" placeholder="Kein Ziel"></label>`).join("")}</div>
      <button class="btn" id="save-health-goals">Ziele speichern</button>`);
    sheet.querySelector("[data-close]").onclick = closeSheet;
    sheet.querySelector("#save-health-goals").onclick = () => {
      sheet.querySelectorAll("[data-health-goal]").forEach((input) => {
        const value = Number(input.value);
        state.health.goals[input.dataset.healthGoal] = Number.isFinite(value) && value > 0 ? value : 0;
      });
      save(); closeSheet(); renderHealth(); toast("Gesundheitsziele gespeichert");
    };
  }

  function render() {
    if (screen === "habits") renderHabits();
    else if (screen === "tasks") renderTasks();
    else if (screen === "calendar") renderCalendar();
    else renderHealth();
  }

  /* ---------- Screen-Wechsel ---------- */
  function switchScreen(name) {
    screen = name;
    $("#screen-habits").hidden = name !== "habits";
    $("#screen-tasks").hidden = name !== "tasks";
    $("#screen-calendar").hidden = name !== "calendar";
    $("#screen-health").hidden = name !== "health";
    const titles = { habits: "Momentum", tasks: "Aufgaben", calendar: "Kalender", health: "Gesundheit" };
    $("#appbar-title").textContent = titles[name];
    const wn = weekNumber(currentMonday);
    const openTasks = allTasks().filter((task) => !task.done).length;
    $("#appbar-sub").textContent = name === "habits" ? (wn > 0 ? "Woche " + wn : "Rückblick") : name === "calendar" ? `${MONTHS[calendarMonth.getMonth()]} ${calendarMonth.getFullYear()}` : name === "health" ? "Dein Tagesstand" : `${openTasks} offene ${openTasks === 1 ? "Aufgabe" : "Aufgaben"}`;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.screen === name));
    render();
    window.scrollTo({ top: 0 });
  }

  /* ---------- Konto & Cloud ---------- */
  let authMode = "login";

  function setCloudStatus(label) {
    cloudSyncLabel = label;
    const el = document.querySelector("#sync-state");
    if (el) el.textContent = label;
  }

  function scheduleCloudSave() {
    if (!cloudUser || !window.MomentumCloud?.available) return;
    setCloudStatus("Änderungen werden gespeichert …");
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(flushCloudState, 650);
  }

  async function flushCloudState() {
    if (!cloudUser || !window.MomentumCloud?.available) return;
    clearTimeout(cloudSyncTimer);
    cloudSaveRequested = true;
    if (cloudSaveInFlight) return cloudSaveInFlight;

    cloudSaveInFlight = (async () => {
      try {
        do {
          cloudSaveRequested = false;
          const userId = cloudUser?.id;
          if (!userId) break;
          const snapshot = cloneState(state);
          const revision = stateRevision(snapshot);
          setCloudStatus("Synchronisiert …");
          await window.MomentumCloud.saveState(userId, snapshot);
          if (cloudUser?.id === userId && stateRevision(state) > revision) cloudSaveRequested = true;
        } while (cloudSaveRequested);
        if (cloudUser) setCloudStatus(`Synchronisiert · ${new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`);
      } catch (error) {
        console.warn("Cloud-Synchronisierung pausiert", error);
        cloudSaveRequested = false;
        setCloudStatus(navigator.onLine ? "Synchronisierung fehlgeschlagen – neuer Versuch folgt" : "Offline – wird später synchronisiert");
        if (navigator.onLine) cloudSyncTimer = setTimeout(flushCloudState, 5000);
      } finally {
        cloudSaveInFlight = null;
      }
    })();
    return cloudSaveInFlight;
  }

  function resetViewState() {
    applyTheme();
    currentMonday = dateStr(mondayOf(new Date()));
    if (parseDate(currentMonday) < parseDate(state.settings.startMonday)) currentMonday = state.settings.startMonday;
    selectedDate = defaultSelectedFor(currentMonday);
    const now = new Date();
    calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    calendarSelected = todayStr();
    healthSelected = todayStr();
  }

  function setAuthMessage(message, isError) {
    const el = $("#auth-message");
    el.textContent = message || "";
    el.classList.toggle("is-error", !!isError);
  }

  function setAuthMode(mode) {
    authMode = mode;
    const registering = mode === "register";
    $("#auth-name-field").hidden = !registering;
    $("#auth-title").textContent = registering ? "Konto erstellen" : "Willkommen zurück";
    $("#auth-copy").textContent = registering ? "Deine Daten werden sicher getrennt und auf deinen Geräten synchronisiert." : "Melde dich an, damit dein Stand auf allen Geräten gleich bleibt.";
    $("#auth-submit").textContent = registering ? "Konto erstellen" : "Anmelden";
    $("#auth-forgot").hidden = registering;
    $("#auth-password").setAttribute("autocomplete", registering ? "new-password" : "current-password");
    document.querySelectorAll("[data-auth-mode]").forEach((button) => button.classList.toggle("is-active", button.dataset.authMode === mode));
    setAuthMessage("");
  }

  function showAuth(message, isError) {
    $("#app").hidden = true;
    $("#auth-screen").hidden = false;
    setAuthMessage(message || "", isError);
  }

  function showApp() {
    $("#auth-screen").hidden = true;
    $("#app").hidden = false;
  }

  function friendlyAuthError(error) {
    const message = String(error?.message || error || "Unbekannter Fehler");
    if (/invalid login credentials/i.test(message)) return "E-Mail oder Passwort stimmt nicht.";
    if (/already registered|already been registered/i.test(message)) return "Für diese E-Mail gibt es bereits ein Konto.";
    if (/password/i.test(message) && /least|short|characters/i.test(message)) return "Das Passwort muss mindestens 8 Zeichen lang sein.";
    if (/email/i.test(message) && /invalid/i.test(message)) return "Bitte gib eine gültige E-Mail-Adresse ein.";
    return message;
  }

  async function activateSession(user) {
    if (!user || activatingUserId === user.id) return;
    activatingUserId = user.id;
    showAuth("Dein Stand wird geladen …");
    try {
      cloudProfile = await window.MomentumCloud.profile(user.id);
      if (cloudProfile.status === "blocked") {
        await window.MomentumCloud.signOut();
        throw new Error("Dieses Konto ist gesperrt.");
      }
      cloudProfile = await window.MomentumCloud.touchProfile(user.id);
      const remote = await window.MomentumCloud.loadState(user.id);
      const remoteRawState = remote?.state && Object.keys(remote.state).length ? remote.state : null;
      let repairedDuplicateHabits = stateHasDuplicateHabits(remoteRawState);
      const remoteState = remoteRawState ? normalizeState(remoteRawState) : null;
      const accountLocalRaw = loadUserLocal(user.id);
      repairedDuplicateHabits ||= stateHasDuplicateHabits(accountLocalRaw);
      const accountLocal = accountLocalRaw ? normalizeState(accountLocalRaw) : null;
      const legacyOwner = localStorage.getItem(LEGACY_OWNER_KEY);
      let legacyLocalRaw = null;
      let legacyLocal = null;
      if ((!legacyOwner || legacyOwner === user.id) && localStorage.getItem(KEY)) {
        try {
          legacyLocalRaw = JSON.parse(localStorage.getItem(KEY));
          repairedDuplicateHabits ||= stateHasDuplicateHabits(legacyLocalRaw);
          legacyLocal = normalizeState(legacyLocalRaw);
        } catch (_error) { legacyLocalRaw = null; legacyLocal = null; }
      }
      let localState = accountLocal;
      if (legacyLocal && accountLocal) {
        if (!stateRevision(legacyLocal) || !stateRevision(accountLocal)) {
          repairedDuplicateHabits ||= stateHasDuplicateHabits({ habits: [...legacyLocal.habits, ...accountLocal.habits] });
          localState = mergeLegacyStates(legacyLocal, accountLocal);
        }
        else localState = stateRevision(accountLocal) >= stateRevision(legacyLocal) ? accountLocal : legacyLocal;
      } else if (legacyLocal) localState = legacyLocal;

      let shouldUpload = false;
      if (remoteState && localState) {
        const remoteRevision = stateRevision(remoteState);
        const localRevision = stateRevision(localState);
        if (!remoteRevision || !localRevision) {
          repairedDuplicateHabits ||= stateHasDuplicateHabits({ habits: [...remoteState.habits, ...localState.habits] });
          state = localRevision >= remoteRevision ? mergeLegacyStates(remoteState, localState) : mergeLegacyStates(localState, remoteState);
          shouldUpload = true;
        } else if (localRevision > remoteRevision) {
          state = localState;
          shouldUpload = true;
        } else {
          state = remoteState;
        }
      } else if (localState) {
        state = localState;
        shouldUpload = true;
      } else if (remoteState) {
        state = remoteState;
      } else {
        state = legacyOwner && legacyOwner !== user.id ? seedState() : normalizeState(state);
        shouldUpload = true;
      }
      if (repairedDuplicateHabits) {
        state.meta.updatedAt = Math.max(Date.now(), stateRevision(state) + 1);
        shouldUpload = true;
      }
      cloudUser = user;
      localStorage.setItem(userStorageKey(user.id), JSON.stringify(state));
      if (shouldUpload) await window.MomentumCloud.saveState(user.id, cloneState(state));
      if (!localStorage.getItem(LEGACY_OWNER_KEY)) localStorage.setItem(LEGACY_OWNER_KEY, user.id);
      cloudIsAdmin = await window.MomentumCloud.isAdmin();
      setCloudStatus("Synchronisiert");
      resetViewState();
      showApp();
      switchScreen("habits");
      if (repairedDuplicateHabits) toast("Doppelte Gewohnheiten wurden zusammengeführt");
    } catch (error) {
      console.error("Konto konnte nicht geladen werden", error);
      cloudUser = null; cloudProfile = null; cloudIsAdmin = false;
      showAuth(friendlyAuthError(error), true);
    } finally {
      activatingUserId = null;
    }
  }

  function bindAuthEvents() {
    document.querySelectorAll("[data-auth-mode]").forEach((button) => {
      button.onclick = () => setAuthMode(button.dataset.authMode);
    });
    $("#auth-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = $("#auth-email").value.trim().toLowerCase();
      const password = $("#auth-password").value;
      const displayName = $("#auth-name").value.trim();
      if (authMode === "register" && !displayName) { setAuthMessage("Bitte gib einen Anzeigenamen ein.", true); return; }
      $("#auth-submit").disabled = true;
      setAuthMessage(authMode === "register" ? "Konto wird erstellt …" : "Anmeldung läuft …");
      try {
        if (authMode === "register") {
          const result = await window.MomentumCloud.signUp(email, password, displayName);
          if (result.session) await activateSession(result.user);
          else setAuthMessage("Fast fertig: Bitte bestätige die E-Mail von Supabase und melde dich danach an.");
        } else {
          const result = await window.MomentumCloud.signIn(email, password);
          await activateSession(result.user);
        }
      } catch (error) {
        setAuthMessage(friendlyAuthError(error), true);
      } finally {
        $("#auth-submit").disabled = false;
      }
    });
    $("#auth-forgot").onclick = async () => {
      const email = $("#auth-email").value.trim().toLowerCase();
      if (!email) { setAuthMessage("Trage zuerst deine E-Mail-Adresse ein.", true); return; }
      try {
        await window.MomentumCloud.sendPasswordReset(email);
        setAuthMessage("Die E-Mail zum Zurücksetzen wurde verschickt.");
      } catch (error) { setAuthMessage(friendlyAuthError(error), true); }
    };
  }

  async function initCloud() {
    if (!window.MomentumCloud?.available) {
      showAuth(window.MomentumCloud?.error || "Die Cloud-Verbindung ist gerade nicht erreichbar.", true);
      return;
    }
    window.MomentumCloud.onAuthChange((session) => {
      if (!session) {
        cloudUser = null; cloudProfile = null; cloudIsAdmin = false;
        showAuth();
      } else if (cloudUser?.id !== session.user.id) activateSession(session.user);
    });
    try {
      const session = await window.MomentumCloud.session();
      if (session) await activateSession(session.user);
      else showAuth();
    } catch (error) { showAuth(friendlyAuthError(error), true); }
  }

  async function openAdminUsers() {
    if (!cloudIsAdmin) return;
    let refreshTimer = null;
    const sheet = openSheet(`
      <div class="sheet__head"><div><span class="sheet__eyebrow">Admin</span><div class="sheet__title">Benutzerkonten</div></div><button class="sheet__close" data-close>Fertig</button></div>
      <div class="admin-toolbar"><span id="admin-count">Konten werden geladen …</span><button class="text-btn" id="admin-refresh">↻ Aktualisieren</button></div>
      <div id="admin-list" class="admin-list"><p class="admin-empty">Konten werden geladen …</p></div>`);
    const refreshButton = sheet.querySelector("#admin-refresh");
    const loadProfiles = async (showLoading) => {
      if (!sheet.isConnected) return;
      refreshButton.disabled = true;
      if (showLoading) refreshButton.textContent = "Wird geladen …";
      try {
        const profiles = await window.MomentumCloud.listProfiles();
        if (!sheet.isConnected) return;
        sheet.querySelector("#admin-count").textContent = `${profiles.length} ${profiles.length === 1 ? "Konto" : "Konten"}`;
        sheet.querySelector("#admin-list").innerHTML = profiles.length ? profiles.map((profile) => `
          <div class="admin-user">
            <div class="admin-user__top"><strong>${escapeHtml(profile.display_name)}</strong><span class="admin-user__status">${profile.status === "active" ? "Aktiv" : "Gesperrt"}</span></div>
            <small>${escapeHtml(profile.email)}</small>
            <small>Registriert: ${new Date(profile.created_at).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</small>
            <small>Letzte Aktivität: ${new Date(profile.last_seen_at).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</small>
          </div>`).join("") : `<p class="admin-empty">Noch keine Konten vorhanden.</p>`;
      } catch (error) {
        if (!sheet.isConnected) return;
        sheet.querySelector("#admin-count").textContent = "Verbindung unterbrochen";
        sheet.querySelector("#admin-list").innerHTML = `<p class="admin-empty">Konten konnten nicht geladen werden.</p>`;
      } finally {
        if (sheet.isConnected) {
          refreshButton.disabled = false;
          refreshButton.textContent = "↻ Aktualisieren";
        }
      }
    };
    const scheduleRefresh = () => {
      refreshTimer = setTimeout(async () => {
        if (!sheet.isConnected) return;
        await loadProfiles(false);
        scheduleRefresh();
      }, 5000);
    };
    sheet.querySelector("[data-close]").onclick = () => { clearTimeout(refreshTimer); closeSheet(); };
    refreshButton.onclick = () => loadProfiles(true);
    await loadProfiles(false);
    scheduleRefresh();
  }

  /* ---------- Theme ---------- */
  function applyTheme() {
    const t = state.settings.theme;
    const dark = t === "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute("content", dark ? "#000000" : "#f6f6f4");
  }

  /* ---------- Helfer ---------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  let toastTimer;
  function toast(msg) {
    let el = $(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg;
    requestAnimationFrame(() => el.classList.add("is-show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-show"), 1600);
  }

  /* ============================================================
     Modals / Sheets
     ============================================================ */
  function openSheet(html) {
    const root = $("#modal-root");
    root.innerHTML = `<div class="modal-backdrop"><div class="sheet"><div class="sheet__grip"></div>${html}</div></div>`;
    const bd = root.querySelector(".modal-backdrop");
    bd.addEventListener("click", (e) => { if (e.target === bd) closeSheet(); });
    return root.querySelector(".sheet");
  }
  function closeSheet() { $("#modal-root").innerHTML = ""; }

  function archiveTask(id) {
    const found = findTask(id); if (!found) return;
    found.arr.splice(found.arr.indexOf(found.task), 1);
    state.archivedTasks.unshift({ ...found.task, sectionId: found.section.id, archivedAt: Date.now() });
    save(); renderTasks(); if (screen === "calendar") renderCalendar(); toast("Ins Archiv verschoben");
  }

  function openTaskEditor(task, prefillDate, preferredSectionId) {
    const found = task ? findTask(task.id) : null;
    const originalSectionId = found ? found.section.id : (preferredSectionId || state.taskSections[0].id);
    const item = task || { id: uid(), text: "", dueDate: prefillDate || "", done: false, createdAt: Date.now() };
    const sheet = openSheet(`
      <div class="sheet__head"><div class="sheet__title">${task ? "Aufgabe bearbeiten" : "Neue Aufgabe"}</div><button class="sheet__close" data-close>Abbrechen</button></div>
      <div class="field"><label for="task-title">Aufgabe</label><input class="input" id="task-title" name="momentum-task-title" maxlength="140" value="${escapeHtml(item.text)}" placeholder="Was möchtest du erledigen?" autocomplete="off" autocorrect="off" spellcheck="false"></div>
      <div class="field"><label for="task-section">Block</label><select class="select" id="task-section">${state.taskSections.map((section) => `<option value="${section.id}" ${section.id === originalSectionId ? "selected" : ""}>${escapeHtml(section.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="task-date">Datum (optional)</label><input class="input" id="task-date" type="date" value="${item.dueDate || ""}"><p class="field-hint">Ohne Datum bleibt die Aufgabe nur in der Taskliste. Mit Datum erscheint sie zusätzlich im Kalender.</p></div>
      <button class="btn" id="task-save">${task ? "Speichern" : "Aufgabe hinzufügen"}</button>
      ${task && item.dueDate ? `<a class="btn btn--google" href="${escapeHtml(googleCalendarUrl({ title: item.text, date: item.dueDate, startTime: "", endTime: "", notes: "Momentum-Aufgabe" }))}" target="_blank" rel="noopener">In Google Kalender öffnen</a>` : ""}
      ${task ? `<div class="btn-row"><button class="btn btn--ghost" id="task-archive">Archivieren</button><button class="btn btn--danger" id="task-delete">Löschen</button></div>` : ""}
    `);
    sheet.querySelector("[data-close]").onclick = closeSheet;
    sheet.querySelector("#task-save").onclick = () => {
      const text = sheet.querySelector("#task-title").value.trim();
      if (!text) { toast("Bitte eine Aufgabe eingeben"); return; }
      const sectionId = sheet.querySelector("#task-section").value;
      item.text = text; item.dueDate = sheet.querySelector("#task-date").value || "";
      if (!task) state.tasks[sectionId].push(item);
      else if (sectionId !== originalSectionId) {
        found.arr.splice(found.arr.indexOf(found.task), 1);
        state.tasks[sectionId].push(item);
      }
      save(); closeSheet(); renderTasks(); if (screen === "calendar") renderCalendar(); toast(task ? "Aufgabe gespeichert" : "Aufgabe hinzugefügt");
    };
    const archive = sheet.querySelector("#task-archive");
    if (archive) archive.onclick = () => { closeSheet(); archiveTask(item.id); };
    const del = sheet.querySelector("#task-delete");
    if (del) del.onclick = () => {
      if (!confirm(`„${item.text}" wirklich löschen?`)) return;
      found.arr.splice(found.arr.indexOf(found.task), 1); save(); closeSheet(); renderTasks(); if (screen === "calendar") renderCalendar(); toast("Aufgabe gelöscht");
    };
  }

  function openSectionEditor(section) {
    const sheet = openSheet(`
      <div class="sheet__head"><div class="sheet__title">${section ? "Block bearbeiten" : "Neuer Block"}</div><button class="sheet__close" data-close>Abbrechen</button></div>
      <div class="field"><label for="section-name">Bezeichnung</label><input class="input" id="section-name" name="momentum-section-title" maxlength="40" value="${escapeHtml(section ? section.name : "")}" placeholder="z. B. Arbeit, Privat oder Später" autocomplete="off" autocorrect="off" spellcheck="false"></div>
      <button class="btn" id="section-save">${section ? "Speichern" : "Block hinzufügen"}</button>
      ${section && state.taskSections.length > 1 ? `<button class="btn btn--danger" id="section-delete">Block löschen</button>` : ""}
    `);
    sheet.querySelector("[data-close]").onclick = closeSheet;
    sheet.querySelector("#section-save").onclick = () => {
      const name = sheet.querySelector("#section-name").value.trim(); if (!name) return;
      if (section) section.name = name;
      else { const id = "list_" + uid(); state.taskSections.push({ id, name }); state.tasks[id] = []; }
      save(); closeSheet(); renderTasks();
    };
    const del = sheet.querySelector("#section-delete");
    if (del) del.onclick = () => {
      if (!confirm(`Block „${section.name}" löschen? Die Aufgaben werden in den ersten anderen Block verschoben.`)) return;
      const fallback = state.taskSections.find((item) => item.id !== section.id);
      state.tasks[fallback.id].push(...(state.tasks[section.id] || []));
      delete state.tasks[section.id];
      state.taskSections = state.taskSections.filter((item) => item.id !== section.id);
      save(); closeSheet(); renderTasks();
    };
  }

  function openEventEditor(event) {
    const isNew = !event;
    const item = event || { id: uid(), title: "", date: calendarSelected || todayStr(), startTime: "09:00", endTime: "10:00", notes: "" };
    const startValue = item.startTime || item.time || "";
    const endValue = item.endTime || (startValue ? defaultEndTime(startValue) : "");
    const sheet = openSheet(`
      <div class="sheet__head">
        <div><span class="sheet__eyebrow">Kalender</span><div class="sheet__title">${isNew ? "Neuer Termin" : "Termin bearbeiten"}</div></div>
        <button class="sheet__close" data-close>Abbrechen</button>
      </div>
      <div class="event-accent"></div>
      <div class="field"><label for="event-title">Was steht an?</label><input class="input" id="event-title" name="momentum-event-title" maxlength="100" value="${escapeHtml(item.title)}" placeholder="z. B. Training oder Fokuszeit" autocomplete="off" autocorrect="off" spellcheck="false"></div>
      <div class="field"><label for="event-date">Datum</label><input class="input" id="event-date" type="date" value="${item.date}"></div>
      <div class="event-time-grid">
        <div class="field"><label for="event-start-time">Von</label><input class="input" id="event-start-time" type="time" value="${startValue}"></div>
        <div class="field"><label for="event-end-time">Bis</label><input class="input" id="event-end-time" type="time" value="${endValue}"></div>
      </div>
      <div class="field"><label for="event-notes">Notiz</label><textarea class="input input--textarea" id="event-notes" name="momentum-event-notes" maxlength="300" placeholder="Details, Ort oder Erinnerung" autocomplete="off" autocorrect="off" spellcheck="false">${escapeHtml(item.notes || "")}</textarea></div>
      <button class="btn" id="event-save">${isNew ? "Termin hinzufügen" : "Änderungen speichern"}</button>
      ${isNew ? "" : `<a class="btn btn--google" id="event-google" href="${escapeHtml(googleCalendarUrl(item))}" target="_blank" rel="noopener">Mit Google Kalender öffnen</a><button class="btn btn--danger" id="event-delete">Termin löschen</button>`}
    `);
    sheet.querySelector("[data-close]").onclick = closeSheet;
    sheet.querySelector("#event-save").onclick = () => {
      const title = sheet.querySelector("#event-title").value.trim();
      const date = sheet.querySelector("#event-date").value;
      const startTime = sheet.querySelector("#event-start-time").value;
      const endTime = sheet.querySelector("#event-end-time").value;
      if (!title || !date || !startTime || !endTime) { toast("Bitte Titel, Datum und Von–Bis-Zeit eingeben"); return; }
      if (timeMinutes(endTime) <= timeMinutes(startTime)) { toast("Die Bis-Zeit muss nach der Von-Zeit liegen"); return; }
      item.title = title;
      item.date = date;
      item.startTime = startTime;
      item.endTime = endTime;
      delete item.time;
      item.notes = sheet.querySelector("#event-notes").value.trim();
      if (isNew) state.events.push(item);
      save();
      calendarSelected = date;
      calendarMonth = new Date(parseDate(date).getFullYear(), parseDate(date).getMonth(), 1);
      closeSheet(); renderCalendar(); toast(isNew ? "Termin hinzugefügt" : "Termin gespeichert");
    };
    const del = sheet.querySelector("#event-delete");
    if (del) del.onclick = () => {
      if (!confirm(`„${item.title}" wirklich löschen?`)) return;
      state.events = state.events.filter((entry) => entry.id !== item.id);
      save(); closeSheet(); renderCalendar(); toast("Termin gelöscht");
    };
  }

  function openSettings() {
    const accountName = cloudProfile?.display_name || cloudUser?.email?.split("@")[0] || "Konto";
    const accountEmail = cloudProfile?.email || cloudUser?.email || "";
    const accountInitial = accountName.trim().charAt(0).toUpperCase() || "M";
    const themeSeg = (val) => `<div class="seg" id="theme-seg">
      ${[["light", "Hell"], ["dark", "Dunkel"]]
        .map(([k, l]) => `<button data-theme-val="${k}" class="${val === k ? "is-active" : ""}">${l}</button>`).join("")}
    </div>`;

    const manage = state.habits.map((h, i) => `
      <div class="manage-item" data-id="${h.id}">
        <span class="manage-item__emoji">${h.emoji || "•"}</span>
        <span class="manage-item__name">${escapeHtml(h.name)}</span>
        <span class="manage-item__tag">${h.type === "weekly" ? h.target + "×/Wo" : "täglich"}</span>
        <span class="manage-item__btns">
          <button class="mini-btn" data-act="up" ${i === 0 ? "disabled style=opacity:.3" : ""}>▲</button>
          <button class="mini-btn" data-act="down" ${i === state.habits.length - 1 ? "disabled style=opacity:.3" : ""}>▼</button>
          <button class="mini-btn" data-act="edit">✎</button>
          <button class="mini-btn is-danger" data-act="del">🗑</button>
        </span>
      </div>`).join("");

    const sheet = openSheet(`
      <div class="sheet__head">
        <div class="sheet__title">Einstellungen</div>
        <button class="sheet__close" data-close>Fertig</button>
      </div>

      <div class="section-label">Konto</div>
      <div class="account-card">
        <div class="account-card__top"><span class="account-avatar">${escapeHtml(accountInitial)}</span><span class="account-card__text"><strong>${escapeHtml(accountName)}</strong><small>${escapeHtml(accountEmail)}</small></span></div>
        <div class="sync-state" id="sync-state">${escapeHtml(cloudSyncLabel)}</div>
        <div class="account-actions">
          ${cloudIsAdmin ? '<button class="btn btn--ghost" id="account-admin">Benutzer</button>' : '<span></span>'}
          <button class="btn btn--ghost" id="account-logout">Abmelden</button>
        </div>
      </div>

      <div class="section-label">Darstellung</div>
      ${themeSeg(state.settings.theme)}

      <div class="section-label">Dein Startpunkt</div>
      <input class="input" type="date" id="start-date" value="${state.settings.startDate}" max="${todayStr()}">
      <p style="font-size:12px;color:var(--text-dim);margin:6px 2px 0">Die S-Auswertung beginnt genau an diesem Tag. Ältere Tage bleiben weiterhin bearbeitbar.</p>

      <div class="section-label" style="display:flex;justify-content:space-between;align-items:center">
        <span>Gewohnheiten</span>
      </div>
      <div class="manage-list" id="manage-list">${manage || '<p class="empty-hint">Noch keine.</p>'}</div>
      <button class="btn btn--ghost" id="add-habit" style="margin-top:10px">＋ Gewohnheit hinzufügen</button>

      <div class="section-label">Daten</div>
      <div class="btn-row">
        <button class="btn btn--ghost" id="export-data">Export</button>
        <button class="btn btn--ghost" id="import-data">Import</button>
      </div>
      <p class="settings-version">Momentum ${APP_VERSION}</p>
      <input type="file" id="import-file" accept="application/json" hidden>
    `);

    // Events
    sheet.querySelector("[data-close]").onclick = closeSheet;
    const adminButton = sheet.querySelector("#account-admin");
    if (adminButton) adminButton.onclick = openAdminUsers;
    sheet.querySelector("#account-logout").onclick = async () => {
      const logoutButton = sheet.querySelector("#account-logout");
      logoutButton.disabled = true;
      let signOutResult = { everywhere: false };
      let hardReload = false;
      try { await flushCloudState(); } catch (_error) { /* Cloud-Retry nicht abwarten. */ }
      closeSheet();
      try {
        signOutResult = await window.MomentumCloud.signOut();
      } catch (error) {
        console.warn("Globale Abmeldung war nicht erreichbar; lokale Sitzung wird entfernt.", error);
        hardReload = true;
      }
      await purgePrivateBrowserData();
      clearTimeout(cloudSyncTimer);
      cloudSaveRequested = false;
      cloudUser = null; cloudProfile = null; cloudIsAdmin = false;
      state = normalizeState(seedState());
      showAuth(signOutResult.everywhere
        ? "Du bist auf allen Geräten abgemeldet. Lokale Daten wurden entfernt."
        : "Auf diesem Gerät sicher abgemeldet. Andere Geräte konnten offline nicht erreicht werden.");
      if (hardReload) setTimeout(() => location.reload(), 250);
    };

    sheet.querySelector("#theme-seg").addEventListener("click", (e) => {
      const b = e.target.closest("[data-theme-val]"); if (!b) return;
      state.settings.theme = b.dataset.themeVal; save(); applyTheme();
      sheet.querySelectorAll("#theme-seg button").forEach((x) => x.classList.toggle("is-active", x === b));
    });

    sheet.querySelector("#start-date").addEventListener("change", (e) => {
      if (!e.target.value) return;
      state.settings.startDate = e.target.value > todayStr() ? todayStr() : e.target.value;
      state.settings.startMonday = dateStr(mondayOf(parseDate(state.settings.startDate)));
      e.target.value = state.settings.startDate;
      save();
      currentMonday = dateStr(mondayOf(new Date()));
      if (parseDate(currentMonday) < parseDate(state.settings.startMonday)) currentMonday = state.settings.startMonday;
      selectedDate = defaultSelectedFor(currentMonday);
      renderHabits();
      toast("Startdatum gesetzt");
    });

    sheet.querySelector("#manage-list").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]"); if (!btn) return;
      const id = btn.closest(".manage-item").dataset.id;
      const idx = state.habits.findIndex((h) => h.id === id);
      const act = btn.dataset.act;
      if (act === "up" && idx > 0) { [state.habits[idx - 1], state.habits[idx]] = [state.habits[idx], state.habits[idx - 1]]; save(); openSettings(); }
      else if (act === "down" && idx < state.habits.length - 1) { [state.habits[idx + 1], state.habits[idx]] = [state.habits[idx], state.habits[idx + 1]]; save(); openSettings(); }
      else if (act === "edit") openHabitEditor(state.habits[idx]);
      else if (act === "del") {
        if (confirm(`„${state.habits[idx].name}" wirklich löschen?`)) {
          const hid = state.habits[idx].id;
          state.habits.splice(idx, 1);
          Object.keys(state.log).forEach((d) => { if (state.log[d][hid]) { delete state.log[d][hid]; if (!Object.keys(state.log[d]).length) delete state.log[d]; } });
          save(); openSettings();
        }
      }
    });

    sheet.querySelector("#add-habit").onclick = () => openHabitEditor(null);
    sheet.querySelector("#export-data").onclick = exportData;
    sheet.querySelector("#import-data").onclick = () => sheet.querySelector("#import-file").click();
    sheet.querySelector("#import-file").addEventListener("change", importData);
  }

  function openHabitEditor(habit) {
    const isNew = !habit;
    const h = habit || { emoji: "✅", name: "", type: "daily", target: 3 };
    const sheet = openSheet(`
      <div class="sheet__head">
        <div class="sheet__title">${isNew ? "Neue Gewohnheit" : "Bearbeiten"}</div>
        <button class="sheet__close" data-close>Abbrechen</button>
      </div>
      <div class="field">
        <label>Symbol (Emoji)</label>
        <input class="input" id="h-emoji" name="momentum-habit-symbol" maxlength="2" value="${escapeHtml(h.emoji || "")}" placeholder="z. B. 🏋️" autocomplete="off" autocorrect="off" spellcheck="false">
      </div>
      <div class="field">
        <label for="h-title">Gewohnheit</label>
        <input class="input" id="h-title" name="momentum-habit-title" maxlength="60" value="${escapeHtml(h.name || "")}" placeholder="z. B. Aufstehen um 5 Uhr" autocomplete="off" autocorrect="off" spellcheck="false">
      </div>
      <div class="field">
        <label>Typ</label>
        <div class="seg" id="h-type">
          <button data-type="daily" class="${h.type === "daily" ? "is-active" : ""}">Täglich</button>
          <button data-type="weekly" class="${h.type === "weekly" ? "is-active" : ""}">Wöchentlich</button>
        </div>
      </div>
      <div class="field" id="target-field" ${h.type === "weekly" ? "" : "hidden"}>
        <label>Ziel pro Woche (Anzahl Tage)</label>
        <input class="input" id="h-target" type="number" min="1" max="7" value="${h.target || 3}">
      </div>
      <button class="btn" id="h-save" style="margin-top:6px">${isNew ? "Hinzufügen" : "Speichern"}</button>
      ${isNew ? "" : `<button class="btn btn--danger" id="h-del" style="margin-top:10px">Löschen</button>`}
    `);

    let type = h.type;
    sheet.querySelector("[data-close]").onclick = () => (isNew ? openSettings() : openSettings());
    sheet.querySelector("#h-type").addEventListener("click", (e) => {
      const b = e.target.closest("[data-type]"); if (!b) return;
      type = b.dataset.type;
      sheet.querySelectorAll("#h-type button").forEach((x) => x.classList.toggle("is-active", x === b));
      sheet.querySelector("#target-field").hidden = type !== "weekly";
    });
    sheet.querySelector("#h-save").onclick = () => {
      const name = sheet.querySelector("#h-title").value.trim();
      if (!name) { toast("Bitte einen Namen eingeben"); return; }
      const emoji = sheet.querySelector("#h-emoji").value.trim();
      const target = type === "weekly" ? Math.min(7, Math.max(1, parseInt(sheet.querySelector("#h-target").value) || 3)) : 1;
      if (isNew) state.habits.push({ id: uid(), emoji, name, type, target });
      else { habit.emoji = emoji; habit.name = name; habit.type = type; habit.target = target; }
      save(); openSettings(); toast(isNew ? "Hinzugefügt" : "Gespeichert");
    };
    const del = sheet.querySelector("#h-del");
    if (del) del.onclick = () => {
      if (confirm(`„${habit.name}" wirklich löschen?`)) {
        const idx = state.habits.findIndex((x) => x.id === habit.id);
        if (idx > -1) state.habits.splice(idx, 1);
        Object.keys(state.log).forEach((d) => { if (state.log[d][habit.id]) { delete state.log[d][habit.id]; if (!Object.keys(state.log[d]).length) delete state.log[d]; } });
        save(); openSettings();
      }
    };
  }

  /* ---------- Export / Import ---------- */
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `momentum-backup-${todayStr()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Backup exportiert");
  }
  function importData(e) {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("Import fehlgeschlagen: Die Datei ist größer als 5 MB.");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const s = JSON.parse(reader.result);
        if (!s || !Array.isArray(s.habits)) throw new Error("Ungültige Datei");
        // Importierte Dateien sind nicht vertrauenswürdig. normalizeState
        // begrenzt Mengen, Typen, IDs, Datumswerte und sämtliche Freitexte.
        state = normalizeState(s); save(); applyTheme();
        currentMonday = dateStr(mondayOf(new Date()));
        if (parseDate(currentMonday) < parseDate(state.settings.startMonday)) currentMonday = state.settings.startMonday;
        selectedDate = defaultSelectedFor(currentMonday);
        closeSheet(); render(); toast("Import erfolgreich");
      } catch (err) { alert("Import fehlgeschlagen: " + err.message); }
      finally { e.target.value = ""; }
    };
    reader.readAsText(file);
  }

  /* ---------- Standard-Auswahl für eine Woche ---------- */
  function defaultSelectedFor(mondayStr) {
    const today = todayStr();
    const ds = weekDays(mondayStr).map(dateStr);
    if (ds.includes(today)) return today;
    if (ds[6] < today) return ds[6];
    return ds[0];
  }

  /* ============================================================
     Event-Bindings
     ============================================================ */
  function bindEvents() {
    // Tab-Bar
    document.querySelector(".tabbar").addEventListener("click", (e) => {
      const t = e.target.closest(".tab"); if (t) switchScreen(t.dataset.screen);
    });

    // Einstellungen
    $("#btn-settings").addEventListener("click", openSettings);

    // Wochen-Navigation
    $("#week-prev").addEventListener("click", () => {
      const prev = dateStr(addDays(parseDate(currentMonday), -7));
      if (prev < earliestHistoryMonday()) return;
      currentMonday = prev; selectedDate = defaultSelectedFor(currentMonday); renderHabits();
    });
    $("#week-next").addEventListener("click", () => {
      currentMonday = dateStr(addDays(parseDate(currentMonday), 7));
      selectedDate = defaultSelectedFor(currentMonday); renderHabits();
    });

    // Tagesstreifen: Tag auswählen
    $("#day-strip").addEventListener("click", (e) => {
      const c = e.target.closest(".day-cell"); if (!c || c.disabled) return;
      selectedDate = c.dataset.date; renderHabits();
    });

    $("#trend-range").addEventListener("click", (e) => {
      const button = e.target.closest("[data-range]"); if (!button) return;
      trendRange = button.dataset.range;
      $("#trend-range").querySelectorAll("button").forEach((item) => item.classList.toggle("is-active", item === button));
      renderTrend();
    });

    // Tägliche Gewohnheit abhaken
    $("#habit-list").addEventListener("click", (e) => {
      const li = e.target.closest(".habit-item"); if (!li || li.classList.contains("is-locked")) return;
      const id = li.dataset.habit;
      setToggle(selectedDate, id, !isToggle(selectedDate, id));
      renderHabits();
    });

    // Wochenziel-Tag abhaken
    $("#weekly-list").addEventListener("click", (e) => {
      const c = e.target.closest(".wd-cell"); if (!c || c.disabled) return;
      const id = c.dataset.wdHabit, ds = c.dataset.date;
      setToggle(ds, id, !isToggle(ds, id));
      renderHabits();
    });

    // Gesundheit
    $("#health-prev").addEventListener("click", () => {
      const previous = dateStr(addDays(parseDate(healthSelected), -1));
      const earliest = dateStr(addDays(new Date(), -370));
      if (previous < earliest) return;
      healthSelected = previous; renderHealth();
    });
    $("#health-next").addEventListener("click", () => {
      const next = dateStr(addDays(parseDate(healthSelected), 1));
      if (next > todayStr()) return;
      healthSelected = next; renderHealth();
    });
    $("#health-date").addEventListener("change", (e) => {
      if (!e.target.value) return;
      const earliest = dateStr(addDays(new Date(), -370));
      healthSelected = e.target.value < earliest ? earliest : e.target.value > todayStr() ? todayStr() : e.target.value;
      renderHealth();
    });
    $("#health-goals").addEventListener("click", openHealthGoals);
    $("#add-health-food").addEventListener("click", () => openHealthFoodEditor(null));
    $("#health-food-table").addEventListener("click", (e) => {
      const button = e.target.closest("[data-edit-health-food]");
      if (!button) return;
      const food = healthFoods(healthSelected).find((item) => item.id === button.dataset.editHealthFood);
      if (food) openHealthFoodEditor(food);
    });
    $("#health-day-history").addEventListener("click", (e) => {
      const button = e.target.closest("[data-health-history-date]");
      if (!button) return;
      healthSelected = button.dataset.healthHistoryDate;
      renderHealth();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    const storeHealthInput = (input) => {
      const entry = { ...(state.health.entries[healthSelected] || {}) };
      if (input.value === "") delete entry[input.dataset.healthField];
      else {
        const value = Number(input.value);
        entry[input.dataset.healthField] = Number.isFinite(value) && value >= 0 ? value : 0;
      }
      if (Object.keys(entry).length) state.health.entries[healthSelected] = entry;
      else delete state.health.entries[healthSelected];
      save();
    };
    $("#health-fields").addEventListener("input", (e) => {
      const input = e.target.closest("[data-health-field]"); if (!input) return;
      storeHealthInput(input);
    });
    $("#health-fields").addEventListener("change", (e) => {
      const input = e.target.closest("[data-health-field]"); if (!input) return;
      storeHealthInput(input); renderHealth();
    });
    $("#health-metric").addEventListener("click", (e) => {
      const button = e.target.closest("[data-health-metric]"); if (!button) return;
      healthMetric = button.dataset.healthMetric; renderHealth();
    });
    $("#health-range").addEventListener("click", (e) => {
      const button = e.target.closest("[data-health-range]"); if (!button) return;
      healthRange = button.dataset.healthRange; renderHealth();
    });

    // Tasks und frei benennbare Blöcke
    $("#add-task").onclick = () => openTaskEditor(null, "", state.taskSections[0].id);
    $("#add-task-section").onclick = () => openSectionEditor(null);
    $("#task-sections").addEventListener("click", (e) => {
      const sectionEdit = e.target.closest("[data-section-edit]");
      const sectionAdd = e.target.closest("[data-add-to-section]");
      const taskEl = e.target.closest("[data-task-id]");
      if (sectionEdit) { openSectionEditor(state.taskSections.find((section) => section.id === sectionEdit.dataset.sectionEdit)); return; }
      if (sectionAdd) { openTaskEditor(null, "", sectionAdd.dataset.addToSection); return; }
      if (!taskEl) return;
      const found = findTask(taskEl.dataset.taskId); if (!found) return;
      const action = e.target.closest("[data-task-action]")?.dataset.taskAction;
      if (action === "toggle") { found.task.done = !found.task.done; save(); renderTasks(); }
      else if (action === "edit") openTaskEditor(found.task);
      else if (action === "archive") archiveTask(found.task.id);
    });
    $("#toggle-archive").onclick = () => { archiveExpanded = !archiveExpanded; renderTasks(); };
    $("#archive-list").addEventListener("click", (e) => {
      const restore = e.target.closest("[data-restore-task]");
      const remove = e.target.closest("[data-delete-archived]");
      if (restore) {
        const index = state.archivedTasks.findIndex((task) => task.id === restore.dataset.restoreTask); if (index < 0) return;
        const task = state.archivedTasks.splice(index, 1)[0];
        const sectionId = state.taskSections.some((section) => section.id === task.sectionId) ? task.sectionId : state.taskSections[0].id;
        delete task.archivedAt; delete task.sectionId; state.tasks[sectionId].push(task); save(); renderTasks();
      } else if (remove) {
        state.archivedTasks = state.archivedTasks.filter((task) => task.id !== remove.dataset.deleteArchived); save(); renderTasks();
      }
    });

    // Kalender
    $("#month-prev").addEventListener("click", () => {
      calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
      calendarSelected = dateStr(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1));
      renderCalendar();
    });
    $("#month-next").addEventListener("click", () => {
      calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
      calendarSelected = dateStr(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1));
      renderCalendar();
    });
    $("#month-today").addEventListener("click", () => {
      const now = new Date(); calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1); calendarSelected = todayStr(); renderCalendar();
    });
    $("#calendar-grid").addEventListener("click", (e) => {
      const day = e.target.closest("[data-calendar-date]"); if (!day) return;
      calendarSelected = day.dataset.calendarDate;
      const d = parseDate(calendarSelected);
      if (d.getMonth() !== calendarMonth.getMonth() || d.getFullYear() !== calendarMonth.getFullYear()) calendarMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      renderCalendar();
    });
    $("#add-event").onclick = () => openEventEditor(null);
    $("#add-calendar-task").onclick = () => openTaskEditor(null, calendarSelected, state.taskSections[0].id);
    $("#agenda-add").onclick = () => openEventEditor(null);
    $("#agenda-add-task").onclick = () => openTaskEditor(null, calendarSelected, state.taskSections[0].id);
    $("#agenda-list").addEventListener("click", (e) => {
      const edit = e.target.closest("[data-edit-event]");
      const editTask = e.target.closest("[data-edit-calendar-task]");
      if (edit) openEventEditor(state.events.find((event) => event.id === edit.dataset.editEvent));
      else if (editTask) { const found = findTask(editTask.dataset.editCalendarTask); if (found) openTaskEditor(found.task); }
    });
  }

  /* ============================================================
     Init
     ============================================================ */
  function init() {
    state = load();
    resetViewState();
    bindAuthEvents();
    bindEvents();
    initCloud();
    window.addEventListener("online", flushCloudState);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushCloudState();
    });
    window.addEventListener("pagehide", flushCloudState);

    // Neue App-Versionen sofort übernehmen, auch bei installierter Home-Screen-App.
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        let reloading = false;
        const reload = () => {
          if (reloading) return;
          reloading = true;
          location.reload();
        };
        const fallback = setTimeout(reload, 1800);
        Promise.resolve(flushCloudState()).finally(() => {
          clearTimeout(fallback);
          reload();
        });
      });
      navigator.serviceWorker.register("service-worker.js?v=24").then((registration) => registration.update()).catch(() => {});
    }
  }

  // Robust starten – auch wenn das Skript erst nach dem Laden ausgeführt wird
  // (z. B. in einer Vorschau-Sandbox), sonst würde init() nie laufen.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
