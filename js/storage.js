(function storageModule(global) {
  "use strict";

  const App = global.NotizenApp || (global.NotizenApp = {});
  const DB_NAME = "deutsche-notizen-app";
  const DB_VERSION = 1;
  const NOTES_STORE = "notes";
  const SETTINGS_STORE = "settings";
  const SETTINGS_KEY = "user";
  const LOCAL_NOTES_KEY = "notizenApp.notes";
  const LOCAL_SETTINGS_KEY = "notizenApp.settings";
  const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
  const MAX_IMPORT_NOTES = 200;
  const MAX_NOTE_CONTENT_LENGTH = 500000;
  const MAX_NOTE_TITLE_LENGTH = 120;
  const TEXT_IMPORT_EXTENSIONS = new Set([
    "txt", "text", "md", "markdown", "mdown", "log", "csv", "tsv", "yaml", "yml",
    "xml", "html", "htm", "css", "js", "mjs", "cjs", "ts", "tsx", "jsx", "ini",
    "conf", "config", "toml", "env", "sql", "py", "ps1", "sh", "bat", "cmd",
    "php", "rb", "go", "rs", "java", "c", "cpp", "h", "hpp", "cs", "swift",
    "kt", "dart", "vue", "svelte"
  ]);

  function makeId() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }
    return `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function clone(value) {
    if (value == null) {
      return value;
    }
    return JSON.parse(JSON.stringify(value));
  }

  function toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function toPlainObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB-Anfrage fehlgeschlagen."));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB-Transaktion fehlgeschlagen."));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB-Transaktion abgebrochen."));
    });
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) {
        reject(new Error("IndexedDB ist in diesem Browser nicht verfügbar."));
        return;
      }

      const request = global.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(NOTES_STORE)) {
          const notesStore = db.createObjectStore(NOTES_STORE, { keyPath: "id" });
          notesStore.createIndex("updatedAt", "updatedAt", { unique: false });
          notesStore.createIndex("createdAt", "createdAt", { unique: false });
          notesStore.createIndex("title", "title", { unique: false });
        }
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB konnte nicht geöffnet werden."));
      request.onblocked = () => reject(new Error("IndexedDB ist durch einen anderen Tab blockiert."));
    });
  }

  function createIndexedDbDriver(db) {
    return {
      kind: "IndexedDB",

      async getAllNotes() {
        const transaction = db.transaction(NOTES_STORE, "readonly");
        const notes = await requestToPromise(transaction.objectStore(NOTES_STORE).getAll());
        return toArray(notes);
      },

      async saveNote(note) {
        const transaction = db.transaction(NOTES_STORE, "readwrite");
        transaction.objectStore(NOTES_STORE).put(clone(note));
        await transactionDone(transaction);
      },

      async saveNotes(notes) {
        const transaction = db.transaction(NOTES_STORE, "readwrite");
        const store = transaction.objectStore(NOTES_STORE);
        notes.forEach((note) => store.put(clone(note)));
        await transactionDone(transaction);
      },

      async deleteNote(id) {
        const transaction = db.transaction(NOTES_STORE, "readwrite");
        transaction.objectStore(NOTES_STORE).delete(id);
        await transactionDone(transaction);
      },

      async getSettings() {
        const transaction = db.transaction(SETTINGS_STORE, "readonly");
        const entry = await requestToPromise(transaction.objectStore(SETTINGS_STORE).get(SETTINGS_KEY));
        return entry ? toPlainObject(entry.value) : {};
      },

      async saveSettings(settings) {
        const transaction = db.transaction(SETTINGS_STORE, "readwrite");
        transaction.objectStore(SETTINGS_STORE).put({ key: SETTINGS_KEY, value: clone(settings) });
        await transactionDone(transaction);
      }
    };
  }

  function safeParse(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      console.warn("Lokale Daten konnten nicht gelesen werden:", error);
      return fallback;
    }
  }

  function createLocalStorageDriver() {
    return {
      kind: "localStorage",

      async getAllNotes() {
        return toArray(safeParse(global.localStorage.getItem(LOCAL_NOTES_KEY), []));
      },

      async saveNote(note) {
        const notes = await this.getAllNotes();
        const index = notes.findIndex((item) => item.id === note.id);
        if (index >= 0) {
          notes[index] = clone(note);
        } else {
          notes.push(clone(note));
        }
        global.localStorage.setItem(LOCAL_NOTES_KEY, JSON.stringify(notes));
      },

      async saveNotes(notes) {
        const existing = await this.getAllNotes();
        const byId = new Map(existing.map((note) => [note.id, note]));
        notes.forEach((note) => byId.set(note.id, clone(note)));
        global.localStorage.setItem(LOCAL_NOTES_KEY, JSON.stringify(Array.from(byId.values())));
      },

      async deleteNote(id) {
        const notes = await this.getAllNotes();
        global.localStorage.setItem(LOCAL_NOTES_KEY, JSON.stringify(notes.filter((note) => note.id !== id)));
      },

      async getSettings() {
        return toPlainObject(safeParse(global.localStorage.getItem(LOCAL_SETTINGS_KEY), {}));
      },

      async saveSettings(settings) {
        global.localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(settings));
      }
    };
  }

  function createMemoryDriver() {
    let notes = [];
    let settings = {};
    return {
      kind: "Arbeitsspeicher",
      async getAllNotes() {
        return clone(notes);
      },
      async saveNote(note) {
        const index = notes.findIndex((item) => item.id === note.id);
        if (index >= 0) {
          notes[index] = clone(note);
        } else {
          notes.push(clone(note));
        }
      },
      async saveNotes(nextNotes) {
        const byId = new Map(notes.map((note) => [note.id, note]));
        nextNotes.forEach((note) => byId.set(note.id, clone(note)));
        notes = Array.from(byId.values());
      },
      async deleteNote(id) {
        notes = notes.filter((note) => note.id !== id);
      },
      async getSettings() {
        return clone(settings);
      },
      async saveSettings(nextSettings) {
        settings = clone(nextSettings);
      }
    };
  }

  async function createStorage() {
    try {
      const db = await openDatabase();
      return createIndexedDbDriver(db);
    } catch (indexedDbError) {
      console.warn("IndexedDB wird nicht verwendet:", indexedDbError);
    }

    try {
      const driver = createLocalStorageDriver();
      global.localStorage.setItem("__notizen_test__", "ok");
      global.localStorage.removeItem("__notizen_test__");
      return driver;
    } catch (localStorageError) {
      console.warn("localStorage wird nicht verwendet:", localStorageError);
      return createMemoryDriver();
    }
  }

  function cleanTitle(value) {
    const title = String(value || "").replace(/\s+/g, " ").trim();
    return title.slice(0, MAX_NOTE_TITLE_LENGTH);
  }

  function ensureContentSize(content) {
    if (content.length > MAX_NOTE_CONTENT_LENGTH) {
      throw new Error("Eine importierte Notiz ist zu groß.");
    }
  }

  function parseDate(value, fallback) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
  }

  function titleFromFileName(fileName) {
    const rawName = String(fileName || "Importierte Notiz").split(/[\\/]/).pop() || "Importierte Notiz";
    const title = rawName.startsWith(".") ? rawName : rawName.replace(/\.[^.]+$/i, "");
    return cleanTitle(title) || "Importierte Notiz";
  }

  function normalizeImportedNote(input, sourceName) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("Ein Import-Eintrag ist keine gültige Notiz.");
    }

    const hasKnownNoteField = ["title", "name", "content", "text", "body"].some((key) =>
      Object.prototype.hasOwnProperty.call(input, key)
    );
    if (!hasKnownNoteField) {
      throw new Error("Ein Import-Eintrag enthält keine erkennbaren Notizfelder.");
    }

    const now = new Date().toISOString();
    const title = cleanTitle(input.title || input.name || titleFromFileName(sourceName));
    const rawContent = input.content ?? input.text ?? input.body ?? "";
    const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent, null, 2);
    ensureContentSize(content);

    if (!title && !content.trim()) {
      throw new Error("Eine importierte Notiz enthält weder Titel noch Inhalt.");
    }

    return {
      id: makeId(),
      title: title || "Importierte Notiz",
      content,
      pinned: Boolean(input.pinned || input.favorite || input.favorit),
      createdAt: parseDate(input.createdAt || input.created || input.erstelltAm, now),
      updatedAt: parseDate(input.updatedAt || input.updated || input.geaendertAm, now),
      reminders: Array.isArray(input.reminders) ? input.reminders : []
    };
  }

  function extensionFromFileName(fileName) {
    const name = String(fileName || "").split(/[\\/]/).pop() || "";
    const match = name.match(/\.([^.]+)$/);
    return match ? match[1].toLowerCase() : "";
  }

  function isTextDocument(fileName, mimeType) {
    const type = String(mimeType || "").toLowerCase();
    const extension = extensionFromFileName(fileName);
    return type.startsWith("text/")
      || type === "application/x-ndjson"
      || type === "application/xml"
      || type === "application/yaml"
      || type === "application/x-yaml"
      || TEXT_IMPORT_EXTENSIONS.has(extension)
      || !extension;
  }

  function parseImportData(text, fileName, mimeType = "") {
    const content = String(text ?? "");
    const trimmed = content.trim();
    const lowerType = String(mimeType || "").toLowerCase();
    const extension = extensionFromFileName(fileName);
    const explicitJsonDocument = extension === "json"
      || lowerType === "application/json"
      || lowerType.endsWith("+json");
    const explicitTextDocument = !explicitJsonDocument
      && (lowerType.startsWith("text/") || TEXT_IMPORT_EXTENSIONS.has(extension));

    if (!trimmed) {
      throw new Error("Die Importdatei ist leer.");
    }

    if (content.length > MAX_IMPORT_FILE_BYTES) {
      throw new Error("Die Importdatei ist zu groß. Maximal 5 MB sind erlaubt.");
    }

    const looksLikeJson = explicitJsonDocument
      || (!explicitTextDocument && (trimmed.startsWith("{") || trimmed.startsWith("[")));
    if (looksLikeJson) {
      let data;
      try {
        data = JSON.parse(trimmed);
      } catch (error) {
        throw new Error("Die JSON-Datei ist ungültig oder beschädigt.");
      }

      let candidates;
      if (Array.isArray(data)) {
        candidates = data;
      } else if (Array.isArray(data.notes)) {
        candidates = data.notes;
      } else if (data.note && typeof data.note === "object") {
        candidates = [data.note];
      } else if (typeof data === "object") {
        candidates = [data];
      } else {
        throw new Error("Die JSON-Datei enthält keine erkennbaren Notizen.");
      }

      if (candidates.length > MAX_IMPORT_NOTES) {
        throw new Error(`Die Importdatei enthält zu viele Notizen. Maximal ${MAX_IMPORT_NOTES} Einträge sind erlaubt.`);
      }

      const notes = [];
      const errors = [];
      candidates.forEach((candidate, index) => {
        try {
          notes.push(normalizeImportedNote(candidate, fileName));
        } catch (error) {
          errors.push(`Eintrag ${index + 1}: ${error.message}`);
        }
      });

      if (!notes.length) {
        const sample = errors.slice(0, 5).join(" ");
        const rest = errors.length > 5 ? " Weitere fehlerhafte Einträge wurden ausgeblendet." : "";
        throw new Error(`Keine gültigen Notizen gefunden. ${sample}${rest}`.trim());
      }

      return { notes, skipped: errors.length };
    }

    if (isTextDocument(fileName, mimeType)) {
      ensureContentSize(content);
      const now = new Date().toISOString();
      return {
        notes: [{
          id: makeId(),
          title: titleFromFileName(fileName),
          content,
          pinned: false,
          createdAt: now,
          updatedAt: now
        }],
        skipped: 0
      };
    }

    throw new Error("Dieses Dateiformat kann nicht importiert werden.");
  }

  function formatDateForExport(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "unbekannt";
    }
    return new Intl.DateTimeFormat("de-DE", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  }

  function sanitizeFilePart(value) {
    return cleanTitle(value)
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || "notiz";
  }

  function textExport(notes) {
    return notes.map((note) => {
      const title = note.title || "Unbenannte Notiz";
      const underline = "=".repeat(Math.max(3, title.length));
      return [
        title,
        underline,
        "",
        note.content || "",
        "",
        `Erstellt: ${formatDateForExport(note.createdAt)}`,
        `Geändert: ${formatDateForExport(note.updatedAt)}`
      ].join("\n");
    }).join("\n\n---\n\n");
  }

  function markdownExport(notes) {
    return notes.map((note) => {
      const title = note.title || "Unbenannte Notiz";
      return [
        `# ${title}`,
        "",
        note.content || "",
        "",
        "---",
        "",
        `Erstellt: ${formatDateForExport(note.createdAt)}  `,
        `Geändert: ${formatDateForExport(note.updatedAt)}`
      ].join("\n");
    }).join("\n\n");
  }

  function jsonExport(notes) {
    return JSON.stringify({
      app: "Notizen",
      version: 1,
      exportedAt: new Date().toISOString(),
      notes: notes.map((note) => ({
        id: note.id,
        title: note.title,
        content: note.content,
        pinned: Boolean(note.pinned),
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        reminders: App.Reminders
          ? App.Reminders.normalizeReminders(note.reminders, note.id)
          : toArray(note.reminders)
      }))
    }, null, 2);
  }

  function buildExport(notes, format, scopeName) {
    const selectedNotes = Array.isArray(notes) ? notes : [notes];
    if (!selectedNotes.length) {
      throw new Error("Es gibt keine Notizen zum Exportieren.");
    }

    const normalizedFormat = ["txt", "md", "json"].includes(format) ? format : "json";
    const datePart = new Date().toISOString().slice(0, 10);
    const baseName = selectedNotes.length === 1
      ? sanitizeFilePart(selectedNotes[0].title)
      : sanitizeFilePart(scopeName || "alle-notizen");

    if (normalizedFormat === "txt") {
      return {
        filename: `${baseName}-${datePart}.txt`,
        mime: "text/plain;charset=UTF-8",
        content: textExport(selectedNotes)
      };
    }

    if (normalizedFormat === "md") {
      return {
        filename: `${baseName}-${datePart}.md`,
        mime: "text/markdown;charset=UTF-8",
        content: markdownExport(selectedNotes)
      };
    }

    return {
      filename: `${baseName}-${datePart}.json`,
      mime: "application/json;charset=UTF-8",
      content: jsonExport(selectedNotes)
    };
  }

  function downloadExport(exportData) {
    const blob = new Blob([exportData.content], { type: exportData.mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportData.filename;
    document.body.append(link);
    link.click();
    link.remove();
    global.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  App.Storage = {
    createStorage,
    parseImportData,
    buildExport,
    downloadExport,
    makeId,
    MAX_IMPORT_FILE_BYTES
  };
})(window);
