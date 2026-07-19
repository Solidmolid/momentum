/* Momentum Sketch – lokaler Vektoreditor und sichere IndexedDB-Ablage. */
(function (global) {
  "use strict";

  const WORLD_WIDTH = 2048;
  const WORLD_HEIGHT = 1536;
  const SCHEMA_VERSION = 1;
  const DB_NAME = "momentum_sketches_v1";
  const DB_VERSION = 1;
  const STORE_DOCUMENTS = "documents";
  const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
  const SAFE_COLOR = /^#[0-9a-fA-F]{6}$/;
  const LIMITS = Object.freeze({
    title: 80,
    description: 500,
    text: 2000,
    elements: 5000,
    pointsPerStroke: 4096,
    totalPoints: 100000,
    documentBytes: 8 * 1024 * 1024,
    historyEntries: 100,
    historyBytes: 8 * 1024 * 1024,
    minZoom: 0.08,
    maxZoom: 12,
  });
  const TOOLS = new Set(["pen", "marker", "eraser", "select", "pan", "text"]);
  const ALIGNMENTS = new Set(["left", "center", "right"]);

  const clamp = (number, min, max) => Math.min(max, Math.max(min, number));
  const finite = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const round = (value, places = 2) => {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const now = () => Date.now();
  const localDate = (date = new Date()) => {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };
  const validDate = (value) => {
    const candidate = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return false;
    const [year, month, day] = candidate.split("-").map(Number);
    const parsed = new Date(year, month - 1, day);
    return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
  };
  const createId = () => {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    if (global.crypto?.getRandomValues) {
      const values = new Uint32Array(4);
      global.crypto.getRandomValues(values);
      return [...values].map((value) => value.toString(36)).join("-");
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  };
  const cleanId = (value, fallback) => {
    const candidate = String(value ?? "");
    return SAFE_ID.test(candidate) ? candidate : (fallback !== undefined ? fallback : createId());
  };
  const cleanUserId = (value) => {
    const candidate = String(value ?? "");
    if (!SAFE_ID.test(candidate)) throw new TypeError("Ungültige Benutzer-ID für Skizzen.");
    return candidate;
  };
  const cleanSingleLine = (value, maxLength, fallback = "") => {
    const cleaned = String(value ?? fallback)
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
    return cleaned || fallback;
  };
  const cleanMultiline = (value, maxLength) => String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .slice(0, maxLength)
    .trim();
  const cleanColor = (value, fallback = "#111111") => SAFE_COLOR.test(String(value ?? ""))
    ? String(value).toLowerCase()
    : fallback;
  const cleanEpoch = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 && number <= Number.MAX_SAFE_INTEGER
      ? Math.round(number)
      : fallback;
  };
  const estimatedBytes = (value) => {
    const json = JSON.stringify(value);
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(json).length;
    return json.length * 2;
  };

  function normalizeFlatPoints(rawPoints, remainingBudget) {
    const points = [];
    const budget = Math.max(0, Math.min(LIMITS.pointsPerStroke, remainingBudget));
    if (!budget || !Array.isArray(rawPoints)) return points;

    const pushPoint = (rawX, rawY, rawPressure, rawTime) => {
      if (points.length / 4 >= budget) return;
      const x = Number(rawX);
      const y = Number(rawY);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const pressure = Number(rawPressure);
      const elapsed = Number(rawTime);
      points.push(
        round(clamp(x, 0, WORLD_WIDTH), 2),
        round(clamp(y, 0, WORLD_HEIGHT), 2),
        round(clamp(Number.isFinite(pressure) ? pressure : 0.5, 0, 1), 3),
        Math.round(clamp(Number.isFinite(elapsed) ? elapsed : 0, 0, 86400000))
      );
    };

    if (rawPoints.length && typeof rawPoints[0] === "object" && rawPoints[0] !== null) {
      rawPoints.slice(0, budget).forEach((point) => pushPoint(point.x, point.y, point.pressure ?? point.p, point.time ?? point.t));
      return points;
    }

    const stride = rawPoints.length % 4 === 0 ? 4 : (rawPoints.length % 3 === 0 ? 3 : 2);
    for (let index = 0; index + 1 < rawPoints.length && points.length / 4 < budget; index += stride) {
      pushPoint(rawPoints[index], rawPoints[index + 1], stride >= 3 ? rawPoints[index + 2] : 0.5, stride >= 4 ? rawPoints[index + 3] : 0);
    }
    return points;
  }

  function normalizeStroke(rawElement, remainingPoints, usedIds) {
    const points = normalizeFlatPoints(rawElement?.points, remainingPoints);
    if (!points.length) return null;
    let id = cleanId(rawElement?.id);
    while (usedIds.has(id)) id = createId();
    usedIds.add(id);
    const tool = rawElement?.tool === "marker" ? "marker" : "pen";
    return {
      id,
      type: "stroke",
      tool,
      color: cleanColor(rawElement?.color, tool === "marker" ? "#f5c542" : "#111111"),
      width: round(clamp(finite(rawElement?.width, tool === "marker" ? 28 : 5), 0.5, 100), 2),
      opacity: round(clamp(finite(rawElement?.opacity, tool === "marker" ? 0.28 : 1), 0.05, 1), 3),
      points,
      createdAt: cleanEpoch(rawElement?.createdAt, now()),
      updatedAt: cleanEpoch(rawElement?.updatedAt, now()),
    };
  }

  function normalizeText(rawElement, usedIds) {
    const text = cleanMultiline(rawElement?.text, LIMITS.text);
    if (!text) return null;
    let id = cleanId(rawElement?.id);
    while (usedIds.has(id)) id = createId();
    usedIds.add(id);
    const fontSize = round(clamp(finite(rawElement?.fontSize, 48), 12, 240), 2);
    const x = round(clamp(finite(rawElement?.x, 96), 0, WORLD_WIDTH - 40), 2);
    const maxWidth = Math.max(40, WORLD_WIDTH - x);
    const width = round(clamp(finite(rawElement?.width, 600), 40, maxWidth), 2);
    const averageCharactersPerLine = Math.max(1, Math.floor(width / (fontSize * 0.56)));
    const estimatedLines = text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / averageCharactersPerLine)), 0);
    const estimatedHeight = Math.max(fontSize, estimatedLines * fontSize * 1.22);
    const height = round(clamp(finite(rawElement?.height, estimatedHeight), fontSize, WORLD_HEIGHT), 2);
    const y = round(clamp(finite(rawElement?.y, 96), 0, Math.max(0, WORLD_HEIGHT - height)), 2);
    return {
      id,
      type: "text",
      x,
      y,
      width,
      height,
      text,
      fontSize,
      color: cleanColor(rawElement?.color),
      align: ALIGNMENTS.has(rawElement?.align) ? rawElement.align : "left",
      fontWeight: rawElement?.fontWeight === "bold" ? "bold" : "normal",
      createdAt: cleanEpoch(rawElement?.createdAt, now()),
      updatedAt: cleanEpoch(rawElement?.updatedAt, now()),
    };
  }

  function normalizeDocument(rawDocument, options = {}) {
    const raw = rawDocument && typeof rawDocument === "object" ? rawDocument : {};
    const timestamp = now();
    const documentDate = validDate(raw.documentDate) ? raw.documentDate : localDate();
    const usedIds = new Set();
    const elements = [];
    let totalPoints = 0;
    const rawElements = Array.isArray(raw.elements) ? raw.elements.slice(0, LIMITS.elements) : [];

    for (const rawElement of rawElements) {
      let element = null;
      if (rawElement?.type === "stroke") {
        element = normalizeStroke(rawElement, LIMITS.totalPoints - totalPoints, usedIds);
        if (element) totalPoints += element.points.length / 4;
      } else if (rawElement?.type === "text") {
        element = normalizeText(rawElement, usedIds);
      }
      if (element) elements.push(element);
      if (totalPoints >= LIMITS.totalPoints) break;
    }

    const createdAt = cleanEpoch(raw.createdAt, timestamp);
    const normalized = {
      schemaVersion: SCHEMA_VERSION,
      id: cleanId(raw.id, options.id),
      title: cleanSingleLine(raw.title, LIMITS.title, `Skizze ${documentDate.split("-").reverse().join(".")}`),
      description: cleanMultiline(raw.description, LIMITS.description),
      documentDate,
      createdAt,
      updatedAt: Math.max(createdAt, cleanEpoch(raw.updatedAt, createdAt)),
      cloudVersion: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(finite(raw.cloudVersion, 0)))),
      lastSyncedUpdatedAt: raw.lastSyncedUpdatedAt ? cleanEpoch(raw.lastSyncedUpdatedAt, 0) : 0,
      deletedAt: raw.deletedAt ? cleanEpoch(raw.deletedAt, null) : null,
      canvas: {
        width: WORLD_WIDTH,
        height: WORLD_HEIGHT,
        background: cleanColor(raw.canvas?.background, "#ffffff"),
      },
      elements,
    };

    // Ein manipuliertes Dokument darf weder IndexedDB noch den Browser mit
    // beliebig großen JSON-Strukturen fluten. Eigene Editor-Aktionen prüfen
    // dieselben Grenzen, daher betrifft das Abschneiden regulär nur Importe.
    while (normalized.elements.length && estimatedBytes(normalized) > LIMITS.documentBytes) {
      normalized.elements.pop();
    }
    return normalized;
  }

  function createDocument(options = {}) {
    return normalizeDocument({
      id: options.id || createId(),
      title: options.title,
      description: options.description,
      documentDate: options.documentDate || localDate(),
      canvas: { background: options.background || "#ffffff" },
      elements: [],
    });
  }

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB-Anfrage fehlgeschlagen."));
    });
  }

  function transactionPromise(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB-Transaktion abgebrochen."));
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB-Transaktion fehlgeschlagen."));
    });
  }

  function createStore(options = {}) {
    const indexedDB = options.indexedDB || global.indexedDB;
    const databaseName = cleanSingleLine(options.databaseName, 80, DB_NAME);
    let databasePromise = null;
    if (!indexedDB?.open) throw new Error("IndexedDB ist auf diesem Gerät nicht verfügbar.");

    const open = () => {
      if (databasePromise) return databasePromise;
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, DB_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(STORE_DOCUMENTS)) {
            const store = database.createObjectStore(STORE_DOCUMENTS, { keyPath: ["userId", "id"] });
            store.createIndex("by_user", "userId", { unique: false });
            store.createIndex("by_user_updated", ["userId", "updatedAt"], { unique: false });
          }
        };
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => database.close();
          resolve(database);
        };
        request.onerror = () => {
          databasePromise = null;
          reject(request.error || new Error("Skizzenspeicher konnte nicht geöffnet werden."));
        };
        request.onblocked = () => {
          databasePromise = null;
          reject(new Error("Skizzenspeicher wird von einem anderen App-Fenster blockiert."));
        };
      });
      return databasePromise;
    };

    const withStore = async (mode, operation) => {
      const database = await open();
      const transaction = database.transaction(STORE_DOCUMENTS, mode);
      const store = transaction.objectStore(STORE_DOCUMENTS);
      const result = await operation(store, transaction);
      await transactionPromise(transaction);
      return result;
    };

    return Object.freeze({
      async list(userId) {
        const safeUserId = cleanUserId(userId);
        const records = await withStore("readonly", async (store) => requestPromise(store.index("by_user").getAll(safeUserId)));
        return records
          .map((record) => normalizeDocument(record.document))
          .sort((left, right) => right.updatedAt - left.updatedAt);
      },

      async get(userId, documentId) {
        const safeUserId = cleanUserId(userId);
        const safeDocumentId = cleanId(documentId, "");
        if (!safeDocumentId) return null;
        const record = await withStore("readonly", async (store) => requestPromise(store.get([safeUserId, safeDocumentId])));
        return record?.document ? normalizeDocument(record.document) : null;
      },

      async put(userId, documentValue) {
        const safeUserId = cleanUserId(userId);
        const document = normalizeDocument(documentValue);
        const record = {
          userId: safeUserId,
          id: document.id,
          title: document.title,
          documentDate: document.documentDate,
          updatedAt: document.updatedAt,
          document,
        };
        await withStore("readwrite", async (store) => requestPromise(store.put(record)));
        return clone(document);
      },

      async delete(userId, documentId) {
        const safeUserId = cleanUserId(userId);
        const safeDocumentId = cleanId(documentId, "");
        if (!safeDocumentId) return false;
        await withStore("readwrite", async (store) => requestPromise(store.delete([safeUserId, safeDocumentId])));
        return true;
      },

      async markDeleted(userId, documentId) {
        const safeUserId = cleanUserId(userId);
        const safeDocumentId = cleanId(documentId, "");
        if (!safeDocumentId) return null;
        const existing = await this.get(safeUserId, safeDocumentId);
        if (!existing) return null;
        const timestamp = Math.max(now(), (Number(existing.updatedAt) || 0) + 1, (Number(existing.lastSyncedUpdatedAt) || 0) + 1);
        const document = normalizeDocument({ ...existing, updatedAt: timestamp, deletedAt: timestamp });
        await this.put(safeUserId, document);
        return document;
      },

      async purge(userId) {
        const safeUserId = cleanUserId(userId);
        return withStore("readwrite", (store) => new Promise((resolve, reject) => {
          let removed = 0;
          const request = store.index("by_user").openCursor(safeUserId);
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
              resolve(removed);
              return;
            }
            cursor.delete();
            removed += 1;
            cursor.continue();
          };
          request.onerror = () => reject(request.error || new Error("Lokale Skizzen konnten nicht entfernt werden."));
        }));
      },

      async close() {
        if (!databasePromise) return;
        const database = await databasePromise;
        database.close();
        databasePromise = null;
      },
    });
  }

  function pointDistanceToSegment(px, py, ax, ay, bx, by) {
    const abX = bx - ax;
    const abY = by - ay;
    const lengthSquared = abX * abX + abY * abY;
    if (!lengthSquared) return Math.hypot(px - ax, py - ay);
    const projection = clamp(((px - ax) * abX + (py - ay) * abY) / lengthSquared, 0, 1);
    return Math.hypot(px - (ax + projection * abX), py - (ay + projection * abY));
  }

  function textLines(context, element) {
    const maxWidth = Math.max(40, element.width);
    const paragraphs = element.text.split("\n");
    const lines = [];
    paragraphs.forEach((paragraph) => {
      if (!paragraph) {
        lines.push("");
        return;
      }
      const words = paragraph.split(/\s+/);
      let line = "";
      words.forEach((word) => {
        const candidate = line ? `${line} ${word}` : word;
        if (line && context.measureText(candidate).width > maxWidth) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      });
      lines.push(line);
    });
    return lines;
  }

  function strokeBounds(element) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let index = 0; index < element.points.length; index += 4) {
      minX = Math.min(minX, element.points[index]);
      minY = Math.min(minY, element.points[index + 1]);
      maxX = Math.max(maxX, element.points[index]);
      maxY = Math.max(maxY, element.points[index + 1]);
    }
    const padding = element.width / 2;
    return { x: minX - padding, y: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
  }

  function elementBounds(element) {
    if (element.type === "stroke") return strokeBounds(element);
    return { x: element.x, y: element.y, width: element.width, height: element.height };
  }

  function hitElement(element, x, y, tolerance) {
    if (element.type === "text") {
      return x >= element.x - tolerance && x <= element.x + element.width + tolerance
        && y >= element.y - tolerance && y <= element.y + element.height + tolerance;
    }
    const points = element.points;
    if (points.length === 4) return Math.hypot(x - points[0], y - points[1]) <= element.width / 2 + tolerance;
    for (let index = 4; index < points.length; index += 4) {
      if (pointDistanceToSegment(x, y, points[index - 4], points[index - 3], points[index], points[index + 1]) <= element.width / 2 + tolerance) return true;
    }
    return false;
  }

  function findElementAt(elements, x, y, tolerance) {
    for (let index = elements.length - 1; index >= 0; index -= 1) {
      if (hitElement(elements[index], x, y, tolerance)) return { element: elements[index], index };
    }
    return null;
  }

  function translateElement(elementValue, deltaX, deltaY) {
    const element = clone(elementValue);
    if (element.type === "stroke") {
      for (let index = 0; index < element.points.length; index += 4) {
        element.points[index] = round(clamp(element.points[index] + deltaX, 0, WORLD_WIDTH), 2);
        element.points[index + 1] = round(clamp(element.points[index + 1] + deltaY, 0, WORLD_HEIGHT), 2);
      }
    } else {
      element.x = round(clamp(element.x + deltaX, 0, WORLD_WIDTH - element.width), 2);
      element.y = round(clamp(element.y + deltaY, 0, WORLD_HEIGHT - element.height), 2);
    }
    element.updatedAt = now();
    return element;
  }

  function makeHistory(elementsAccessor, onChange, maxEntries = LIMITS.historyEntries, maxBytes = LIMITS.historyBytes) {
    const undoEntries = [];
    const redoEntries = [];
    let undoBytes = 0;
    const elements = () => elementsAccessor();
    const replace = (id, value) => {
      const index = elements().findIndex((element) => element.id === id);
      if (index >= 0) elements().splice(index, 1, clone(value));
    };
    const remove = (id) => {
      const index = elements().findIndex((element) => element.id === id);
      if (index >= 0) elements().splice(index, 1);
    };
    const insert = (value, index) => {
      if (elements().some((element) => element.id === value.id)) return;
      elements().splice(clamp(index, 0, elements().length), 0, clone(value));
    };
    const apply = (command, direction) => {
      if (command.type === "add") {
        if (direction === "undo") remove(command.element.id);
        else insert(command.element, command.index);
      } else if (command.type === "delete") {
        if (direction === "undo") [...command.items].sort((a, b) => a.index - b.index).forEach((item) => insert(item.element, item.index));
        else command.items.forEach((item) => remove(item.element.id));
      } else if (command.type === "update") {
        replace(command.before.id, direction === "undo" ? command.before : command.after);
      }
      onChange(direction);
    };
    return Object.freeze({
      push(command) {
        const copy = clone(command);
        copy._historyBytes = estimatedBytes(copy);
        undoEntries.push(copy);
        undoBytes += copy._historyBytes;
        while (undoEntries.length > maxEntries || (undoEntries.length > 1 && undoBytes > maxBytes)) {
          undoBytes -= undoEntries.shift()._historyBytes || 0;
        }
        redoEntries.length = 0;
      },
      undo() {
        const command = undoEntries.pop();
        if (!command) return false;
        undoBytes -= command._historyBytes || 0;
        apply(command, "undo");
        redoEntries.push(command);
        return true;
      },
      redo() {
        const command = redoEntries.pop();
        if (!command) return false;
        apply(command, "redo");
        undoEntries.push(command);
        undoBytes += command._historyBytes || 0;
        return true;
      },
      clear() { undoEntries.length = 0; redoEntries.length = 0; undoBytes = 0; },
      state() { return { canUndo: undoEntries.length > 0, canRedo: redoEntries.length > 0 }; },
    });
  }

  function simplifyStrokePoints(points, tolerance) {
    if (!Array.isArray(points) || points.length <= 8) return Array.isArray(points) ? [...points] : [];
    const count = Math.floor(points.length / 4);
    const squaredTolerance = Math.max(0.04, tolerance * tolerance);
    const keep = new Uint8Array(count);
    keep[0] = 1;
    keep[count - 1] = 1;
    const stack = [[0, count - 1]];
    while (stack.length) {
      const [first, last] = stack.pop();
      const ax = points[first * 4];
      const ay = points[first * 4 + 1];
      const bx = points[last * 4];
      const by = points[last * 4 + 1];
      let farthest = -1;
      let farthestDistance = squaredTolerance;
      for (let index = first + 1; index < last; index += 1) {
        const distance = pointDistanceToSegment(points[index * 4], points[index * 4 + 1], ax, ay, bx, by);
        const distanceSquared = distance * distance;
        // Auch starke Druckänderungen müssen erhalten bleiben.
        const pressureDelta = Math.abs(points[index * 4 + 2] - points[first * 4 + 2]);
        if (distanceSquared > farthestDistance || pressureDelta > 0.18) {
          farthest = index;
          farthestDistance = Math.max(distanceSquared, farthestDistance);
        }
      }
      if (farthest > first && farthest < last) {
        keep[farthest] = 1;
        stack.push([first, farthest], [farthest, last]);
      }
    }
    const result = [];
    for (let index = 0; index < count; index += 1) {
      if (keep[index]) result.push(...points.slice(index * 4, index * 4 + 4));
    }
    return result.length >= 4 ? result : points.slice(0, 4);
  }

  function drawStroke(context, element) {
    const points = element.points;
    if (!points.length) return;
    context.save();
    context.strokeStyle = element.color;
    context.fillStyle = element.color;
    context.globalAlpha = element.opacity;
    context.lineCap = "round";
    context.lineJoin = "round";
    if (points.length === 4) {
      const pressure = element.tool === "marker" ? 1 : 0.55 + points[2] * 0.7;
      context.beginPath();
      context.arc(points[0], points[1], element.width * pressure / 2, 0, Math.PI * 2);
      context.fill();
      context.restore();
      return;
    }
    if (element.tool === "marker") {
      context.lineWidth = element.width;
      context.beginPath();
      context.moveTo(points[0], points[1]);
      for (let index = 4; index < points.length; index += 4) context.lineTo(points[index], points[index + 1]);
      context.stroke();
      context.restore();
      return;
    }
    for (let index = 4; index < points.length; index += 4) {
      const pressure = element.tool === "marker" ? 1 : 0.55 + ((points[index - 2] + points[index + 2]) / 2) * 0.7;
      context.lineWidth = element.width * pressure;
      context.beginPath();
      context.moveTo(points[index - 4], points[index - 3]);
      context.lineTo(points[index], points[index + 1]);
      context.stroke();
    }
    context.restore();
  }

  function drawText(context, element) {
    context.save();
    context.fillStyle = element.color;
    context.globalAlpha = 1;
    context.textBaseline = "top";
    context.textAlign = element.align;
    context.font = `${element.fontWeight} ${element.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    const lines = textLines(context, element);
    const lineHeight = element.fontSize * 1.22;
    const x = element.align === "center" ? element.x + element.width / 2 : element.align === "right" ? element.x + element.width : element.x;
    lines.forEach((line, index) => context.fillText(line, x, element.y + index * lineHeight, element.width));
    context.restore();
  }

  function renderDocument(context, documentValue, options = {}) {
    const document = options.trusted === true ? documentValue : normalizeDocument(documentValue);
    const scale = clamp(finite(options.scale, 1), 0.001, 100);
    const offsetX = finite(options.offsetX, 0);
    const offsetY = finite(options.offsetY, 0);
    const viewportWidth = finite(options.viewportWidth, context.canvas.width);
    const viewportHeight = finite(options.viewportHeight, context.canvas.height);
    context.save();
    const pixelRatio = clamp(finite(options.pixelRatio, 1), 1, 4);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, viewportWidth, viewportHeight);
    if (options.workspace !== false) {
      context.fillStyle = options.workspaceColor || "#dfe3e8";
      context.fillRect(0, 0, viewportWidth, viewportHeight);
    }
    context.translate(offsetX, offsetY);
    context.scale(scale, scale);
    if (options.shadow !== false) {
      context.save();
      context.shadowColor = "rgba(15,23,42,.22)";
      context.shadowBlur = 22 / Math.max(scale, 0.01);
      context.shadowOffsetY = 8 / Math.max(scale, 0.01);
      context.fillStyle = document.canvas.background;
      context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      context.restore();
    } else {
      context.fillStyle = document.canvas.background;
      context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    }
    const visible = {
      x: -offsetX / scale,
      y: -offsetY / scale,
      width: viewportWidth / scale,
      height: viewportHeight / scale,
    };
    document.elements.forEach((element) => {
      const bounds = elementBounds(element);
      if (bounds.x + bounds.width < visible.x || bounds.y + bounds.height < visible.y
        || bounds.x > visible.x + visible.width || bounds.y > visible.y + visible.height) return;
      if (element.type === "stroke") drawStroke(context, element);
      else drawText(context, element);
    });
    if (options.selectedId) {
      const selected = document.elements.find((element) => element.id === options.selectedId);
      if (selected) {
        const bounds = elementBounds(selected);
        context.save();
        context.strokeStyle = "#2563eb";
        context.lineWidth = 2 / scale;
        context.setLineDash([10 / scale, 8 / scale]);
        context.strokeRect(bounds.x - 8 / scale, bounds.y - 8 / scale, bounds.width + 16 / scale, bounds.height + 16 / scale);
        context.restore();
      }
    }
    context.restore();
    return document;
  }

  function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
      if (typeof canvas.toBlob === "function") {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Bild konnte nicht erzeugt werden.")), mimeType, quality);
        return;
      }
      try {
        const dataUrl = canvas.toDataURL(mimeType, quality);
        const [header, body] = dataUrl.split(",");
        const binary = global.atob(body);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        resolve(new Blob([bytes], { type: header.match(/data:([^;]+)/)?.[1] || mimeType }));
      } catch (error) { reject(error); }
    });
  }

  async function documentToBlob(documentValue, options = {}) {
    if (!global.document?.createElement) throw new Error("Bildexport benötigt einen Browser.");
    const document = normalizeDocument(documentValue);
    const maxWidth = clamp(finite(options.maxWidth, WORLD_WIDTH), 64, 4096);
    const scale = Math.min(1, maxWidth / WORLD_WIDTH);
    const canvas = global.document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(WORLD_WIDTH * scale));
    canvas.height = Math.max(1, Math.round(WORLD_HEIGHT * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas wird von diesem Browser nicht unterstützt.");
    renderDocument(context, document, {
      scale,
      offsetX: 0,
      offsetY: 0,
      viewportWidth: canvas.width,
      viewportHeight: canvas.height,
      workspace: false,
      shadow: false,
      trusted: true,
    });
    return canvasToBlob(canvas, options.mimeType || "image/png", finite(options.quality, 0.9));
  }

  function resolveElement(root, value, fallbackSelector) {
    if (value && typeof value !== "string") return value;
    const selector = value || fallbackSelector;
    return selector ? root.querySelector(selector) : null;
  }

  function createFallbackTextPanel(root) {
    const panel = global.document.createElement("div");
    panel.className = "sketch-text-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Text einfügen");
    panel.style.cssText = "position:absolute;left:12px;right:12px;bottom:12px;z-index:8;padding:12px;background:var(--surface,#fff);border:1px solid var(--border,#ddd);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.2)";
    const textarea = global.document.createElement("textarea");
    textarea.dataset.sketchTextInput = "";
    textarea.maxLength = LIMITS.text;
    textarea.rows = 3;
    textarea.autocomplete = "off";
    textarea.style.cssText = "display:block;width:100%;min-height:72px;padding:10px;border:1px solid #bbb;border-radius:9px;font:16px system-ui;resize:vertical";
    const actions = global.document.createElement("div");
    actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:8px";
    const cancel = global.document.createElement("button");
    cancel.type = "button";
    cancel.dataset.sketchTextCancel = "";
    cancel.textContent = "Abbrechen";
    const apply = global.document.createElement("button");
    apply.type = "button";
    apply.dataset.sketchTextApply = "";
    apply.textContent = "Übernehmen";
    actions.append(cancel, apply);
    panel.append(textarea, actions);
    root.append(panel);
    return { panel, textarea, apply, cancel, generated: true };
  }

  function createEditor(options = {}) {
    if (!global.document) throw new Error("Der Skizzeneditor benötigt einen Browser.");
    const root = typeof options.root === "string"
      ? global.document.querySelector(options.root)
      : (options.root || global.document);
    if (!root) throw new Error("Skizzeneditor-Container nicht gefunden.");
    const canvas = resolveElement(root, options.canvas, "#sketch-canvas, [data-sketch-canvas]");
    if (!canvas?.getContext) throw new Error("Skizzen-Canvas nicht gefunden.");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas-Kontext ist nicht verfügbar.");

    let documentValue = normalizeDocument(options.document || createDocument());
    let tool = TOOLS.has(options.tool) ? options.tool : "pen";
    let color = cleanColor(options.color, "#111111");
    let penWidth = clamp(finite(options.width, 5), 0.5, 100);
    let pencilOnly = !!options.pencilOnly;
    let selectedId = null;
    let dirty = false;
    let destroyed = false;
    let renderFrame = 0;
    let fitted = false;
    let spacePressed = false;
    let lastPenAt = 0;
    let gesture = null;
    let pinch = null;
    let draftStroke = null;
    let textDraft = null;
    let saveTimer = 0;
    let saveInFlight = null;
    let saveRequested = false;
    let localRevision = 0;
    const pointers = new Map();
    const listeners = [];
    const view = { scale: 1, offsetX: 0, offsetY: 0 };
    const toast = typeof options.toast === "function" ? options.toast : () => {};
    const onSave = typeof options.onSave === "function" ? options.onSave : async () => {};
    const onClose = typeof options.onClose === "function" ? options.onClose : () => {};
    const statusElement = resolveElement(root, options.statusElement, "#sketch-save-status, [data-sketch-save-status]");
    const undoButton = resolveElement(root, options.undoButton, "#sketch-undo, [data-sketch-undo]");
    const redoButton = resolveElement(root, options.redoButton, "#sketch-redo, [data-sketch-redo]");
    const deleteButton = resolveElement(root, options.deleteButton, "#sketch-delete-selection, [data-sketch-delete-selection]");
    const saveButton = resolveElement(root, options.saveButton, "#sketch-save, [data-sketch-save]");
    const closeButton = resolveElement(root, options.closeButton, "#sketch-close, [data-sketch-close]");
    const exportButton = resolveElement(root, options.exportButton, "#sketch-export, [data-sketch-export]");
    const colorInput = resolveElement(root, options.colorInput, "#sketch-color, [data-sketch-color]");
    const widthInput = resolveElement(root, options.widthInput, "#sketch-width, [data-sketch-width]");
    const pencilOnlyInput = resolveElement(root, options.pencilOnlyInput, "#sketch-pencil-only, [data-sketch-pencil-only]");
    let textPanel = resolveElement(root, options.textPanel, "#sketch-text-panel, [data-sketch-text-panel]");
    let textInput;
    let textApply;
    let textCancel;
    let generatedTextPanel = false;
    if (textPanel) {
      textInput = resolveElement(textPanel, options.textInput, "#sketch-text-input, [data-sketch-text-input]");
      textApply = resolveElement(textPanel, options.textApply, "#sketch-text-apply, [data-sketch-text-apply]");
      textCancel = resolveElement(textPanel, options.textCancel, "#sketch-text-cancel, [data-sketch-text-cancel]");
    }
    if (!textPanel || !textInput || !textApply || !textCancel) {
      const fallback = createFallbackTextPanel(root === global.document ? global.document.body : root);
      textPanel = fallback.panel;
      textInput = fallback.textarea;
      textApply = fallback.apply;
      textCancel = fallback.cancel;
      generatedTextPanel = true;
    }

    const listen = (target, name, handler, settings) => {
      if (!target?.addEventListener) return;
      target.addEventListener(name, handler, settings);
      listeners.push(() => target.removeEventListener(name, handler, settings));
    };
    const setStatus = (text) => { if (statusElement) statusElement.textContent = text; };
    const rect = () => canvas.getBoundingClientRect();
    const screenPoint = (event) => {
      const bounds = rect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    const screenToWorld = (x, y) => ({ x: (x - view.offsetX) / view.scale, y: (y - view.offsetY) / view.scale });
    const eventToWorld = (event) => {
      const point = screenPoint(event);
      return screenToWorld(point.x, point.y);
    };
    const insidePage = (point) => point.x >= 0 && point.y >= 0 && point.x <= WORLD_WIDTH && point.y <= WORLD_HEIGHT;

    function updateButtons() {
      const state = history.state();
      if (undoButton) undoButton.disabled = !state.canUndo;
      if (redoButton) redoButton.disabled = !state.canRedo;
      if (deleteButton) deleteButton.disabled = !selectedId;
      root.querySelectorAll?.("[data-sketch-tool]").forEach((button) => {
        const active = button.dataset.sketchTool === tool;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      if (pencilOnlyInput) {
        if (pencilOnlyInput.matches?.("input")) pencilOnlyInput.checked = pencilOnly;
        else {
          pencilOnlyInput.setAttribute("aria-pressed", String(pencilOnly));
          pencilOnlyInput.classList.toggle("is-active", pencilOnly);
        }
      }
      if (colorInput && colorInput.value !== color) colorInput.value = color;
      if (widthInput && Number(widthInput.value) !== penWidth) widthInput.value = String(penWidth);
    }

    function draw() {
      renderFrame = 0;
      if (destroyed) return;
      const bounds = rect();
      const width = Math.max(1, Math.round(bounds.width || canvas.clientWidth || 800));
      const height = Math.max(1, Math.round(bounds.height || canvas.clientHeight || 600));
      const dpr = clamp(finite(global.devicePixelRatio, 1), 1, 3);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderDocument(context, documentValue, {
        scale: view.scale,
        offsetX: view.offsetX,
        offsetY: view.offsetY,
        viewportWidth: width,
        viewportHeight: height,
        selectedId,
        pixelRatio: dpr,
        trusted: true,
      });
      if (draftStroke) {
        context.save();
        context.translate(view.offsetX, view.offsetY);
        context.scale(view.scale, view.scale);
        drawStroke(context, draftStroke);
        context.restore();
      }
    }

    function requestDraw() {
      if (!renderFrame && !destroyed) renderFrame = global.requestAnimationFrame ? global.requestAnimationFrame(draw) : global.setTimeout(draw, 0);
    }

    function fit() {
      const bounds = rect();
      const width = Math.max(1, bounds.width || canvas.clientWidth || 800);
      const height = Math.max(1, bounds.height || canvas.clientHeight || 600);
      const padding = Math.min(42, Math.max(14, Math.min(width, height) * 0.035));
      view.scale = clamp(Math.min((width - padding * 2) / WORLD_WIDTH, (height - padding * 2) / WORLD_HEIGHT), LIMITS.minZoom, LIMITS.maxZoom);
      view.offsetX = (width - WORLD_WIDTH * view.scale) / 2;
      view.offsetY = (height - WORLD_HEIGHT * view.scale) / 2;
      fitted = true;
      requestDraw();
    }

    function zoomAt(screenX, screenY, nextScale) {
      const anchor = screenToWorld(screenX, screenY);
      view.scale = clamp(nextScale, LIMITS.minZoom, LIMITS.maxZoom);
      view.offsetX = screenX - anchor.x * view.scale;
      view.offsetY = screenY - anchor.y * view.scale;
      fitted = false;
      requestDraw();
    }

    async function flushSave(reason = "manual") {
      global.clearTimeout(saveTimer);
      saveRequested = true;
      if (saveInFlight) return saveInFlight;
      saveInFlight = (async () => {
        try {
          do {
            saveRequested = false;
            const snapshotRevision = localRevision;
            const snapshot = normalizeDocument({ ...documentValue, updatedAt: Math.max(now(), documentValue.updatedAt) });
            documentValue = snapshot;
            setStatus("Wird gespeichert …");
            await onSave(clone(snapshot), { reason });
            dirty = localRevision !== snapshotRevision;
            if (dirty) saveRequested = true;
          } while (saveRequested);
          setStatus("Gespeichert");
          return clone(documentValue);
        } catch (error) {
          dirty = true;
          setStatus("Speichern fehlgeschlagen");
          toast("Skizze konnte nicht gespeichert werden");
          throw error;
        } finally {
          saveInFlight = null;
          if (saveRequested && !destroyed) global.setTimeout(() => { flushSave(reason).catch(() => {}); }, 0);
        }
      })();
      return saveInFlight;
    }

    function queueSave(reason = "edit") {
      localRevision += 1;
      dirty = true;
      documentValue.updatedAt = Math.max(now(), (Number(documentValue.updatedAt) || 0) + 1, (Number(documentValue.lastSyncedUpdatedAt) || 0) + 1);
      setStatus("Nicht gespeichert");
      global.clearTimeout(saveTimer);
      saveTimer = global.setTimeout(() => { flushSave(reason).catch(() => {}); }, 140);
    }

    function historyChanged() {
      documentValue.updatedAt = now();
      selectedId = documentValue.elements.some((element) => element.id === selectedId) ? selectedId : null;
      queueSave("history");
      updateButtons();
      requestDraw();
    }

    const history = makeHistory(() => documentValue.elements, historyChanged);

    function addElement(element) {
      if (documentValue.elements.length >= LIMITS.elements) {
        toast("Diese Skizze hat ihr Element-Limit erreicht");
        return false;
      }
      const index = documentValue.elements.length;
      documentValue.elements.push(element);
      history.push({ type: "add", element, index });
      documentValue.updatedAt = now();
      selectedId = element.id;
      queueSave("pointer-up");
      updateButtons();
      requestDraw();
      return true;
    }

    function removeAtPoint(point) {
      const hit = findElementAt(documentValue.elements, point.x, point.y, 13 / view.scale);
      if (!hit || gesture?.removed?.has(hit.element.id)) return;
      const originalIndex = gesture?.originalOrder?.indexOf(hit.element.id);
      gesture.removed.set(hit.element.id, { element: clone(hit.element), index: originalIndex >= 0 ? originalIndex : hit.index });
      documentValue.elements.splice(hit.index, 1);
      if (selectedId === hit.element.id) selectedId = null;
      requestDraw();
    }

    function beginText(point, existingElement) {
      if (!insidePage(point)) return;
      const existing = existingElement?.type === "text" ? existingElement : null;
      textDraft = { point, existing: existing ? clone(existing) : null };
      textInput.value = existing?.text || "";
      textPanel.hidden = false;
      global.setTimeout(() => { textInput.focus(); textInput.select?.(); }, 0);
    }

    function closeTextPanel() {
      textPanel.hidden = true;
      textInput.value = "";
      textDraft = null;
      canvas.focus?.();
    }

    function applyText() {
      if (!textDraft) return;
      const value = cleanMultiline(textInput.value, LIMITS.text);
      if (!value) { closeTextPanel(); return; }
      if (textDraft.existing) {
        const before = textDraft.existing;
        const index = documentValue.elements.findIndex((element) => element.id === before.id);
        if (index >= 0) {
          const rawAfter = { ...before, text: value, color, updatedAt: now() };
          delete rawAfter.height;
          const after = normalizeText(rawAfter, new Set(documentValue.elements.filter((element) => element.id !== before.id).map((element) => element.id)));
          documentValue.elements.splice(index, 1, after);
          history.push({ type: "update", before, after });
          selectedId = after.id;
          documentValue.updatedAt = now();
          queueSave("text");
        }
      } else {
        const usedIds = new Set(documentValue.elements.map((element) => element.id));
        const element = normalizeText({
          id: createId(),
          text: value,
          x: textDraft.point.x,
          y: textDraft.point.y,
          width: Math.min(600, WORLD_WIDTH - textDraft.point.x),
          color,
          fontSize: clamp(finite(options.textSize, 48), 12, 240),
        }, usedIds);
        if (element) addElement(element);
      }
      closeTextPanel();
      updateButtons();
      requestDraw();
    }

    function pressureOf(event) {
      const pressure = Number(event.pressure);
      if (Number.isFinite(pressure) && pressure > 0) return clamp(pressure, 0, 1);
      return event.pointerType === "mouse" ? 0.5 : 0.55;
    }

    function appendStrokeEvent(event, canvasBounds) {
      if (!draftStroke) return;
      const bounds = canvasBounds || rect();
      const point = screenToWorld(event.clientX - bounds.left, event.clientY - bounds.top);
      if (!insidePage(point)) return;
      const points = draftStroke.points;
      const lastX = points.length ? points[points.length - 4] : NaN;
      const lastY = points.length ? points[points.length - 3] : NaN;
      if (Number.isFinite(lastX) && Math.hypot(point.x - lastX, point.y - lastY) < Math.max(0.25, 0.7 / view.scale)) return;
      if (points.length / 4 >= LIMITS.pointsPerStroke) return;
      points.push(round(point.x, 2), round(point.y, 2), round(pressureOf(event), 3), Math.round(clamp(event.timeStamp - gesture.startedAt, 0, 86400000)));
    }

    function touchPointers() {
      return [...pointers.values()].filter((pointer) => pointer.pointerType === "touch" && !pointer.ignored);
    }

    function beginPinch() {
      const touches = touchPointers();
      if (touches.length < 2 || Date.now() - lastPenAt < 350) return false;
      draftStroke = null;
      gesture = null;
      const first = touches[0];
      const second = touches[1];
      const centroid = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      pinch = {
        ids: [first.id, second.id],
        startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
        startScale: view.scale,
        worldAnchor: screenToWorld(centroid.x, centroid.y),
      };
      return true;
    }

    function updatePinch() {
      if (!pinch) return;
      const first = pointers.get(pinch.ids[0]);
      const second = pointers.get(pinch.ids[1]);
      if (!first || !second) return;
      const centroid = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      view.scale = clamp(pinch.startScale * distance / pinch.startDistance, LIMITS.minZoom, LIMITS.maxZoom);
      view.offsetX = centroid.x - pinch.worldAnchor.x * view.scale;
      view.offsetY = centroid.y - pinch.worldAnchor.y * view.scale;
      fitted = false;
      requestDraw();
    }

    function pointerDown(event) {
      if (destroyed || event.button > 1) return;
      event.preventDefault();
      const screen = screenPoint(event);
      const pointer = { id: event.pointerId, x: screen.x, y: screen.y, pointerType: event.pointerType || "mouse", ignored: false };
      if (pointer.pointerType === "pen") lastPenAt = Date.now();
      if (pointer.pointerType === "touch" && (Date.now() - lastPenAt < 350 || [...pointers.values()].some((item) => item.pointerType === "pen"))) pointer.ignored = true;
      pointers.set(event.pointerId, pointer);
      try { canvas.setPointerCapture(event.pointerId); } catch (_error) { /* Nicht in jedem Testbrowser vorhanden. */ }

      if (touchPointers().length >= 2 && beginPinch()) return;
      if (pointer.ignored) return;
      const point = eventToWorld(event);
      const effectiveTool = (spacePressed || event.button === 1 || (event.pointerType === "touch" && pencilOnly)) ? "pan" : tool;
      gesture = { pointerId: event.pointerId, tool: effectiveTool, startedAt: event.timeStamp, startScreen: screen, startWorld: point };

      if (effectiveTool === "pan") {
        gesture.startOffset = { x: view.offsetX, y: view.offsetY };
      } else if (effectiveTool === "pen" || effectiveTool === "marker") {
        if (!insidePage(point)) { gesture = null; return; }
        const totalPoints = documentValue.elements.reduce((sum, element) => sum + (element.type === "stroke" ? element.points.length / 4 : 0), 0);
        if (totalPoints >= LIMITS.totalPoints) { gesture = null; toast("Diese Skizze hat ihr Punkt-Limit erreicht"); return; }
        draftStroke = {
          id: createId(),
          type: "stroke",
          tool: effectiveTool,
          color: effectiveTool === "marker" && color === "#111111" ? "#f5c542" : color,
          width: effectiveTool === "marker" ? Math.max(18, penWidth * 4) : penWidth,
          opacity: effectiveTool === "marker" ? 0.28 : 1,
          points: [],
          createdAt: now(),
          updatedAt: now(),
        };
        appendStrokeEvent(event, rect());
      } else if (effectiveTool === "eraser") {
        gesture.removed = new Map();
        gesture.originalOrder = documentValue.elements.map((element) => element.id);
        if (insidePage(point)) removeAtPoint(point);
      } else if (effectiveTool === "select") {
        const hit = insidePage(point) ? findElementAt(documentValue.elements, point.x, point.y, 13 / view.scale) : null;
        selectedId = hit?.element.id || null;
        if (hit) gesture.before = clone(hit.element);
        updateButtons();
        requestDraw();
      } else if (effectiveTool === "text") {
        const hit = insidePage(point) ? findElementAt(documentValue.elements, point.x, point.y, 10 / view.scale) : null;
        beginText(point, hit?.element?.type === "text" ? hit.element : null);
        gesture = null;
      }
    }

    function pointerMove(event) {
      const pointer = pointers.get(event.pointerId);
      if (!pointer) return;
      event.preventDefault();
      const screen = screenPoint(event);
      pointer.x = screen.x;
      pointer.y = screen.y;
      if (event.pointerType === "pen") lastPenAt = Date.now();
      if (pinch) { updatePinch(); return; }
      if (!gesture || gesture.pointerId !== event.pointerId || pointer.ignored) return;
      const point = eventToWorld(event);
      if (gesture.tool === "pan") {
        view.offsetX = gesture.startOffset.x + screen.x - gesture.startScreen.x;
        view.offsetY = gesture.startOffset.y + screen.y - gesture.startScreen.y;
        fitted = false;
        requestDraw();
      } else if (gesture.tool === "pen" || gesture.tool === "marker") {
        const events = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [event];
        const canvasBounds = rect();
        events.forEach((coalescedEvent) => appendStrokeEvent(coalescedEvent, canvasBounds));
        requestDraw();
      } else if (gesture.tool === "eraser") {
        if (insidePage(point)) removeAtPoint(point);
      } else if (gesture.tool === "select" && gesture.before && selectedId) {
        const index = documentValue.elements.findIndex((element) => element.id === selectedId);
        if (index >= 0) documentValue.elements.splice(index, 1, translateElement(gesture.before, point.x - gesture.startWorld.x, point.y - gesture.startWorld.y));
        requestDraw();
      }
    }

    function finishPointer(event, cancelled) {
      const pointer = pointers.get(event.pointerId);
      pointers.delete(event.pointerId);
      try { if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch (_error) { /* optional */ }
      if (pinch) {
        if (!pointers.has(pinch.ids[0]) || !pointers.has(pinch.ids[1])) pinch = null;
        gesture = null;
        requestDraw();
        return;
      }
      if (!gesture || gesture.pointerId !== event.pointerId || pointer?.ignored) return;
      if ((gesture.tool === "pen" || gesture.tool === "marker") && draftStroke) {
        if (!cancelled && draftStroke.points.length) {
          draftStroke.points = simplifyStrokePoints(draftStroke.points, Math.max(0.35, draftStroke.width * 0.035));
          const currentTotal = documentValue.elements.reduce((sum, element) => sum + (element.type === "stroke" ? element.points.length / 4 : 0), 0);
          const normalized = normalizeStroke(draftStroke, LIMITS.totalPoints - currentTotal, new Set(documentValue.elements.map((element) => element.id)));
          if (normalized) addElement(normalized);
        }
        draftStroke = null;
      } else if (gesture.tool === "eraser") {
        const items = [...gesture.removed.values()];
        if (!cancelled && items.length) {
          history.push({ type: "delete", items });
          documentValue.updatedAt = now();
          queueSave("pointer-up");
          updateButtons();
        } else if (cancelled && items.length) {
          items.sort((a, b) => a.index - b.index).forEach((item) => documentValue.elements.splice(clamp(item.index, 0, documentValue.elements.length), 0, item.element));
        }
      } else if (gesture.tool === "select" && gesture.before && selectedId) {
        const after = documentValue.elements.find((element) => element.id === selectedId);
        if (!cancelled && after && JSON.stringify(after) !== JSON.stringify(gesture.before)) {
          history.push({ type: "update", before: gesture.before, after });
          documentValue.updatedAt = now();
          queueSave("pointer-up");
          updateButtons();
        } else if (cancelled && after) {
          const index = documentValue.elements.findIndex((element) => element.id === selectedId);
          documentValue.elements.splice(index, 1, gesture.before);
        }
      }
      gesture = null;
      requestDraw();
    }

    function wheel(event) {
      event.preventDefault();
      const point = screenPoint(event);
      zoomAt(point.x, point.y, view.scale * Math.exp(-event.deltaY * 0.0015));
    }

    function deleteSelected() {
      if (!selectedId) return false;
      const index = documentValue.elements.findIndex((element) => element.id === selectedId);
      if (index < 0) return false;
      const element = documentValue.elements[index];
      documentValue.elements.splice(index, 1);
      history.push({ type: "delete", items: [{ element, index }] });
      selectedId = null;
      historyChanged();
      return true;
    }

    function keyDown(event) {
      const target = event.target;
      const editingText = target === textInput || target?.matches?.("input,textarea,[contenteditable=true]");
      if (editingText) {
        if (event.key === "Escape") { event.preventDefault(); closeTextPanel(); }
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); applyText(); }
        return;
      }
      if (target?.closest?.("button,a,select,input,textarea,[contenteditable=true]")) return;
      if (event.code === "Space") { spacePressed = true; event.preventDefault(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) history.redo(); else history.undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault(); history.redo();
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        deleteSelected();
      } else if (event.key === "Escape") {
        selectedId = null; requestDraw();
      }
    }

    const keyUp = (event) => { if (event.code === "Space") spacePressed = false; };
    const toolClick = (event) => {
      const button = event.target.closest?.("[data-sketch-tool]");
      if (button && TOOLS.has(button.dataset.sketchTool)) {
        tool = button.dataset.sketchTool;
        updateButtons();
      }
    };
    const colorChange = () => { color = cleanColor(colorInput.value, color); };
    const widthChange = () => { penWidth = clamp(finite(widthInput.value, penWidth), 0.5, 100); };
    const pencilChange = () => {
      pencilOnly = pencilOnlyInput.matches?.("input") ? !!pencilOnlyInput.checked : !pencilOnly;
      updateButtons();
    };
    const resize = () => { if (fitted) fit(); else requestDraw(); };

    listen(canvas, "pointerdown", pointerDown, { passive: false });
    listen(canvas, "pointermove", pointerMove, { passive: false });
    listen(canvas, "pointerup", (event) => finishPointer(event, false), { passive: false });
    listen(canvas, "pointercancel", (event) => finishPointer(event, true), { passive: false });
    listen(canvas, "lostpointercapture", (event) => { if (pointers.has(event.pointerId)) finishPointer(event, false); });
    listen(canvas, "wheel", wheel, { passive: false });
    listen(root, "click", toolClick);
    listen(global, "keydown", keyDown);
    listen(global, "keyup", keyUp);
    listen(colorInput, "input", colorChange);
    listen(widthInput, "input", widthChange);
    listen(pencilOnlyInput, pencilOnlyInput?.matches?.("input") ? "change" : "click", pencilChange);
    listen(undoButton, "click", () => history.undo());
    listen(redoButton, "click", () => history.redo());
    listen(deleteButton, "click", deleteSelected);
    listen(saveButton, "click", () => flushSave("manual").catch(() => {}));
    listen(closeButton, "click", async () => {
      try { if (dirty) await flushSave("close"); } catch (_error) { return; }
      onClose(clone(documentValue));
    });
    listen(exportButton, "click", async () => {
      try {
        const blob = await documentToBlob(documentValue, { mimeType: "image/png" });
        const url = URL.createObjectURL(blob);
        const link = global.document.createElement("a");
        link.href = url;
        link.download = `${documentValue.title.replace(/[^A-Za-z0-9ÄÖÜäöüß _-]/g, "").trim() || "Skizze"}.png`;
        link.click();
        global.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (_error) { toast("PNG konnte nicht exportiert werden"); }
    });
    listen(textApply, "click", applyText);
    listen(textCancel, "click", closeTextPanel);
    listen(global, "resize", resize);
    if (global.ResizeObserver) {
      const observer = new global.ResizeObserver(resize);
      observer.observe(canvas);
      listeners.push(() => observer.disconnect());
    }

    canvas.style.touchAction = "none";
    canvas.style.userSelect = "none";
    canvas.setAttribute("aria-label", canvas.getAttribute("aria-label") || "Skizzen-Zeichenfläche");
    if (!canvas.hasAttribute("tabindex")) canvas.tabIndex = 0;
    updateButtons();
    fit();

    return Object.freeze({
      getDocument: () => clone(documentValue),
      setDocument(nextDocument) {
        documentValue = normalizeDocument(nextDocument);
        selectedId = null;
        draftStroke = null;
        history.clear();
        dirty = false;
        localRevision = 0;
        updateButtons();
        fit();
        return clone(documentValue);
      },
      acknowledgeSync(id, cloudVersion, syncedUpdatedAt) {
        if (documentValue.id !== id) return false;
        documentValue.cloudVersion = Math.max(Number(documentValue.cloudVersion) || 0, Math.round(Number(cloudVersion) || 0));
        documentValue.lastSyncedUpdatedAt = Math.max(Number(documentValue.lastSyncedUpdatedAt) || 0, Math.round(Number(syncedUpdatedAt) || 0));
        return true;
      },
      setTool(nextTool) {
        if (!TOOLS.has(nextTool)) throw new TypeError("Unbekanntes Skizzenwerkzeug.");
        tool = nextTool;
        updateButtons();
      },
      getTool: () => tool,
      setPencilOnly(value) { pencilOnly = !!value; updateButtons(); },
      getPencilOnly: () => pencilOnly,
      undo: () => history.undo(),
      redo: () => history.redo(),
      deleteSelection: deleteSelected,
      fit,
      zoomTo(scale, screenX, screenY) {
        const bounds = rect();
        zoomAt(screenX ?? bounds.width / 2, screenY ?? bounds.height / 2, scale);
      },
      zoomBy(factor) {
        const bounds = rect();
        zoomAt(bounds.width / 2, bounds.height / 2, view.scale * finite(factor, 1));
      },
      getView: () => ({ ...view }),
      save: (reason) => flushSave(reason || "api"),
      isDirty: () => dirty,
      thumbnail: (maxWidth = 480) => documentToBlob(documentValue, { maxWidth, mimeType: "image/webp", quality: 0.78 }),
      exportPng: () => documentToBlob(documentValue, { mimeType: "image/png" }),
      async destroy(settings = {}) {
        if (destroyed) return;
        if (dirty && settings.save !== false) {
          try { await flushSave("destroy"); } catch (_error) { /* Status und Toast wurden bereits gesetzt. */ }
        }
        destroyed = true;
        global.clearTimeout(saveTimer);
        if (renderFrame) {
          if (global.cancelAnimationFrame) global.cancelAnimationFrame(renderFrame);
          else global.clearTimeout(renderFrame);
        }
        listeners.splice(0).forEach((remove) => remove());
        if (generatedTextPanel) textPanel.remove();
        pointers.clear();
      },
    });
  }

  global.MomentumSketch = Object.freeze({
    version: "1.0.0",
    schemaVersion: SCHEMA_VERSION,
    world: Object.freeze({ width: WORLD_WIDTH, height: WORLD_HEIGHT }),
    limits: LIMITS,
    tools: Object.freeze([...TOOLS]),
    createId,
    createDocument,
    normalizeDocument,
    estimatedBytes,
    createStore,
    createEditor,
    renderDocument,
    documentToBlob,
    simplifyStrokePoints,
    pointDistanceToSegment,
    _test: Object.freeze({
      normalizeFlatPoints,
      hitElement,
      findElementAt,
      translateElement,
      makeHistory,
    }),
  });
})(typeof window !== "undefined" ? window : globalThis);
