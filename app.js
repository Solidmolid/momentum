/* ============================================================
   Momentum – App-Logik (Vanilla JS, keine Abhängigkeiten)
   Daten liegen lokal im Browser (localStorage).
   ============================================================ */
(function () {
  "use strict";

  const KEY = "momentum_v1";
  const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
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
      const sorted = [...arr].sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
      ul.innerHTML = sorted.length
        ? sorted.map((t) => `<li class="task ${t.done ? "is-done" : ""}" data-list="${listKey}" data-id="${t.id}">
            <span class="check task__check">${CHECK_SVG}</span>
            <span class="task__text">${escapeHtml(t.text)}</span>
            <button class="task__del" aria-label="Löschen">✕</button>
          </li>`).join("")
        : `<p class="empty-hint">Noch keine Aufgaben.</p>`;
    });
  }

  function render() {
    if (screen === "habits") renderHabits();
    else renderTasks();
  }

  /* ---------- Screen-Wechsel ---------- */
  function switchScreen(name) {
    screen = name;
    $("#screen-habits").hidden = name !== "habits";
    $("#screen-tasks").hidden = name !== "tasks";
    $("#appbar-title").textContent = name === "habits" ? "Momentum" : "Tasks";
    $("#appbar-sub").textContent = name === "habits" ? "Woche " + weekNumber(currentMonday) : "";
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
        const text = input.value.trim(); if (!text) return;
        state.tasks[form.dataset.list].unshift({ id: uid(), text, done: false, createdAt: Date.now() });
        save(); input.value = ""; renderTasks();
      });
    });

    // Task abhaken / löschen
    document.querySelectorAll(".task-list").forEach((ul) => {
      ul.addEventListener("click", (e) => {
        const li = e.target.closest(".task"); if (!li) return;
        const arr = state.tasks[li.dataset.list];
        const t = arr.find((x) => x.id === li.dataset.id); if (!t) return;
        if (e.target.closest(".task__del")) {
          const i = arr.indexOf(t); arr.splice(i, 1); save(); renderTasks();
        } else {
          t.done = !t.done; save(); renderTasks();
        }
      });
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
    bindEvents();
    switchScreen("habits");

    // Service Worker (nur über http/https, nicht file://)
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
