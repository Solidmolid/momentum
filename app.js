/* ============================================================
   Momentum – App-Logik (Vanilla JS, keine Abhängigkeiten)
   Daten liegen lokal im Browser (localStorage).
   ============================================================ */
(function () {
  "use strict";

  const KEY = "momentum_v1";
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
      version: 1,
      settings: { startMonday, theme: "auto" },
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
      s.settings = s.settings || { startMonday: dateStr(mondayOf(new Date())), theme: "auto" };
      s.habits = Array.isArray(s.habits) ? s.habits : [];
      s.log = s.log || {};
      s.tasks = s.tasks || { short: [], long: [] };
      s.tasks.short = s.tasks.short || [];
      s.tasks.long = s.tasks.long || [];
      s.events = Array.isArray(s.events) ? s.events : [];
      s.version = 2;
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

  /* ---------- Berechnungen ---------- */
  const dailyHabits = () => state.habits.filter((h) => h.type === "daily");
  const weeklyHabits = () => state.habits.filter((h) => h.type === "weekly");

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

  function buildChart(mondayStr) {
    const daily = dailyHabits();
    if (daily.length === 0)
      return `<p class="empty-hint">Noch keine täglichen Gewohnheiten – füge oben welche hinzu.</p>`;

    const W = 320, H = 150, padL = 28, padR = 12, padT = 12, padB = 24;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const today = todayStr();

    const days = weekDays(mondayStr);
    const X = (i) => padL + innerW * (i / 6);
    const Y = (p) => padT + innerH * (1 - p / 100);

    const pts = days.map((d, i) => {
      const ds = dateStr(d);
      return { i, x: X(i), pct: ds > today ? null : dayPercent(ds), isToday: ds === today };
    });
    const real = pts.filter((p) => p.pct != null);

    // Gridlines + Y-Labels (0/50/100)
    let grid = "";
    [0, 50, 100].forEach((v) => {
      const y = Y(v);
      grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border)" stroke-width="1"/>`;
      grid += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="var(--text-dim)">${v}</text>`;
    });

    // Linie + Fläche
    let path = "", area = "", dots = "";
    if (real.length) {
      path = real.map((p, k) => `${k ? "L" : "M"}${p.x.toFixed(1)},${Y(p.pct).toFixed(1)}`).join(" ");
      area = `M${real[0].x.toFixed(1)},${(H - padB)} ` +
        real.map((p) => `L${p.x.toFixed(1)},${Y(p.pct).toFixed(1)}`).join(" ") +
        ` L${real[real.length - 1].x.toFixed(1)},${H - padB} Z`;
      dots = real.map((p) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${Y(p.pct).toFixed(1)}" r="${p.isToday ? 4.5 : 3}"
          fill="${p.isToday ? "var(--accent)" : "var(--surface)"}" stroke="var(--accent)" stroke-width="2"/>`
      ).join("");
    }

    // X-Labels
    const labels = days.map((d, i) =>
      `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" font-weight="700"
        fill="${dateStr(d) === today ? "var(--accent)" : "var(--text-muted)"}">${WD[i]}</text>`).join("");

    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--accent)" stop-opacity="0.28"/>
        <stop offset="1" stop-color="var(--accent)" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid}
      ${area ? `<path d="${area}" fill="url(#areaGrad)"/>` : ""}
      ${path ? `<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
      ${dots}
      ${labels}
    </svg>`;
  }

  /* ---------- Rendern: Gewohnheiten ---------- */
  const $ = (sel) => document.querySelector(sel);

  function renderHabits() {
    const wn = weekNumber(currentMonday);
    const days = weekDays(currentMonday);
    $("#week-label").textContent = "Woche " + wn;
    $("#week-range").textContent = `${WD[0]} ${fmtDM(days[0])}–${WD[6]} ${fmtDM(days[6])}`;
    $("#week-prev").disabled = wn <= 1;

    const today = todayStr();
    const hour = new Date().getHours();
    const greeting = hour < 11 ? "Guten Morgen" : hour < 17 ? "Hallo" : "Guten Abend";
    const todayPct = dayPercent(today) || 0;
    const openTasks = [...state.tasks.short, ...state.tasks.long].filter((t) => !t.done).length;
    $("#welcome-kicker").textContent = greeting;
    $("#welcome-title").textContent = todayPct === 100 ? "Heute läuft es richtig gut." : "Mach heute zu deinem Tag.";
    $("#welcome-copy").textContent = openTasks ? `${openTasks} offene ${openTasks === 1 ? "Aufgabe" : "Aufgaben"} · bleib in deinem Rhythmus.` : "Kleine Schritte. Sichtbarer Fortschritt.";
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

    // Chart
    $("#week-chart").innerHTML = buildChart(currentMonday);

    // App-Bar Untertitel
    $("#appbar-sub").textContent = "Woche " + wn;
  }

  /* ---------- Rendern: Tasks ---------- */
  function renderTasks() {
    ["short", "long"].forEach((listKey) => {
      const arr = state.tasks[listKey];
      const open = arr.filter((t) => !t.done).length;
      $(`#${listKey}-count`).textContent = open;
      const ul = $(`#tasks-${listKey}`);
      const sorted = [...arr].sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        return a.dueDate ? -1 : b.dueDate ? 1 : 0;
      });
      ul.innerHTML = sorted.length
        ? sorted.map((t) => `<li class="task ${t.done ? "is-done" : ""}" data-list="${listKey}" data-id="${t.id}">
            <span class="check task__check">${CHECK_SVG}</span>
            <span class="task__content"><span class="task__text">${escapeHtml(t.text)}</span>${t.dueDate ? `<span class="task__date ${t.dueDate < todayStr() && !t.done ? "is-overdue" : ""}">${formatLongDate(t.dueDate)}</span>` : ""}</span>
            ${t.dueDate ? `<a class="task__google" data-task-action="google" href="${escapeHtml(googleCalendarUrl({ title: t.text, date: t.dueDate, time: "", notes: "Momentum-Aufgabe" }))}" target="_blank" rel="noopener" aria-label="In Google Kalender öffnen">G</a>` : ""}
            <button class="task__del" aria-label="Löschen">✕</button>
          </li>`).join("")
        : `<p class="empty-hint">Noch keine Aufgaben.</p>`;
    });
  }

  function formatLongDate(ds) {
    const d = parseDate(ds);
    return `${WD[(d.getDay() + 6) % 7]}, ${d.getDate()}. ${MONTHS[d.getMonth()].slice(0, 3)}`;
  }

  function calendarItemsFor(ds) {
    const events = state.events.filter((event) => event.date === ds).map((event) => ({ ...event, kind: "event" }));
    const tasks = [...state.tasks.short, ...state.tasks.long]
      .filter((task) => task.dueDate === ds)
      .map((task) => ({ id: task.id, title: task.text, date: task.dueDate, time: "", done: task.done, kind: "task" }));
    return [...events, ...tasks].sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
  }

  function renderCalendar() {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    $("#month-today").textContent = `${MONTHS[month]} ${year}`;

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
          <span class="agenda-item__content"><strong>${escapeHtml(item.title)}</strong><small>${item.done ? "Erledigt" : "Fällig"}</small></span>
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
    $("#appbar-sub").textContent = name === "habits" ? "Woche " + weekNumber(currentMonday) : name === "calendar" ? "Plane deinen Rhythmus" : "Was als Nächstes zählt";
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.screen === name));
    render();
    window.scrollTo({ top: 0 });
  }

  /* ---------- Theme ---------- */
  function applyTheme() {
    const t = state.settings.theme;
    if (t === "light") document.documentElement.dataset.theme = "light";
    else if (t === "dark") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
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

  function openEventEditor(event) {
    const isNew = !event;
    const item = event || { id: uid(), title: "", date: calendarSelected || todayStr(), time: "", notes: "" };
    const sheet = openSheet(`
      <div class="sheet__head">
        <div><span class="sheet__eyebrow">Kalender</span><div class="sheet__title">${isNew ? "Neuer Termin" : "Termin bearbeiten"}</div></div>
        <button class="sheet__close" data-close>Abbrechen</button>
      </div>
      <div class="event-accent"></div>
      <div class="field"><label for="event-title">Was steht an?</label><input class="input" id="event-title" maxlength="100" value="${escapeHtml(item.title)}" placeholder="z. B. Training oder Fokuszeit"></div>
      <div class="event-time-grid">
        <div class="field"><label for="event-date">Datum</label><input class="input" id="event-date" type="date" value="${item.date}"></div>
        <div class="field"><label for="event-time">Uhrzeit (optional)</label><input class="input" id="event-time" type="time" value="${item.time || ""}"></div>
      </div>
      <div class="field"><label for="event-notes">Notiz</label><textarea class="input input--textarea" id="event-notes" maxlength="300" placeholder="Details, Ort oder Erinnerung">${escapeHtml(item.notes || "")}</textarea></div>
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
      ${[["auto", "Auto"], ["light", "Hell"], ["dark", "Dunkel"]]
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
        <input class="input" id="h-emoji" maxlength="2" value="${escapeHtml(h.emoji || "")}" placeholder="z. B. 🏋️">
      </div>
      <div class="field">
        <label>Name</label>
        <input class="input" id="h-name" maxlength="60" value="${escapeHtml(h.name || "")}" placeholder="z. B. Aufstehen um 5 Uhr">
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
      const name = sheet.querySelector("#h-name").value.trim();
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
        s.events = Array.isArray(s.events) ? s.events : [];
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
      if (parseDate(prev) < parseDate(state.settings.startMonday)) return;
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

    // Tasks hinzufügen
    document.querySelectorAll(".addrow").forEach((form) => {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = form.querySelector(".addrow__input");
        const dateInput = form.querySelector(".addrow__date");
        const text = input.value.trim(); if (!text) return;
        state.tasks[form.dataset.list].unshift({ id: uid(), text, dueDate: dateInput.value || "", done: false, createdAt: Date.now() });
        save(); input.value = ""; dateInput.value = ""; renderTasks();
      });
    });

    // Task abhaken / löschen
    document.querySelectorAll(".task-list").forEach((ul) => {
      ul.addEventListener("click", (e) => {
        const li = e.target.closest(".task"); if (!li) return;
        const arr = state.tasks[li.dataset.list];
        const t = arr.find((x) => x.id === li.dataset.id); if (!t) return;
        if (e.target.closest("[data-task-action='google']")) return;
        if (e.target.closest(".task__del")) {
          const i = arr.indexOf(t); arr.splice(i, 1); save(); renderTasks();
        } else {
          t.done = !t.done; save(); renderTasks();
        }
      });
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
    $("#agenda-add").onclick = () => openEventEditor(null);
    $("#agenda-list").addEventListener("click", (e) => {
      const edit = e.target.closest("[data-edit-event]");
      if (edit) openEventEditor(state.events.find((event) => event.id === edit.dataset.editEvent));
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

    // Service Worker (nur über http/https, nicht file://)
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    }
  }

  // Robust starten – auch wenn das Skript erst nach dem Laden ausgeführt wird
  // (z. B. in einer Vorschau-Sandbox), sonst würde init() nie laufen.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
