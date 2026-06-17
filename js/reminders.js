(function remindersModule(global) {
  "use strict";

  const App = global.NotizenApp || (global.NotizenApp = {});
  const SCHEMA_VERSION = 1;
  const VALID_STATUSES = new Set(["active", "triggered", "missed", "dismissed"]);
  const MAX_PREVIEW_LENGTH = 240;
  const MAX_ANCHOR_TEXT_LENGTH = 2000;
  const MAX_CONTEXT_LENGTH = 90;
  const MAX_REMINDER_ID_LENGTH = 160;
  const GERMANY_TIME_ZONE = "Europe/Berlin";

  function nowIso() {
    return new Date().toISOString();
  }

  function makeReminderId() {
    if (App.Storage && typeof App.Storage.makeId === "function") {
      return `reminder-${App.Storage.makeId()}`;
    }
    return `reminder-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function cleanText(value, maxLength) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  function pad(number) {
    return String(number).padStart(2, "0");
  }

  function partsForGermanTime(date) {
    const source = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(source.getTime())) {
      return null;
    }

    const formatter = new Intl.DateTimeFormat("de-DE", {
      timeZone: GERMANY_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    const parts = Object.fromEntries(formatter.formatToParts(source).map((part) => [part.type, part.value]));
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour),
      minute: Number(parts.minute)
    };
  }

  function inputValuesFromGermanParts(parts) {
    if (!parts) {
      return { date: "", time: "" };
    }
    return {
      date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
      time: `${pad(parts.hour)}:${pad(parts.minute)}`
    };
  }

  function germanTimeOffsetMs(date) {
    const parts = partsForGermanTime(date);
    if (!parts) {
      return 0;
    }
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    return asUtc - date.getTime();
  }

  function validIso(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  function clampIndex(value, max) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) {
      return -1;
    }
    return Math.min(number, Math.max(0, max));
  }

  function normalizeAnchor(anchor) {
    if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) {
      return null;
    }

    const start = Number.isInteger(anchor.start) && anchor.start >= 0 ? anchor.start : -1;
    const end = Number.isInteger(anchor.end) && anchor.end > start ? anchor.end : -1;
    const text = String(anchor.text || "").slice(0, MAX_ANCHOR_TEXT_LENGTH);
    const before = String(anchor.before || "").slice(-MAX_CONTEXT_LENGTH);
    const after = String(anchor.after || "").slice(0, MAX_CONTEXT_LENGTH);

    if (!text.trim() && (start < 0 || end < 0)) {
      return null;
    }

    return {
      start,
      end,
      text,
      before,
      after
    };
  }

  function normalizeReminder(reminder, noteId) {
    if (!reminder || typeof reminder !== "object" || Array.isArray(reminder)) {
      return null;
    }

    const dueAt = validIso(reminder.dueAt || reminder.remindAt || reminder.dateTime);
    if (!dueAt) {
      return null;
    }

    const rawId = String(reminder.reminderId || reminder.id || "").slice(0, MAX_REMINDER_ID_LENGTH);
    const reminderId = rawId || makeReminderId();
    const status = VALID_STATUSES.has(reminder.status) ? reminder.status : "active";
    const createdAt = validIso(reminder.createdAt) || nowIso();
    const updatedAt = validIso(reminder.updatedAt) || createdAt;
    const triggeredAt = validIso(reminder.triggeredAt);
    const missedAt = validIso(reminder.missedAt);
    const dismissedAt = validIso(reminder.dismissedAt);

    return {
      schemaVersion: SCHEMA_VERSION,
      reminderId,
      noteId: String(noteId || reminder.noteId || ""),
      dueAt,
      previewText: cleanText(reminder.previewText || reminder.text || reminder.message, MAX_PREVIEW_LENGTH),
      soundEnabled: Boolean(reminder.soundEnabled),
      anchor: normalizeAnchor(reminder.anchor || reminder.highlight),
      status,
      createdAt,
      updatedAt,
      ...(triggeredAt ? { triggeredAt } : {}),
      ...(missedAt ? { missedAt } : {}),
      ...(dismissedAt ? { dismissedAt } : {})
    };
  }

  function normalizeReminders(reminders, noteId) {
    const seen = new Set();
    return (Array.isArray(reminders) ? reminders : [])
      .map((reminder) => normalizeReminder(reminder, noteId))
      .filter((reminder) => {
        if (!reminder || seen.has(reminder.reminderId)) {
          return false;
        }
        seen.add(reminder.reminderId);
        return true;
      })
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  }

  function createTextAnchor(content, start, end) {
    const value = String(content || "");
    const cleanStart = clampIndex(start, value.length);
    const cleanEnd = clampIndex(end, value.length);
    if (cleanStart < 0 || cleanEnd <= cleanStart) {
      return null;
    }

    const text = value.slice(cleanStart, cleanEnd);
    if (!text.trim()) {
      return null;
    }

    return {
      start: cleanStart,
      end: cleanEnd,
      text: text.slice(0, MAX_ANCHOR_TEXT_LENGTH),
      before: value.slice(Math.max(0, cleanStart - MAX_CONTEXT_LENGTH), cleanStart),
      after: value.slice(cleanEnd, cleanEnd + MAX_CONTEXT_LENGTH)
    };
  }

  function createReminder({ noteId, dueAt, previewText = "", soundEnabled = false, anchor = null } = {}) {
    const dueIso = validIso(dueAt);
    if (!dueIso) {
      throw new Error("Ungültiger Erinnerungszeitpunkt.");
    }

    const createdAt = nowIso();
    return {
      schemaVersion: SCHEMA_VERSION,
      reminderId: makeReminderId(),
      noteId: String(noteId || ""),
      dueAt: dueIso,
      previewText: cleanText(previewText, MAX_PREVIEW_LENGTH),
      soundEnabled: Boolean(soundEnabled),
      anchor: normalizeAnchor(anchor),
      status: "active",
      createdAt,
      updatedAt: createdAt
    };
  }

  function updateReminder(reminder, patch) {
    const merged = {
      ...reminder,
      ...patch,
      updatedAt: nowIso()
    };
    return normalizeReminder(merged, reminder.noteId);
  }

  function withReminder(reminders, nextReminder) {
    const cleanReminder = normalizeReminder(nextReminder, nextReminder.noteId);
    if (!cleanReminder) {
      return normalizeReminders(reminders, nextReminder.noteId);
    }
    const next = normalizeReminders(reminders, cleanReminder.noteId)
      .filter((reminder) => reminder.reminderId !== cleanReminder.reminderId);
    next.push(cleanReminder);
    return normalizeReminders(next, cleanReminder.noteId);
  }

  function withoutReminder(reminders, reminderId, noteId) {
    return normalizeReminders(reminders, noteId)
      .filter((reminder) => reminder.reminderId !== reminderId);
  }

  function findReminder(note, reminderId) {
    const reminders = normalizeReminders(note && note.reminders, note && note.id);
    return reminders.find((reminder) => reminder.reminderId === reminderId) || null;
  }

  function activeReminders(note) {
    return normalizeReminders(note && note.reminders, note && note.id)
      .filter((reminder) => reminder.status === "active");
  }

  function noteSummary(note) {
    const all = normalizeReminders(note && note.reminders, note && note.id);
    const active = all.filter((reminder) => reminder.status === "active");
    return {
      totalCount: all.length,
      activeCount: active.length,
      next: active[0] || null
    };
  }

  function collectMatches(haystack, needle, limit) {
    const matches = [];
    if (!needle) {
      return matches;
    }

    let from = 0;
    while (matches.length < limit) {
      const index = haystack.indexOf(needle, from);
      if (index < 0) {
        break;
      }
      matches.push(index);
      from = index + Math.max(1, needle.length);
    }
    return matches;
  }

  function scoreMatch(content, start, anchor) {
    let score = 0;
    if (Number.isInteger(anchor.start)) {
      score -= Math.abs(anchor.start - start) / 1000;
    }
    if (anchor.before && content.slice(Math.max(0, start - anchor.before.length), start) === anchor.before) {
      score += 6;
    }
    if (anchor.after && content.slice(start + anchor.text.length, start + anchor.text.length + anchor.after.length) === anchor.after) {
      score += 6;
    }
    return score;
  }

  function resolveAnchor(content, anchor) {
    const value = String(content || "");
    const cleanAnchor = normalizeAnchor(anchor);
    if (!cleanAnchor) {
      return { found: false, reason: "no-anchor" };
    }

    const start = clampIndex(cleanAnchor.start, value.length);
    const end = clampIndex(cleanAnchor.end, value.length);
    if (start >= 0 && end > start) {
      const indexedText = value.slice(start, end);
      if (!cleanAnchor.text || indexedText === cleanAnchor.text || indexedText.startsWith(cleanAnchor.text)) {
        return { found: true, start, end, text: indexedText };
      }
    }

    if (cleanAnchor.text) {
      if (cleanAnchor.before || cleanAnchor.after) {
        const contextual = `${cleanAnchor.before}${cleanAnchor.text}${cleanAnchor.after}`;
        const contextIndex = value.indexOf(contextual);
        if (contextIndex >= 0) {
          const resolvedStart = contextIndex + cleanAnchor.before.length;
          return {
            found: true,
            start: resolvedStart,
            end: resolvedStart + cleanAnchor.text.length,
            text: cleanAnchor.text
          };
        }
      }

      const matches = collectMatches(value, cleanAnchor.text, 60);
      if (matches.length === 1) {
        return {
          found: true,
          start: matches[0],
          end: matches[0] + cleanAnchor.text.length,
          text: cleanAnchor.text
        };
      }
      if (matches.length > 1) {
        const best = matches
          .map((index) => ({ index, score: scoreMatch(value, index, cleanAnchor) }))
          .sort((a, b) => b.score - a.score)[0];
        if (best && best.score > 0) {
          return {
            found: true,
            start: best.index,
            end: best.index + cleanAnchor.text.length,
            text: cleanAnchor.text
          };
        }
        return { found: false, reason: "ambiguous" };
      }
    }

    if (start >= 0 && end > start) {
      return {
        found: true,
        start,
        end,
        text: value.slice(start, end),
        stale: true
      };
    }

    return { found: false, reason: "not-found" };
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

  function excerptForReminder(note, reminder) {
    const cleanReminder = normalizeReminder(reminder, note && note.id);
    if (!cleanReminder) {
      return "";
    }

    const anchorText = cleanReminder.anchor && cleanReminder.anchor.text
      ? cleanText(cleanReminder.anchor.text, MAX_PREVIEW_LENGTH)
      : "";
    if (anchorText) {
      return anchorText;
    }
    if (cleanReminder.previewText) {
      return cleanReminder.previewText;
    }

    const text = stripMarkdown(note && note.content);
    return text ? (text.length > MAX_PREVIEW_LENGTH ? `${text.slice(0, MAX_PREVIEW_LENGTH - 1)}...` : text) : "Keine Vorschau";
  }

  function formatDueAt(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "unbekannt";
    }
    return new Intl.DateTimeFormat("de-DE", {
      timeZone: GERMANY_TIME_ZONE,
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  }

  function formatShortDueAt(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "unbekannt";
    }
    const sameDay = inputValuesFromIso(value).date === inputValuesForGermanNow().date;
    return new Intl.DateTimeFormat("de-DE", sameDay
      ? { timeZone: GERMANY_TIME_ZONE, hour: "2-digit", minute: "2-digit" }
      : { timeZone: GERMANY_TIME_ZONE, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }
    ).format(date);
  }

  function statusLabel(status) {
    const labels = {
      active: "Aktiv",
      triggered: "Ausgelöst",
      missed: "Verpasst",
      dismissed: "Deaktiviert"
    };
    return labels[status] || labels.active;
  }

  function parseLocalDateTime(dateValue, timeValue) {
    const dateMatch = String(dateValue || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const timeMatch = String(timeValue || "").match(/^(\d{2}):(\d{2})$/);
    if (!dateMatch || !timeMatch) {
      return "";
    }

    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
    if (
      date.getUTCFullYear() !== year
      || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day
      || hour > 23
      || minute > 59
    ) {
      return "";
    }

    const utc = new Date(date.getTime() - germanTimeOffsetMs(date));
    const confirmed = partsForGermanTime(utc);
    if (
      !confirmed
      || confirmed.year !== year
      || confirmed.month !== month
      || confirmed.day !== day
      || confirmed.hour !== hour
      || confirmed.minute !== minute
    ) {
      return "";
    }
    return utc.toISOString();
  }

  function inputValuesFromIso(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return { date: "", time: "" };
    }
    return inputValuesFromGermanParts(partsForGermanTime(date));
  }

  function inputValuesForGermanNow() {
    return inputValuesFromGermanParts(partsForGermanTime(new Date()));
  }

  function isoInMinutes(minutes) {
    const date = new Date(Date.now() + Math.max(1, Number(minutes) || 1) * 60 * 1000);
    return date.toISOString();
  }

  function tomorrowMorningIso() {
    const today = partsForGermanTime(new Date());
    if (!today) {
      return isoInMinutes(24 * 60);
    }
    const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1, 9, 0, 0, 0));
    const tomorrowParts = {
      year: tomorrow.getUTCFullYear(),
      month: tomorrow.getUTCMonth() + 1,
      day: tomorrow.getUTCDate()
    };
    return parseLocalDateTime(
      `${tomorrowParts.year}-${pad(tomorrowParts.month)}-${pad(tomorrowParts.day)}`,
      "09:00"
    );
  }

  App.Reminders = {
    SCHEMA_VERSION,
    normalizeReminders,
    normalizeReminder,
    createReminder,
    updateReminder,
    withReminder,
    withoutReminder,
    findReminder,
    activeReminders,
    noteSummary,
    createTextAnchor,
    resolveAnchor,
    excerptForReminder,
    formatDueAt,
    formatShortDueAt,
    statusLabel,
    parseLocalDateTime,
    inputValuesFromIso,
    inputValuesForGermanNow,
    isoInMinutes,
    tomorrowMorningIso
  };
})(window);
