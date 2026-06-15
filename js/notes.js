(function notesModule(global) {
  "use strict";

  const App = global.NotizenApp || (global.NotizenApp = {});
  const collator = new Intl.Collator("de-DE", { sensitivity: "base", numeric: true });

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeTitle(title) {
    return String(title || "").replace(/\s+/g, " ").trim().slice(0, 120) || "Unbenannte Notiz";
  }

  function createNote({ title = "Neue Notiz", content = "", pinned = false } = {}) {
    const now = nowIso();
    return {
      id: App.Storage.makeId(),
      title: normalizeTitle(title),
      content: String(content || ""),
      pinned: Boolean(pinned),
      createdAt: now,
      updatedAt: now
    };
  }

  function touch(note) {
    return { ...note, updatedAt: nowIso() };
  }

  function rename(note, title) {
    return touch({ ...note, title: normalizeTitle(title) });
  }

  function updateContent(note, content) {
    return touch({ ...note, content: String(content ?? "") });
  }

  function togglePinned(note) {
    return touch({ ...note, pinned: !note.pinned });
  }

  function duplicate(note) {
    const copy = createNote({
      title: `Kopie von ${note.title || "Unbenannte Notiz"}`,
      content: note.content || "",
      pinned: false
    });
    return copy;
  }

  function stripMarkdown(content) {
    return String(content || "")
      .replace(/```[\s\S]*?```/g, " Code-Block ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^>\s?/gm, "")
      .replace(/^[-*+]\s+\[[ xX]\]\s+/gm, "")
      .replace(/^[-*+]\s+/gm, "")
      .replace(/^\d+\.\s+/gm, "")
      .replace(/[*_~>#]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function preview(note) {
    const text = stripMarkdown(note.content);
    if (!text) {
      return "Keine Vorschau";
    }
    return text.length > 150 ? `${text.slice(0, 150)}…` : text;
  }

  function sorted(notes, sortBy) {
    const sortedNotes = [...notes];
    sortedNotes.sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }

      if (sortBy === "title") {
        return collator.compare(a.title || "", b.title || "");
      }

      if (sortBy === "createdAt") {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }

      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    return sortedNotes;
  }

  function matchesQuery(note, query) {
    const normalizedQuery = String(query || "").trim().toLocaleLowerCase("de-DE");
    if (!normalizedQuery) {
      return true;
    }
    const haystack = `${note.title || ""}\n${note.content || ""}`.toLocaleLowerCase("de-DE");
    return haystack.includes(normalizedQuery);
  }

  function filterAndSort(notes, query, sortBy) {
    return sorted(notes.filter((note) => matchesQuery(note, query)), sortBy);
  }

  function formatRelativeDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "unbekannt";
    }
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    if (sameDay) {
      return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(date);
    }
    return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" }).format(date);
  }

  function formatFullDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "unbekannt";
    }
    return new Intl.DateTimeFormat("de-DE", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  }

  function wordCount(content) {
    const words = String(content || "").trim().match(/[^\s]+/g);
    return words ? words.length : 0;
  }

  App.Notes = {
    createNote,
    normalizeTitle,
    rename,
    updateContent,
    togglePinned,
    duplicate,
    preview,
    filterAndSort,
    formatRelativeDate,
    formatFullDate,
    wordCount
  };
})(window);
