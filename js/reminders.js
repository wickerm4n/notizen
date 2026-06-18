(function remindersModule(global) {
  "use strict";

  const App = global.NotizenApp || (global.NotizenApp = {});
  const SCHEMA_VERSION = 2;
  const VALID_STATUSES = new Set(["active", "triggered", "missed", "dismissed"]);
  const MAX_PREVIEW_LENGTH = 240;
  const MAX_ANCHOR_TEXT_LENGTH = 2000;
  const MAX_LINE_TEXT_LENGTH = 1000;
  const MAX_SELECTED_LINES = 80;
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

  function cleanLineText(value) {
    return String(value || "").replace(/\r\n?/g, "\n").split("\n")[0].slice(0, MAX_LINE_TEXT_LENGTH);
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

  function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null);
  }

  function booleanOption(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }

  function normalizeContent(content) {
    return String(content || "").replace(/\r\n?/g, "\n");
  }

  function textHash(value) {
    const text = String(value || "");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function contentLines(content) {
    const value = normalizeContent(content);
    if (!value.length) {
      return [];
    }

    let start = 0;
    return value.split("\n").map((text, index) => {
      const end = start + text.length;
      const line = {
        index,
        text,
        start,
        end,
        hash: textHash(text)
      };
      start = end + 1;
      return line;
    });
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

  function contextForLine(content, line) {
    return {
      before: content.slice(Math.max(0, line.start - MAX_CONTEXT_LENGTH), line.start),
      after: content.slice(line.end, line.end + MAX_CONTEXT_LENGTH)
    };
  }

  function normalizeLineEntry(entry, fallbackIndex = -1, fallbackText = "") {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      entry = {};
    }

    const indexValue = firstDefined(entry.index, entry.lineIndex, fallbackIndex);
    const index = Number.isInteger(indexValue) && indexValue >= 0 ? indexValue : -1;
    const text = cleanLineText(firstDefined(entry.text, entry.lineText, fallbackText, ""));
    const before = String(entry.before || "").slice(-MAX_CONTEXT_LENGTH);
    const after = String(entry.after || "").slice(0, MAX_CONTEXT_LENGTH);
    const hash = String(entry.hash || (text || text === "" ? textHash(text) : "")).slice(0, 32);

    if (!text.trim()) {
      return null;
    }

    return {
      index,
      text,
      before,
      after,
      hash
    };
  }

  function normalizeLineSelection(selection) {
    if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
      return null;
    }

    const rawLines = Array.isArray(selection.lines) ? selection.lines : [];
    const rawIndexes = Array.isArray(selection.selectedLineIndexes) ? selection.selectedLineIndexes : [];
    const rawTexts = Array.isArray(selection.selectedLineTexts) ? selection.selectedLineTexts : [];
    const entries = [];

    rawLines.forEach((line) => {
      const entry = normalizeLineEntry(line);
      if (entry) {
        entries.push(entry);
      }
    });

    rawIndexes.forEach((rawIndex, itemIndex) => {
      const index = Number(rawIndex);
      const entry = normalizeLineEntry({}, Number.isInteger(index) ? index : -1, rawTexts[itemIndex] || "");
      if (entry) {
        entries.push(entry);
      }
    });

    if (!entries.length && rawTexts.length) {
      rawTexts.forEach((text) => {
        const entry = normalizeLineEntry({}, -1, text);
        if (entry) {
          entries.push(entry);
        }
      });
    }

    const seen = new Set();
    const lines = [];
    entries.forEach((entry) => {
      const key = `${entry.index}:${entry.hash}:${entry.text}`;
      if (seen.has(key) || lines.length >= MAX_SELECTED_LINES) {
        return;
      }
      seen.add(key);
      lines.push(entry);
    });

    if (!lines.length) {
      return null;
    }

    return {
      selectedLineIndexes: lines.map((line) => line.index).filter((index) => index >= 0),
      selectedLineTexts: lines.map((line) => line.text),
      lines
    };
  }

  function createLineSelection(content, selectedIndexes) {
    const value = normalizeContent(content);
    const lines = contentLines(value);
    const indexes = Array.from(new Set((Array.isArray(selectedIndexes) ? selectedIndexes : [])
      .map((index) => Number(index))
      .filter((index) => Number.isInteger(index) && index >= 0)))
      .sort((a, b) => a - b)
      .slice(0, MAX_SELECTED_LINES);

    const selectedLines = indexes
      .map((index) => lines[index])
      .filter((line) => line && line.text.trim())
      .map((line) => {
        const context = contextForLine(value, line);
        return {
          index: line.index,
          text: cleanLineText(line.text),
          before: context.before,
          after: context.after,
          hash: textHash(line.text)
        };
      });

    return normalizeLineSelection({
      selectedLineIndexes: selectedLines.map((line) => line.index),
      selectedLineTexts: selectedLines.map((line) => line.text),
      lines: selectedLines
    });
  }

  function createLineSelectionFromRange(content, start, end) {
    const value = normalizeContent(content);
    const cleanStart = clampIndex(start, value.length);
    const cleanEnd = clampIndex(end, value.length);
    if (cleanStart < 0 || cleanEnd <= cleanStart) {
      return null;
    }

    const indexes = contentLines(value)
      .filter((line) => {
        const lineEnd = Math.max(line.end, Math.min(value.length, line.start + 1));
        return cleanStart < lineEnd && cleanEnd > line.start;
      })
      .map((line) => line.index);

    return createLineSelection(value, indexes);
  }

  function createTextAnchor(content, start, end) {
    const value = normalizeContent(content);
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

  function createLineSelectionFromAnchor(content, anchor) {
    const resolved = resolveAnchor(content, anchor);
    if (!resolved.found) {
      return null;
    }
    return createLineSelectionFromRange(content, resolved.start, resolved.end);
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
    const browserNotificationEnabled = booleanOption(
      firstDefined(reminder.browserNotificationEnabled, reminder.showBrowserNotification, reminder.browserEnabled),
      true
    );
    let appDialogEnabled = booleanOption(
      firstDefined(reminder.appDialogEnabled, reminder.inAppDialogEnabled, reminder.showAppDialog),
      true
    );
    if (!browserNotificationEnabled && !appDialogEnabled) {
      appDialogEnabled = true;
    }

    const lineSelection = normalizeLineSelection(reminder.lineSelection || {
      selectedLineIndexes: reminder.selectedLineIndexes,
      selectedLineTexts: reminder.selectedLineTexts,
      lines: reminder.selectedLines
    });

    return {
      schemaVersion: SCHEMA_VERSION,
      reminderId,
      noteId: String(noteId || reminder.noteId || ""),
      dueAt,
      previewText: cleanText(reminder.previewText || reminder.text || reminder.message, MAX_PREVIEW_LENGTH),
      soundEnabled: Boolean(reminder.soundEnabled),
      browserNotificationEnabled,
      appDialogEnabled,
      tabBlinkEnabled: Boolean(reminder.tabBlinkEnabled),
      anchor: normalizeAnchor(reminder.anchor || reminder.highlight),
      lineSelection,
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

  function createReminder({
    noteId,
    dueAt,
    previewText = "",
    soundEnabled = false,
    browserNotificationEnabled = true,
    appDialogEnabled = true,
    tabBlinkEnabled = false,
    anchor = null,
    lineSelection = null
  } = {}) {
    const dueIso = validIso(dueAt);
    if (!dueIso) {
      throw new Error("Ungültiger Erinnerungszeitpunkt.");
    }

    const createdAt = nowIso();
    return normalizeReminder({
      schemaVersion: SCHEMA_VERSION,
      reminderId: makeReminderId(),
      noteId: String(noteId || ""),
      dueAt: dueIso,
      previewText,
      soundEnabled,
      browserNotificationEnabled,
      appDialogEnabled,
      tabBlinkEnabled,
      anchor,
      lineSelection,
      status: "active",
      createdAt,
      updatedAt: createdAt
    }, noteId);
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
    const value = normalizeContent(content);
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

  function contextScoreForLine(content, line, entry) {
    let score = 0;
    if (entry.before && content.slice(Math.max(0, line.start - entry.before.length), line.start) === entry.before) {
      score += 6;
    }
    if (entry.after && content.slice(line.end, line.end + entry.after.length) === entry.after) {
      score += 6;
    }
    if (entry.index >= 0) {
      score -= Math.abs(entry.index - line.index) / 100;
    }
    return score;
  }

  function rangeForLine(content, line) {
    let end = line.end;
    if (end <= line.start && line.start < content.length) {
      end = line.start + 1;
    }
    return {
      start: Math.max(0, line.start),
      end: Math.max(Math.max(0, line.start), Math.min(content.length, end)),
      text: line.text,
      lineIndex: line.index
    };
  }

  function lineMatchesEntry(line, entry) {
    if (!line || !entry) {
      return false;
    }
    if (entry.hash && line.hash === entry.hash) {
      return true;
    }
    if (entry.text || entry.text === "") {
      return line.text === entry.text;
    }
    return false;
  }

  function resolveLineEntry(content, lines, entry, usedLineIndexes) {
    const indexedLine = entry.index >= 0 ? lines[entry.index] : null;
    if (indexedLine && !usedLineIndexes.has(indexedLine.index) && lineMatchesEntry(indexedLine, entry)) {
      return { found: true, line: indexedLine };
    }

    const exactCandidates = lines.filter((line) =>
      !usedLineIndexes.has(line.index)
      && (
        (entry.hash && line.hash === entry.hash)
        || (entry.text && line.text === entry.text)
      )
    );

    if (exactCandidates.length === 1) {
      return { found: true, line: exactCandidates[0] };
    }

    if (exactCandidates.length > 1) {
      const scored = exactCandidates
        .map((line) => ({ line, score: contextScoreForLine(content, line, entry) }))
        .sort((a, b) => b.score - a.score);
      if (scored[0] && scored[0].score > 0 && (!scored[1] || scored[0].score > scored[1].score)) {
        return { found: true, line: scored[0].line };
      }
      return { found: false, reason: "ambiguous" };
    }

    if (entry.text) {
      const prefixCandidates = lines.filter((line) =>
        !usedLineIndexes.has(line.index)
        && line.text.startsWith(entry.text)
      );
      if (prefixCandidates.length === 1) {
        return { found: true, line: prefixCandidates[0] };
      }
    }

    return { found: false, reason: "not-found" };
  }

  function resolveLineSelection(content, selection) {
    const value = normalizeContent(content);
    const cleanSelection = normalizeLineSelection(selection);
    if (!cleanSelection) {
      return { found: false, hasSelection: false, reason: "no-selection", ranges: [], missing: [] };
    }

    const lines = contentLines(value);
    const usedLineIndexes = new Set();
    const ranges = [];
    const missing = [];

    cleanSelection.lines.forEach((entry) => {
      const resolved = resolveLineEntry(value, lines, entry, usedLineIndexes);
      if (resolved.found && resolved.line) {
        usedLineIndexes.add(resolved.line.index);
        ranges.push(rangeForLine(value, resolved.line));
      } else {
        missing.push({ entry, reason: resolved.reason || "not-found" });
      }
    });

    ranges.sort((a, b) => a.start - b.start);
    return {
      found: ranges.length > 0,
      hasSelection: true,
      partial: ranges.length > 0 && missing.length > 0,
      reason: ranges.length ? (missing.length ? "partial" : "") : (missing[0] && missing[0].reason) || "not-found",
      ranges,
      missing,
      foundCount: ranges.length,
      missingCount: missing.length,
      totalCount: cleanSelection.lines.length
    };
  }

  function resolveReminderSelection(note, reminder) {
    const cleanReminder = normalizeReminder(reminder, note && note.id);
    if (!cleanReminder) {
      return { found: false, hasSelection: false, reason: "no-reminder", ranges: [] };
    }

    if (cleanReminder.lineSelection) {
      return {
        type: "lines",
        ...resolveLineSelection(note && note.content, cleanReminder.lineSelection)
      };
    }

    if (cleanReminder.anchor) {
      const resolved = resolveAnchor(note && note.content, cleanReminder.anchor);
      return {
        type: "anchor",
        hasSelection: true,
        ...resolved,
        ranges: resolved.found
          ? [{ start: resolved.start, end: resolved.end, text: resolved.text || cleanReminder.anchor.text || "" }]
          : []
      };
    }

    return { found: false, hasSelection: false, reason: "no-selection", ranges: [] };
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

  function lineSelectionExcerpt(selection, maxLength = MAX_PREVIEW_LENGTH) {
    const cleanSelection = normalizeLineSelection(selection);
    if (!cleanSelection) {
      return "";
    }

    const parts = cleanSelection.lines
      .map((line) => cleanText(line.text, 120))
      .filter(Boolean);
    if (!parts.length) {
      return "";
    }

    const text = parts.join(" / ");
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
  }

  function selectedLineTextsForReminder(reminder) {
    const cleanSelection = normalizeLineSelection(reminder && reminder.lineSelection);
    return cleanSelection
      ? cleanSelection.lines.map((line) => line.text)
      : [];
  }

  function excerptForReminder(note, reminder) {
    const cleanReminder = normalizeReminder(reminder, note && note.id);
    if (!cleanReminder) {
      return "";
    }

    const lineText = lineSelectionExcerpt(cleanReminder.lineSelection);
    if (lineText) {
      return lineText;
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

  function notificationLabel(reminder) {
    const cleanReminder = normalizeReminder(reminder, reminder && reminder.noteId);
    if (!cleanReminder) {
      return "App-Dialog";
    }
    if (cleanReminder.browserNotificationEnabled && cleanReminder.appDialogEnabled) {
      return "Browser + App-Dialog";
    }
    return cleanReminder.browserNotificationEnabled ? "Browser" : "App-Dialog";
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
    contentLines,
    createTextAnchor,
    createLineSelection,
    createLineSelectionFromRange,
    createLineSelectionFromAnchor,
    resolveAnchor,
    resolveLineSelection,
    resolveReminderSelection,
    selectedLineTextsForReminder,
    lineSelectionExcerpt,
    excerptForReminder,
    notificationLabel,
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
