/* ============================================================
   Momentum – App-Logik (Vanilla JS, keine Abhängigkeiten)
   Daten liegen lokal im Browser (localStorage).
   ============================================================ */
(function () {
  "use strict";

  const KEY = "momentum_v1";
  const APP_VERSION = "2.2.1";
  const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const CHECK_SVG =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

  /* ---------- Datum-Helfer (lokale Zeit) ---------- */
  const pad = (n) => String(n).padStart(2, "0");
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
    const startMonday = dateStr(mondayOf(new Date()));
    return {
      version: 3,
      settings: { startMonday, theme: "light" },
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
    };
  }

  /* ---------- State laden / speichern ---------- */
  let state;
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return seedState();
      const s = JSON.parse(raw);
      // sanfte Migration / Absicherung
      s.settings = s.settings || { startMonday: dateStr(mondayOf(new Date())), theme: "light" };
      if (!s.settings.theme || s.settings.theme === "auto") s.settings.theme = "light";
      s.habits = Array.isArray(s.habits) ? s.habits : [];
      s.log = s.log || {};
      s.tasks = s.tasks || { short: [], long: [] };
      s.tasks.short = s.tasks.short || [];
      s.tasks.long = s.tasks.long || [];
      s.taskSections = Array.isArray(s.taskSections) && s.taskSections.length ? s.taskSections : [{ id: "short", name: "Kurzfristig" }, { id: "long", name: "Langfristig" }];
      s.taskSections.forEach((section) => { if (!Array.isArray(s.tasks[section.id])) s.tasks[section.id] = []; });
      s.archivedTasks = Array.isArray(s.archivedTasks) ? s.archivedTasks : [];
      s.events = Array.isArray(s.events) ? s.events : [];
      s.version = 3;
      return s;
    } catch (e) {
      console.warn("Konnte Daten nicht laden, starte neu.", e);
      return seedState();
    }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.error("Speichern fehlgeschlagen", e); }
  }

  /* ---------- View-State (nicht gespeichert) ---------- */
  let currentMonday;      // Mo der angezeigten Woche (String)
  let selectedDate;       // ausgewählter Tag (String)
  let screen = "habits";
  let calendarMonth;
  let calendarSelected;
  let trendRange = "week";
  let archiveExpanded = false;

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
    const selected = parseDate(selectedDate || todayStr());
    const reference = selected > today ? today : selected;
    if (trendRange === "week") {
      const dates = weekDays(currentMonday).filter((d) => d <= today);
      return {
        dates,
        values: dates.map((d) => dayPercent(dateStr(d)) || 0),
        labels: dates.map((d) => WD[(d.getDay() + 6) % 7]),
        caption: "in dieser Woche",
      };
    }
    if (trendRange === "month") {
      const dates = Array.from({ length: 30 }, (_, i) => addDays(reference, i - 29));
      return {
        dates,
        values: dates.map((d) => dayPercent(dateStr(d)) || 0),
        labels: dates.map((d, i) => [0, 7, 14, 21, 29].includes(i) ? `${d.getDate()}.${d.getMonth() + 1}.` : ""),
        caption: "in den letzten 30 Tagen",
      };
    }
    const months = Array.from({ length: 12 }, (_, i) => new Date(reference.getFullYear(), reference.getMonth() - 11 + i, 1));
    const monthValues = months.map((start) => {
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      const cappedEnd = end > today ? today : end;
      if (start > cappedEnd) return 0;
      const count = Math.floor((cappedEnd - start) / 864e5) + 1;
      const values = Array.from({ length: count }, (_, i) => dayPercent(dateStr(addDays(start, i))) || 0);
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
    if (!dailyHabits().length) return `<p class="empty-hint">Noch keine täglichen Gewohnheiten.</p>`;
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
    $("#consistency-range").textContent = trendRange === "week" ? "Diese Woche" : trendRange === "month" ? "30 Tage" : "12 Monate";
    const validDates = data.dates.filter((d) => dateStr(d) <= todayStr());
    $("#habit-stats").innerHTML = dailyHabits().map((habit) => {
      const done = validDates.filter((d) => isToggle(dateStr(d), habit.id)).length;
      const rate = validDates.length ? Math.round(done / validDates.length * 100) : 0;
      return `<div class="habit-stat"><span class="habit-stat__emoji">${habit.emoji || "•"}</span><span class="habit-stat__main"><span><strong>${escapeHtml(habit.name)}</strong><b>${rate} %</b></span><i><em style="width:${rate}%"></em></i></span></div>`;
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
            <span class="habit-item__emoji">${h.emoji || "•"}</span>
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
            <span class="weekly-item__emoji">${h.emoji || "•"}</span>
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
      .map((task) => ({ id: task.id, title: task.text, date: task.dueDate, time: "", done: task.done, sectionId: task.sectionId, kind: "task" }));
    return [...events, ...tasks].sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
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
        <span class="agenda-item__time">${item.time || "Ganztägig"}</span><span class="agenda-item__line"></span>
        <button class="agenda-item__content" data-edit-event="${item.id}"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.notes || "Momentum-Termin")}</small></button>
        <a class="agenda-item__google" href="${escapeHtml(googleCalendarUrl(item))}" target="_blank" rel="noopener" aria-label="In Google Kalender öffnen">G</a>
      </div>`;
    }).join("") : `<div class="agenda-empty"><span>☀️</span><strong>Noch nichts geplant</strong><small>Genieße den freien Raum oder füge einen Termin hinzu.</small></div>`;
  }

  function googleCalendarUrl(item) {
    const day = item.date.replaceAll("-", "");
    let dates;
    if (item.time) {
      const start = `${day}T${item.time.replace(":", "")}00`;
      const endDate = new Date(`${item.date}T${item.time}:00`);
      endDate.setHours(endDate.getHours() + 1);
      const end = `${dateStr(endDate).replaceAll("-", "")}T${pad(endDate.getHours())}${pad(endDate.getMinutes())}00`;
      dates = `${start}/${end}`;
    } else {
      dates = `${day}/${dateStr(addDays(parseDate(item.date), 1)).replaceAll("-", "")}`;
    }
    const params = new URLSearchParams({ action: "TEMPLATE", text: item.title, dates, details: item.notes || "Erstellt mit Momentum" });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  function render() {
    if (screen === "habits") renderHabits();
    else if (screen === "tasks") renderTasks();
    else renderCalendar();
  }

  /* ---------- Screen-Wechsel ---------- */
  function switchScreen(name) {
    screen = name;
    $("#screen-habits").hidden = name !== "habits";
    $("#screen-tasks").hidden = name !== "tasks";
    $("#screen-calendar").hidden = name !== "calendar";
    const titles = { habits: "Momentum", tasks: "Aufgaben", calendar: "Kalender" };
    $("#appbar-title").textContent = titles[name];
    const wn = weekNumber(currentMonday);
    const openTasks = allTasks().filter((task) => !task.done).length;
    $("#appbar-sub").textContent = name === "habits" ? (wn > 0 ? "Woche " + wn : "Rückblick") : name === "calendar" ? `${MONTHS[calendarMonth.getMonth()]} ${calendarMonth.getFullYear()}` : `${openTasks} offene ${openTasks === 1 ? "Aufgabe" : "Aufgaben"}`;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.screen === name));
    render();
    window.scrollTo({ top: 0 });
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
      ${task && item.dueDate ? `<a class="btn btn--google" href="${escapeHtml(googleCalendarUrl({ title: item.text, date: item.dueDate, time: "", notes: "Momentum-Aufgabe" }))}" target="_blank" rel="noopener">In Google Kalender öffnen</a>` : ""}
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
    const item = event || { id: uid(), title: "", date: calendarSelected || todayStr(), time: "", notes: "" };
    const sheet = openSheet(`
      <div class="sheet__head">
        <div><span class="sheet__eyebrow">Kalender</span><div class="sheet__title">${isNew ? "Neuer Termin" : "Termin bearbeiten"}</div></div>
        <button class="sheet__close" data-close>Abbrechen</button>
      </div>
      <div class="event-accent"></div>
      <div class="field"><label for="event-title">Was steht an?</label><input class="input" id="event-title" name="momentum-event-title" maxlength="100" value="${escapeHtml(item.title)}" placeholder="z. B. Training oder Fokuszeit" autocomplete="off" autocorrect="off" spellcheck="false"></div>
      <div class="event-time-grid">
        <div class="field"><label for="event-date">Datum</label><input class="input" id="event-date" type="date" value="${item.date}"></div>
        <div class="field"><label for="event-time">Uhrzeit (optional)</label><input class="input" id="event-time" type="time" value="${item.time || ""}"></div>
      </div>
      <div class="field"><label for="event-notes">Notiz</label><textarea class="input input--textarea" id="event-notes" name="momentum-event-notes" maxlength="300" placeholder="Details, Ort oder Erinnerung" autocomplete="off" autocorrect="off" spellcheck="false">${escapeHtml(item.notes || "")}</textarea></div>
      <button class="btn" id="event-save">${isNew ? "Termin hinzufügen" : "Änderungen speichern"}</button>
      ${isNew ? "" : `<a class="btn btn--google" id="event-google" href="${escapeHtml(googleCalendarUrl(item))}" target="_blank" rel="noopener">Mit Google Kalender öffnen</a><button class="btn btn--danger" id="event-delete">Termin löschen</button>`}
    `);
    sheet.querySelector("[data-close]").onclick = closeSheet;
    sheet.querySelector("#event-save").onclick = () => {
      const title = sheet.querySelector("#event-title").value.trim();
      const date = sheet.querySelector("#event-date").value;
      if (!title || !date) { toast("Bitte Titel und Datum eingeben"); return; }
      item.title = title;
      item.date = date;
      item.time = sheet.querySelector("#event-time").value;
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

      <div class="section-label">Darstellung</div>
      ${themeSeg(state.settings.theme)}

      <div class="section-label">Start von Woche 1</div>
      <input class="input" type="date" id="start-date" value="${state.settings.startMonday}">
      <p style="font-size:12px;color:var(--text-dim);margin:6px 2px 0">Die Woche wird automatisch auf den Montag gelegt.</p>

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
      <button class="btn btn--danger" id="reset-data" style="margin-top:10px">Alles zurücksetzen</button>
      <p class="settings-version">Momentum ${APP_VERSION}</p>
      <input type="file" id="import-file" accept="application/json" hidden>
    `);

    // Events
    sheet.querySelector("[data-close]").onclick = closeSheet;

    sheet.querySelector("#theme-seg").addEventListener("click", (e) => {
      const b = e.target.closest("[data-theme-val]"); if (!b) return;
      state.settings.theme = b.dataset.themeVal; save(); applyTheme();
      sheet.querySelectorAll("#theme-seg button").forEach((x) => x.classList.toggle("is-active", x === b));
    });

    sheet.querySelector("#start-date").addEventListener("change", (e) => {
      if (!e.target.value) return;
      state.settings.startMonday = dateStr(mondayOf(parseDate(e.target.value)));
      save();
      currentMonday = dateStr(mondayOf(new Date()));
      if (parseDate(currentMonday) < parseDate(state.settings.startMonday)) currentMonday = state.settings.startMonday;
      selectedDate = defaultSelectedFor(currentMonday);
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
    sheet.querySelector("#reset-data").onclick = () => {
      if (confirm("Wirklich ALLE Daten löschen und neu starten?")) {
        localStorage.removeItem(KEY); state = seedState(); save();
        currentMonday = dateStr(mondayOf(new Date())); selectedDate = todayStr();
        applyTheme(); closeSheet(); render(); toast("Zurückgesetzt");
      }
    };
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
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const s = JSON.parse(reader.result);
        if (!s || !Array.isArray(s.habits)) throw new Error("Ungültige Datei");
        s.tasks = s.tasks || { short: [], long: [] };
        s.tasks.short = s.tasks.short || [];
        s.tasks.long = s.tasks.long || [];
        s.taskSections = Array.isArray(s.taskSections) && s.taskSections.length ? s.taskSections : [{ id: "short", name: "Kurzfristig" }, { id: "long", name: "Langfristig" }];
        s.taskSections.forEach((section) => { if (!Array.isArray(s.tasks[section.id])) s.tasks[section.id] = []; });
        s.archivedTasks = Array.isArray(s.archivedTasks) ? s.archivedTasks : [];
        s.events = Array.isArray(s.events) ? s.events : [];
        s.settings = s.settings || { startMonday: dateStr(mondayOf(new Date())), theme: "light" };
        if (!s.settings.theme || s.settings.theme === "auto") s.settings.theme = "light";
        state = s; save(); applyTheme();
        currentMonday = dateStr(mondayOf(new Date()));
        if (parseDate(currentMonday) < parseDate(state.settings.startMonday)) currentMonday = state.settings.startMonday;
        selectedDate = defaultSelectedFor(currentMonday);
        closeSheet(); render(); toast("Import erfolgreich");
      } catch (err) { alert("Import fehlgeschlagen: " + err.message); }
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
    applyTheme();
    currentMonday = dateStr(mondayOf(new Date()));
    if (parseDate(currentMonday) < parseDate(state.settings.startMonday)) currentMonday = state.settings.startMonday;
    selectedDate = defaultSelectedFor(currentMonday);
    const now = new Date();
    calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    calendarSelected = todayStr();
    bindEvents();
    switchScreen("habits");

    // Neue App-Versionen sofort übernehmen, auch bei installierter Home-Screen-App.
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        location.reload();
      });
      navigator.serviceWorker.register("service-worker.js?v=8").then((registration) => registration.update()).catch(() => {});
    }
  }

  // Robust starten – auch wenn das Skript erst nach dem Laden ausgeführt wird
  // (z. B. in einer Vorschau-Sandbox), sonst würde init() nie laufen.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
