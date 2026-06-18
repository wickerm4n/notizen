(function appModule(global) {
  "use strict";

  const App = global.NotizenApp || (global.NotizenApp = {});

  let storage;
  let notes = [];
  let settings = App.Settings.mergeSettings({});
  let selectedId = "";
  let searchQuery = "";
  let saveTimer = 0;
  const dirtyIds = new Set();
  const selectedIds = new Set();
  const MAX_STORED_ID_LENGTH = 160;
  const MAX_STORED_CONTENT_LENGTH = 500000;
  const MAX_IMPORT_FILES = 30;
  const MAX_IMPORT_TOTAL_BYTES = 20 * 1024 * 1024;
  const MAX_TIMER_DELAY_MS = 24 * 60 * 60 * 1000;
  let dragImportDepth = 0;
  let reminderDialogNoteId = "";
  let reminderDraftLineSelection = null;
  let reminderDraftLineIndexes = new Set();
  const reminderTimers = new Map();

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    if (App.UI.init({
      onContextAction: handleContextAction
    }) === false) {
      return;
    }
    storage = await App.Storage.createStorage();

    try {
      settings = App.Settings.mergeSettings(await storage.getSettings());
    } catch (error) {
      App.UI.showToast("Einstellungen konnten nicht geladen werden.", "error");
      settings = App.Settings.mergeSettings({});
    }

    App.Settings.applySettings(settings);
    App.Settings.watchSystemTheme(() => App.Settings.applySettings(settings));
    App.UI.setSortValue(settings.sortBy);

    if (App.Editor.init({
      onTitleInput: handleTitleInput,
      onContentInput: handleContentInput,
      onSaveNow: () => saveCurrentNote(false),
      onFullscreenChange: () => {}
    }) === false) {
      App.UI.showToast("Der Editor konnte nicht initialisiert werden.", "error");
      return;
    }
    App.Editor.setViewMode(settings.viewMode);

    bindEvents();
    await loadNotes();
    chooseInitialNote();
    refreshList();
    await selectNote(selectedId, { keepSidebar: true });
    initializeReminderTimers();
    App.Editor.setSaveStatus("saved");
  }

  function bindEvents() {
    onElement("newNoteButton", "click", createNewNote);
    onElement("emptyNewNoteButton", "click", createNewNote);
    onElement("openSidebarButton", "click", () => App.UI.toggleSidebar());
    onElement("fullscreenSidebarButton", "click", () => App.UI.toggleSidebar());
    onElement("closeSidebarButton", "click", () => App.UI.setSidebarOpen(false));
    onElement("sidebarScrim", "click", () => App.UI.setSidebarOpen(false));

    onElement("noteList", "click", async (event) => {
      const openTarget = closestTarget(event.target, "[data-note-open]");
      if (!openTarget) {
        return;
      }
      const card = closestTarget(event.target, "[data-note-id]");
      if (!card) {
        return;
      }
      await selectNote(card.dataset.noteId);
    });

    onElement("noteList", "change", (event) => {
      const checkbox = closestTarget(event.target, "[data-note-checkbox]");
      if (!checkbox) {
        return;
      }
      const card = closestTarget(checkbox, "[data-note-id]");
      if (!card) {
        return;
      }
      toggleNoteSelection(card.dataset.noteId, checkbox.checked);
    });

    onElement("noteList", "contextmenu", (event) => {
      const card = closestTarget(event.target, "[data-note-id]");
      if (!card) {
        return;
      }
      event.preventDefault();
      const note = noteById(card.dataset.noteId);
      App.UI.openNoteContextMenu(note, event.clientX, event.clientY);
    });

    onElement("searchInput", "input", (event) => {
      searchQuery = event.target.value;
      refreshList();
    });

    onElement("sortSelect", "change", async (event) => {
      settings.sortBy = App.Settings.sanitizeSortBy(event.target.value);
      await saveSettings();
      refreshList();
    });

    document.querySelectorAll("[data-view-mode]").forEach((button) => {
      button.addEventListener("click", async () => {
        settings.viewMode = App.Settings.sanitizeViewMode(button.dataset.viewMode);
        App.Editor.setViewMode(settings.viewMode);
        await saveSettings();
      });
    });

    onElement("renameNoteButton", "click", renameCurrentNote);
    onElement("pinNoteButton", "click", toggleCurrentPin);
    onElement("duplicateNoteButton", "click", duplicateCurrentNote);
    onElement("deleteNoteButton", "click", deleteCurrentNote);
    onElement("exportNoteButton", "click", exportCurrentNote);
    onElement("exportAllButton", "click", exportAllNotes);
    onElement("bulkExportButton", "click", exportSelectedNotes);
    onElement("bulkDuplicateButton", "click", duplicateSelectedNotes);
    onElement("bulkDeleteButton", "click", deleteSelectedNotes);
    onElement("clearSelectionButton", "click", clearNoteSelection);
    onElement("settingsButton", "click", openSettings);
    onElement("remindersButton", "click", () => openReminderManager({ captureSelection: true }));
    onElement("reminderStripButton", "click", () => openReminderManager({ captureSelection: false }));
    onElement("reminderCloseButton", "click", closeReminderManager);
    onElement("reminderCancelButton", "click", () => resetReminderForm(currentNote(), { keepSelection: false }));
    onElement("reminderUseSelectionButton", "click", captureSelectionForReminder);
    onElement("reminderClearSelectionButton", "click", clearReminderDraftAnchor);
    onElement("reminderForm", "submit", handleReminderFormSubmit);
    onElement("reminderList", "click", handleReminderListClick);
    onElement("reminderLineList", "click", handleReminderLineListClick);
    onElement("reminderLineList", "keydown", handleReminderLineListKeydown);
    onElement("reminderDate", "wheel", handleReminderDateTimeWheel);
    onElement("reminderTime", "wheel", handleReminderDateTimeWheel);
    document.querySelectorAll("[data-reminder-offset-minutes]").forEach((button) => {
      button.addEventListener("click", () => setReminderFormDueAt(App.Reminders.isoInMinutes(button.dataset.reminderOffsetMinutes)));
    });
    onElement("reminderTomorrowButton", "click", () => setReminderFormDueAt(App.Reminders.tomorrowMorningIso()));
    onElement("importButton", "click", () => {
      const input = byId("importInput");
      if (input) {
        input.click();
      }
    });
    onElement("importInput", "change", handleImport);
    bindDragAndDropImport();

    const persistBeforeLeaving = () => {
      if (settings.autoSave && selectedId) {
        void saveCurrentNote(true);
      }
    };
    global.addEventListener("beforeunload", persistBeforeLeaving);
    global.addEventListener("pagehide", persistBeforeLeaving);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        persistBeforeLeaving();
      }
    });
  }

  function byId(id) {
    const element = document.getElementById(id);
    if (!element) {
      console.warn(`Notizen-App: Element #${id} wurde nicht gefunden.`);
    }
    return element;
  }

  function onElement(id, eventName, handler) {
    const element = byId(id);
    if (!element || typeof handler !== "function") {
      return false;
    }
    element.addEventListener(eventName, handler);
    return true;
  }

  function closestTarget(target, selector) {
    return target && typeof target.closest === "function" ? target.closest(selector) : null;
  }

  async function loadNotes() {
    try {
      const loaded = await storage.getAllNotes();
      notes = loaded.map(normalizeStoredNote).filter(Boolean);
    } catch (error) {
      notes = [];
      App.UI.showToast("Notizen konnten nicht geladen werden.", "error");
    }
  }

  function normalizeStoredNote(note) {
    if (!note || typeof note !== "object" || typeof note.id !== "string" || note.id.length > MAX_STORED_ID_LENGTH) {
      return null;
    }

    const createdAt = normalizeStoredDate(note.createdAt, new Date().toISOString());
    return {
      id: note.id,
      title: App.Notes.normalizeTitle(note.title),
      content: normalizeStoredContent(note.content),
      pinned: Boolean(note.pinned),
      createdAt,
      updatedAt: normalizeStoredDate(note.updatedAt, createdAt),
      reminders: App.Reminders ? App.Reminders.normalizeReminders(note.reminders, note.id) : []
    };
  }

  function normalizeStoredDate(value, fallback) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
  }

  function normalizeStoredContent(content) {
    let normalized;
    if (typeof content === "string") {
      normalized = content;
    } else if (content == null) {
      normalized = "";
    } else {
      try {
        normalized = JSON.stringify(content, null, 2);
      } catch (error) {
        normalized = String(content);
      }
    }
    return normalized.slice(0, MAX_STORED_CONTENT_LENGTH);
  }

  function chooseInitialNote() {
    const lastSelected = notes.find((note) => note.id === settings.lastSelectedNoteId);
    const firstNote = App.Notes.filterAndSort(notes, searchQuery, settings.sortBy)[0];
    selectedId = lastSelected ? lastSelected.id : (firstNote ? firstNote.id : "");
  }

  function currentNote() {
    return notes.find((note) => note.id === selectedId) || null;
  }

  function noteById(id) {
    return notes.find((note) => note.id === id) || null;
  }

  function replaceNote(nextNote) {
    const index = notes.findIndex((note) => note.id === nextNote.id);
    if (index >= 0) {
      notes[index] = nextNote;
    }
  }

  function refreshList() {
    pruneSelectedIds();
    const visibleNotes = App.Notes.filterAndSort(notes, searchQuery, settings.sortBy);
    App.UI.renderNoteList(visibleNotes, selectedId, notes.length, selectedIds);
    App.UI.updateSelectionBar(selectedIds.size);
    renderCurrentReminderState();
  }

  function pruneSelectedIds() {
    const existingIds = new Set(notes.map((note) => note.id));
    Array.from(selectedIds).forEach((id) => {
      if (!existingIds.has(id)) {
        selectedIds.delete(id);
      }
    });
  }

  function toggleNoteSelection(id, selected) {
    if (!notes.some((note) => note.id === id)) {
      return;
    }
    if (selected) {
      selectedIds.add(id);
    } else {
      selectedIds.delete(id);
    }
    refreshList();
  }

  function clearNoteSelection() {
    selectedIds.clear();
    refreshList();
  }

  function selectedNotes() {
    return notes.filter((note) => selectedIds.has(note.id));
  }

  async function selectNote(id, options = {}) {
    if (selectedId && selectedId !== id) {
      await saveNoteById(selectedId, true);
    }

    selectedId = notes.some((note) => note.id === id) ? id : "";
    settings.lastSelectedNoteId = selectedId;
    await saveSettings();

    const note = currentNote();
    App.UI.setEmptyState(!note);
    App.Editor.setControlsEnabled(Boolean(note));
    App.Editor.loadNote(note);
    App.Editor.setPinned(note ? note.pinned : false);
    App.Editor.setSaveStatus(dirtyIds.has(selectedId) ? "dirty" : "saved");
    refreshList();

    if (!options.keepSidebar) {
      App.UI.setSidebarOpen(false);
    }
  }

  async function createNewNote() {
    await saveCurrentNote(true);
    selectedIds.clear();
    const note = App.Notes.createNote();
    try {
      await storage.saveNote(note);
    } catch (error) {
      App.UI.showToast("Die neue Notiz konnte nicht gespeichert werden.", "error");
      return;
    }
    notes.push(note);
    await selectNote(note.id);
    App.Editor.focusEditor();
    App.UI.showToast("Neue Notiz erstellt.");
  }

  async function handleContextAction(action, noteId) {
    if (!noteById(noteId)) {
      return;
    }

    if (action === "open") {
      await selectNote(noteId, { keepSidebar: true });
      return;
    }

    await selectNote(noteId, { keepSidebar: true });

    if (action === "rename") {
      await renameCurrentNote();
    } else if (action === "pin") {
      await toggleCurrentPin();
    } else if (action === "duplicate") {
      await duplicateCurrentNote();
    } else if (action === "reminders") {
      await openReminderManager({ captureSelection: false });
    } else if (action === "export") {
      await exportCurrentNote();
    } else if (action === "delete") {
      await deleteCurrentNote();
    }
  }

  function updateCurrentNote(transform) {
    const note = currentNote();
    if (!note) {
      return null;
    }
    const updated = transform(note);
    replaceNote(updated);
    dirtyIds.add(updated.id);
    App.Editor.setUpdatedAt(updated);
    App.Editor.setPinned(updated.pinned);
    App.Editor.setSaveStatus("dirty");
    refreshList();

    if (settings.autoSave) {
      clearTimeout(saveTimer);
      saveTimer = global.setTimeout(() => saveNoteById(updated.id, false), 520);
    }

    return updated;
  }

  function handleTitleInput(title) {
    updateCurrentNote((note) => App.Notes.rename(note, title));
  }

  function handleContentInput(content) {
    updateCurrentNote((note) => App.Notes.updateContent(note, content));
  }

  async function saveCurrentNote(silent) {
    if (!selectedId) {
      return true;
    }
    clearTimeout(saveTimer);
    return saveNoteById(selectedId, silent);
  }

  async function saveNoteById(id, silent) {
    const note = notes.find((item) => item.id === id);
    if (!note) {
      return true;
    }

    const stamp = note.updatedAt;
    if (!silent && selectedId === id) {
      App.Editor.setSaveStatus("saving");
    }

    try {
      await storage.saveNote(note);
      const latest = notes.find((item) => item.id === id);
      if (!latest || latest.updatedAt === stamp) {
        dirtyIds.delete(id);
      }
      if (selectedId === id) {
        App.Editor.setSaveStatus(dirtyIds.has(id) ? "dirty" : "saved");
        App.Editor.setUpdatedAt(latest || note);
      }
      refreshList();
      return true;
    } catch (error) {
      if (selectedId === id) {
        App.Editor.setSaveStatus("error");
      }
      App.UI.showToast("Die Notiz konnte nicht gespeichert werden.", "error");
      return false;
    }
  }

  async function saveSettings() {
    try {
      await storage.saveSettings(settings);
      return true;
    } catch (error) {
      App.UI.showToast("Einstellungen konnten nicht gespeichert werden.", "error");
      return false;
    }
  }

  async function renameCurrentNote() {
    const note = currentNote();
    if (!note) {
      return;
    }

    const title = await App.UI.promptRename(note.title);
    if (!title) {
      return;
    }
    updateCurrentNote((current) => App.Notes.rename(current, title));
    App.Editor.loadNote(currentNote());
    await saveCurrentNote(false);
  }

  async function toggleCurrentPin() {
    updateCurrentNote((note) => App.Notes.togglePinned(note));
    await saveCurrentNote(false);
  }

  async function duplicateCurrentNote() {
    const note = currentNote();
    if (!note) {
      return;
    }
    await saveCurrentNote(true);
    const copy = App.Notes.duplicate(note);
    try {
      await storage.saveNote(copy);
    } catch (error) {
      App.UI.showToast("Die Kopie konnte nicht gespeichert werden.", "error");
      return;
    }
    notes.push(copy);
    await selectNote(copy.id);
    App.UI.showToast("Notiz dupliziert.");
  }

  async function deleteCurrentNote() {
    const note = currentNote();
    if (!note) {
      return;
    }

    const confirmed = await App.UI.confirmDanger({
      title: "Notiz löschen?",
      message: `„${note.title}“ wird dauerhaft aus dem lokalen Speicher entfernt.`,
      confirmText: "Löschen"
    });
    if (!confirmed) {
      return;
    }

    clearTimeout(saveTimer);
    try {
      await storage.deleteNote(note.id);
    } catch (error) {
      App.UI.showToast("Die Notiz konnte nicht gelöscht werden.", "error");
      return;
    }
    clearReminderTimersForNote(note.id);
    notes = notes.filter((item) => item.id !== note.id);
    dirtyIds.delete(note.id);
    selectedIds.delete(note.id);
    const next = App.Notes.filterAndSort(notes, searchQuery, settings.sortBy)[0] || notes[0];
    selectedId = next ? next.id : "";
    await selectNote(selectedId, { keepSidebar: true });
    App.UI.showToast("Notiz gelöscht.");
  }

  async function exportCurrentNote() {
    const note = currentNote();
    if (!note) {
      return;
    }
    await exportNotes([note], "Notiz", "notiz", "Notiz exportiert.");
  }

  async function exportAllNotes() {
    await exportNotes(notes, "Alle Notizen", "alle-notizen", "Alle Notizen exportiert.");
  }

  async function exportSelectedNotes() {
    const selection = selectedNotes();
    if (!selection.length) {
      App.UI.showToast("Keine Notizen ausgewählt.", "error");
      return;
    }
    const label = `${selection.length} ${selection.length === 1 ? "Notiz" : "Notizen"} exportiert.`;
    await exportNotes(selection, "Auswahl", "ausgewählte-notizen", label);
  }

  async function exportNotes(noteList, scopeLabel, fileBaseName, successMessage) {
    if (!noteList.length) {
      App.UI.showToast("Keine Notizen zum Exportieren vorhanden.", "error");
      return;
    }
    await saveCurrentNote(true);
    const format = await App.UI.chooseExportFormat(scopeLabel);
    if (!format) {
      return;
    }

    try {
      App.Storage.downloadExport(App.Storage.buildExport(noteList, format, fileBaseName));
      App.UI.showToast(successMessage);
    } catch (error) {
      App.UI.showToast(error.message, "error");
    }
  }

  async function duplicateSelectedNotes() {
    const selection = selectedNotes();
    if (!selection.length) {
      App.UI.showToast("Keine Notizen ausgewählt.", "error");
      return;
    }

    await saveCurrentNote(true);
    const copies = selection.map((note) => App.Notes.duplicate(note));
    try {
      await storage.saveNotes(copies);
    } catch (error) {
      App.UI.showToast("Die ausgewählten Notizen konnten nicht dupliziert werden.", "error");
      return;
    }
    notes.push(...copies);
    selectedIds.clear();
    await selectNote(copies[0].id, { keepSidebar: true });
    App.UI.showToast(`${copies.length} ${copies.length === 1 ? "Notiz" : "Notizen"} dupliziert.`);
  }

  async function deleteSelectedNotes() {
    const selection = selectedNotes();
    if (!selection.length) {
      App.UI.showToast("Keine Notizen ausgewählt.", "error");
      return;
    }

    const confirmed = await App.UI.confirmDanger({
      title: `${selection.length} ${selection.length === 1 ? "Notiz" : "Notizen"} löschen?`,
      message: "Die ausgewählten Notizen werden dauerhaft aus dem lokalen Speicher entfernt.",
      confirmText: "Löschen"
    });
    if (!confirmed) {
      return;
    }

    const idsToDelete = new Set(selection.map((note) => note.id));
    const currentWasDeleted = idsToDelete.has(selectedId);
    clearTimeout(saveTimer);
    try {
      for (const id of idsToDelete) {
        await storage.deleteNote(id);
        dirtyIds.delete(id);
      }
    } catch (error) {
      App.UI.showToast("Die ausgewählten Notizen konnten nicht gelöscht werden.", "error");
      return;
    }
    idsToDelete.forEach((id) => clearReminderTimersForNote(id));
    notes = notes.filter((note) => !idsToDelete.has(note.id));
    selectedIds.clear();

    if (currentWasDeleted) {
      const next = App.Notes.filterAndSort(notes, searchQuery, settings.sortBy)[0] || notes[0];
      selectedId = next ? next.id : "";
    }

    await selectNote(selectedId, { keepSidebar: true });
    App.UI.showToast(`${selection.length} ${selection.length === 1 ? "Notiz" : "Notizen"} gelöscht.`);
  }

  async function handleImport(event) {
    const input = event.currentTarget;
    const files = Array.from(input.files || []);
    input.value = "";
    await importFiles(files);
  }

  function bindDragAndDropImport() {
    const root = document.documentElement;
    const clearDragState = () => {
      dragImportDepth = 0;
      document.body.classList.remove("is-dragging-files");
    };

    document.addEventListener("dragenter", (event) => {
      if (!dataTransferHasFiles(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      dragImportDepth += 1;
      document.body.classList.add("is-dragging-files");
    });

    document.addEventListener("dragover", (event) => {
      if (!dataTransferHasFiles(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      document.body.classList.add("is-dragging-files");
    });

    document.addEventListener("dragleave", (event) => {
      if (!dataTransferHasFiles(event.dataTransfer)) {
        return;
      }
      dragImportDepth = Math.max(0, dragImportDepth - 1);
      const leftWindow = event.clientX <= 0
        || event.clientY <= 0
        || event.clientX >= root.clientWidth
        || event.clientY >= root.clientHeight;
      if (dragImportDepth === 0 || leftWindow) {
        clearDragState();
      }
    });

    document.addEventListener("drop", async (event) => {
      if (!dataTransferHasFiles(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files || []);
      clearDragState();
      await importFiles(files);
    });

    document.addEventListener("dragend", clearDragState);
  }

  function dataTransferHasFiles(dataTransfer) {
    if (!dataTransfer) {
      return false;
    }
    if (dataTransfer.files && dataTransfer.files.length) {
      return true;
    }
    const types = dataTransfer.types ? Array.from(dataTransfer.types) : [];
    return types.includes("Files") || types.includes("application/x-moz-file");
  }

  async function importFiles(fileList) {
    const allFiles = Array.from(fileList || []).filter(Boolean);
    if (!allFiles.length) {
      return;
    }

    if (allFiles.length > MAX_IMPORT_FILES) {
      App.UI.showToast(`Maximal ${MAX_IMPORT_FILES} Dateien auf einmal importieren.`, "error");
      return;
    }

    const totalBytes = allFiles.reduce((sum, file) => sum + Math.max(0, Number(file.size) || 0), 0);
    if (totalBytes > MAX_IMPORT_TOTAL_BYTES) {
      App.UI.showToast("Die abgelegten Dateien sind zusammen zu groß. Maximal 20 MB sind erlaubt.", "error");
      return;
    }

    const importedNotes = [];
    const errors = [];
    let skippedEntries = 0;

    await saveCurrentNote(true);

    for (const file of allFiles) {
      if (!file || typeof file.name !== "string") {
        continue;
      }
      if (file.size > App.Storage.MAX_IMPORT_FILE_BYTES) {
        errors.push(`${file.name}: Datei ist zu groß.`);
        continue;
      }

      try {
        const text = await readFileText(file);
        const result = App.Storage.parseImportData(text, file.name, file.type);
        importedNotes.push(...result.notes.map(normalizeStoredNote).filter(Boolean));
        skippedEntries += result.skipped || 0;
      } catch (error) {
        errors.push(`${file.name}: ${error.message || "Import fehlgeschlagen."}`);
      }
    }

    if (!importedNotes.length) {
      App.UI.showToast(errors[0] || "Import fehlgeschlagen.", "error");
      return;
    }

    try {
      await storage.saveNotes(importedNotes);
      notes.push(...importedNotes);
      importedNotes.forEach((note) => scheduleNoteReminders(note));
      selectedIds.clear();
      await selectNote(importedNotes[0].id);
      const suffixParts = [];
      if (skippedEntries) {
        suffixParts.push(`${skippedEntries} beschädigte Einträge wurden übersprungen.`);
      }
      if (errors.length) {
        suffixParts.push(`${errors.length} ${errors.length === 1 ? "Datei wurde" : "Dateien wurden"} übersprungen.`);
      }
      const suffix = suffixParts.length ? ` ${suffixParts.join(" ")}` : "";
      App.UI.showToast(`${importedNotes.length} ${importedNotes.length === 1 ? "Notiz" : "Notizen"} importiert.${suffix}`);
    } catch (error) {
      App.UI.showToast("Die importierten Notizen konnten nicht gespeichert werden.", "error");
    }
  }

  function readFileText(file) {
    if (file && typeof file.text === "function") {
      return file.text();
    }
    if (typeof FileReader === "undefined") {
      return Promise.reject(new Error("Dieser Browser kann die Datei nicht lesen."));
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Datei konnte nicht gelesen werden."));
      reader.readAsText(file);
    });
  }

  function reminderFormElements() {
    const form = document.getElementById("reminderForm");
    if (!form || !form.elements) {
      return null;
    }
    return {
      form,
      reminderId: form.elements.reminderId,
      date: form.elements.reminderDate,
      time: form.elements.reminderTime,
      previewText: form.elements.reminderPreviewText,
      soundEnabled: form.elements.reminderSoundEnabled,
      browserNotification: form.elements.reminderBrowserNotification,
      appDialog: form.elements.reminderAppDialog,
      tabBlink: form.elements.reminderTabBlink,
      error: document.getElementById("reminderFormError"),
      selectionPreview: document.getElementById("reminderSelectionPreview"),
      lineList: document.getElementById("reminderLineList"),
      formTitle: document.getElementById("reminderFormTitle")
    };
  }

  function renderCurrentReminderState() {
    const note = currentNote();
    const button = document.getElementById("remindersButton");
    const badge = document.getElementById("reminderButtonBadge");
    const strip = document.getElementById("reminderStrip");
    const stripTitle = document.getElementById("reminderStripTitle");
    const stripMeta = document.getElementById("reminderStripMeta");
    if (!button || !badge || !strip || !stripTitle || !stripMeta || !App.Reminders) {
      return;
    }

    const summary = note ? App.Reminders.noteSummary(note) : { totalCount: 0, activeCount: 0, next: null };
    button.disabled = !note;
    badge.hidden = !summary.activeCount;
    badge.textContent = summary.activeCount ? String(Math.min(summary.activeCount, 99)) : "";
    button.classList.toggle("has-active-reminders", Boolean(summary.activeCount));

    strip.hidden = !note || !summary.totalCount;
    if (!note || !summary.totalCount) {
      return;
    }

    if (summary.activeCount && summary.next) {
      stripTitle.textContent = summary.activeCount === 1 ? "1 aktive Erinnerung" : `${summary.activeCount} aktive Erinnerungen`;
      stripMeta.textContent = `Nächste: ${App.Reminders.formatDueAt(summary.next.dueAt)}`;
    } else {
      stripTitle.textContent = "Keine aktive Erinnerung";
      stripMeta.textContent = "Verpasste, ausgelöste oder deaktivierte Einträge vorhanden";
    }
  }

  async function openReminderManager(options = {}) {
    let note = currentNote();
    if (!note || !App.Reminders) {
      return;
    }

    const saved = await saveCurrentNote(true);
    if (!saved) {
      return;
    }

    note = currentNote();
    if (!note) {
      return;
    }

    reminderDialogNoteId = note.id;
    const capturedAnchor = options.captureSelection && App.Editor.getSelectionAnchor
      ? App.Editor.getSelectionAnchor()
      : null;
    setReminderDraftLineSelection(
      capturedAnchor ? App.Reminders.createLineSelectionFromAnchor(note.content || "", capturedAnchor) : null
    );

    renderReminderDialog(note);
    resetReminderForm(note, { keepSelection: true });
    const dialog = document.getElementById("reminderDialog");
    if (dialog && App.UI.openDialog) {
      App.UI.openDialog(dialog);
    }
  }

  function closeReminderManager() {
    const dialog = document.getElementById("reminderDialog");
    if (dialog && App.UI.closeDialog) {
      App.UI.closeDialog(dialog, "cancel");
    }
  }

  function setReminderFormError(message) {
    const elements = reminderFormElements();
    if (!elements || !elements.error) {
      return;
    }
    elements.error.textContent = "";
    elements.error.hidden = true;
    if (message && App.UI && typeof App.UI.showToast === "function") {
      App.UI.showToast(message, "error");
    }
  }

  function setReminderFormDueAt(isoValue) {
    const elements = reminderFormElements();
    if (!elements || !App.Reminders) {
      return;
    }
    const values = App.Reminders.inputValuesFromIso(isoValue);
    elements.date.value = values.date;
    elements.time.value = values.time;
    setReminderFormError("");
  }

  function ensureReminderWheelValue(input) {
    if (!input || input.value || !App.Reminders) {
      return;
    }
    const values = App.Reminders.inputValuesFromIso(new Date().toISOString());
    input.value = input.type === "date" ? values.date : values.time;
  }

  function handleReminderDateTimeWheel(event) {
    const input = event.currentTarget;
    if (!input || input.disabled || input.readOnly) {
      return;
    }
    if (!event.deltaY && !event.deltaX) {
      return;
    }

    event.preventDefault();
    try {
      input.focus({ preventScroll: true });
    } catch (error) {
      input.focus();
    }
    ensureReminderWheelValue(input);

    const direction = event.deltaY < 0 || (!event.deltaY && event.deltaX < 0) ? 1 : -1;
    try {
      if (direction > 0) {
        input.stepUp();
      } else {
        input.stepDown();
      }
    } catch (error) {
      return;
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    setReminderFormError("");
  }

  function setReminderDraftLineSelection(selection) {
    reminderDraftLineSelection = selection || null;
    reminderDraftLineIndexes = new Set(
      selection && Array.isArray(selection.selectedLineIndexes)
        ? selection.selectedLineIndexes.filter((index) => Number.isInteger(index) && index >= 0)
        : []
    );
  }

  function currentReminderDraftLineSelection(note) {
    if (!note || !App.Reminders || !reminderDraftLineIndexes.size) {
      return null;
    }
    return App.Reminders.createLineSelection(note.content || "", Array.from(reminderDraftLineIndexes));
  }

  function renderReminderLinePicker(note) {
    const elements = reminderFormElements();
    if (!elements || !elements.lineList || !App.Reminders) {
      return;
    }

    const content = note ? note.content || "" : "";
    elements.lineList.replaceChildren();

    if (!content.trim()) {
      const empty = document.createElement("p");
      empty.className = "reminder-line-empty";
      empty.textContent = "Diese Notiz enthält noch keinen Text.";
      elements.lineList.append(empty);
      return;
    }

    const selectableLines = App.Reminders.contentLines(content).filter((line) => line.text.trim());
    if (!selectableLines.length) {
      const empty = document.createElement("p");
      empty.className = "reminder-line-empty";
      empty.textContent = "Diese Notiz enthält keine auswählbaren Textzeilen.";
      elements.lineList.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    selectableLines.forEach((line) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "reminder-line-option";
      option.dataset.reminderLineIndex = String(line.index);
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(reminderDraftLineIndexes.has(line.index)));
      option.classList.toggle("is-selected", reminderDraftLineIndexes.has(line.index));

      const number = document.createElement("span");
      number.className = "reminder-line-number";
      number.textContent = String(line.index + 1);
      const text = document.createElement("span");
      text.className = "reminder-line-text";
      text.textContent = line.text;
      option.append(number, text);
      fragment.append(option);
    });

    elements.lineList.append(fragment);
  }

  function renderDraftLineSelection(note = noteById(reminderDialogNoteId || selectedId)) {
    const elements = reminderFormElements();
    if (!elements || !elements.selectionPreview || !App.Reminders) {
      return;
    }

    const currentSelection = currentReminderDraftLineSelection(note);
    if (currentSelection) {
      reminderDraftLineSelection = currentSelection;
    }

    const count = reminderDraftLineSelection && reminderDraftLineSelection.selectedLineTexts
      ? reminderDraftLineSelection.selectedLineTexts.length
      : 0;
    const excerpt = reminderDraftLineSelection
      ? App.Reminders.lineSelectionExcerpt(reminderDraftLineSelection, 180)
      : "";
    elements.selectionPreview.textContent = count
      ? `${count} ${count === 1 ? "Zeile" : "Zeilen"} ausgewählt: ${excerpt}`
      : "Keine Zeile ausgewählt";
    elements.selectionPreview.classList.toggle("is-empty", !count);
    renderReminderLinePicker(note);
  }

  function resetReminderForm(note, options = {}) {
    const elements = reminderFormElements();
    if (!elements || !App.Reminders) {
      return;
    }
    if (!options.keepSelection && !options.keepAnchor) {
      setReminderDraftLineSelection(null);
    }
    elements.reminderId.value = "";
    setReminderFormDueAt(new Date().toISOString());
    elements.previewText.value = "";
    elements.soundEnabled.checked = false;
    if (elements.browserNotification) {
      elements.browserNotification.checked = true;
    }
    if (elements.appDialog) {
      elements.appDialog.checked = true;
    }
    if (elements.tabBlink) {
      elements.tabBlink.checked = false;
    }
    if (elements.formTitle) {
      elements.formTitle.textContent = "Erinnerung setzen";
    }
    setReminderFormError("");
    renderDraftLineSelection(note);
    elements.previewText.placeholder = "Optionalen Hinweistext eingeben";
  }

  function captureSelectionForReminder() {
    const note = noteById(reminderDialogNoteId || selectedId);
    if (!note || !App.Reminders) {
      return;
    }

    const selection = currentReminderDraftLineSelection(note);
    if (!selection) {
      App.UI.showToast("Bitte zuerst eine oder mehrere Notizzeilen anklicken.", "error");
      return;
    }

    reminderDraftLineSelection = selection;
    renderDraftLineSelection(note);
    setReminderFormError("");
    App.UI.showToast("Zeilenauswahl übernommen.");
  }

  function clearReminderDraftAnchor() {
    setReminderDraftLineSelection(null);
    renderDraftLineSelection();
  }

  function toggleReminderLineIndex(rawIndex) {
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0) {
      return;
    }
    if (reminderDraftLineIndexes.has(index)) {
      reminderDraftLineIndexes.delete(index);
    } else {
      reminderDraftLineIndexes.add(index);
    }
    if (!reminderDraftLineIndexes.size) {
      reminderDraftLineSelection = null;
    }
    renderDraftLineSelection();
    setReminderFormError("");
  }

  function handleReminderLineListClick(event) {
    const option = closestTarget(event.target, "[data-reminder-line-index]");
    if (!option) {
      return;
    }
    toggleReminderLineIndex(option.dataset.reminderLineIndex);
  }

  function handleReminderLineListKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    const option = closestTarget(event.target, "[data-reminder-line-index]");
    if (!option) {
      return;
    }
    event.preventDefault();
    toggleReminderLineIndex(option.dataset.reminderLineIndex);
  }

  function appendIcon(button, iconId) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#${iconId}`);
    svg.append(use);
    button.append(svg);
  }

  function createReminderActionButton(action, iconId, label, danger = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `icon-button ${danger ? "danger" : ""}`.trim();
    button.dataset.reminderAction = action;
    button.setAttribute("aria-label", label);
    button.dataset.tooltip = label;
    appendIcon(button, iconId);
    return button;
  }

  function renderReminderDialog(note) {
    const list = document.getElementById("reminderList");
    const noteTitle = document.getElementById("reminderDialogNoteTitle");
    if (!list || !noteTitle || !App.Reminders) {
      return;
    }

    const reminders = App.Reminders.normalizeReminders(note && note.reminders, note && note.id);
    noteTitle.textContent = note ? note.title || "Unbenannte Notiz" : "";
    list.replaceChildren();

    if (!reminders.length) {
      const empty = document.createElement("p");
      empty.className = "reminder-empty";
      empty.textContent = "Noch keine Erinnerungen für diese Notiz.";
      list.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    reminders.forEach((reminder) => {
      const row = document.createElement("article");
      row.className = `reminder-row is-${reminder.status}`;
      row.dataset.reminderId = reminder.reminderId;

      const main = document.createElement("div");
      main.className = "reminder-row-main";

      const due = document.createElement("strong");
      due.textContent = App.Reminders.formatDueAt(reminder.dueAt);
      const meta = document.createElement("span");
      meta.className = "reminder-row-meta";
      const selectedLineCount = reminder.lineSelection && reminder.lineSelection.selectedLineTexts
        ? reminder.lineSelection.selectedLineTexts.length
        : 0;
      const metaParts = [
        App.Reminders.statusLabel(reminder.status),
        App.Reminders.notificationLabel(reminder),
        reminder.soundEnabled ? "Ton an" : "Ton aus",
        reminder.tabBlinkEnabled ? "Tab blinkt" : "Tab ruhig"
      ];
      if (selectedLineCount) {
        metaParts.push(`${selectedLineCount} ${selectedLineCount === 1 ? "Zeile" : "Zeilen"}`);
      } else if (reminder.anchor) {
        metaParts.push("alte Auswahl");
      }
      meta.textContent = metaParts.join(" | ");
      const excerpt = document.createElement("span");
      excerpt.className = "reminder-row-excerpt";
      excerpt.textContent = App.Reminders.excerptForReminder(note, reminder);
      main.append(due, meta, excerpt);

      const actions = document.createElement("div");
      actions.className = "reminder-row-actions";
      actions.append(
        createReminderActionButton("edit", "icon-edit", "Erinnerung bearbeiten"),
        createReminderActionButton(
          "toggle",
          reminder.status === "active" ? "icon-bell-off" : "icon-bell",
          reminder.status === "active" ? "Erinnerung deaktivieren" : "Erinnerung aktivieren"
        ),
        createReminderActionButton("delete", "icon-trash", "Erinnerung löschen", true)
      );

      row.append(main, actions);
      fragment.append(row);
    });
    list.append(fragment);
  }

  async function handleReminderFormSubmit(event) {
    event.preventDefault();
    const elements = reminderFormElements();
    const note = noteById(reminderDialogNoteId || selectedId);
    if (!elements || !note || !App.Reminders) {
      return;
    }

    const dueAt = App.Reminders.parseLocalDateTime(elements.date.value, elements.time.value);
    if (!dueAt) {
      setReminderFormError("Bitte ein gültiges Datum und eine gültige Uhrzeit eintragen.");
      return;
    }
    if (new Date(dueAt).getTime() <= Date.now()) {
      setReminderFormError("Der Erinnerungszeitpunkt muss in der Zukunft liegen.");
      return;
    }

    const browserNotificationEnabled = elements.browserNotification ? elements.browserNotification.checked : true;
    const appDialogEnabled = elements.appDialog ? elements.appDialog.checked : true;
    const tabBlinkEnabled = elements.tabBlink ? elements.tabBlink.checked : false;
    if (!browserNotificationEnabled && !appDialogEnabled) {
      setReminderFormError("Bitte mindestens Browser-Benachrichtigung oder App-Dialog aktivieren.");
      return;
    }

    const lineSelection = currentReminderDraftLineSelection(note) || reminderDraftLineSelection;
    const reminderId = elements.reminderId.value;
    const existing = reminderId ? App.Reminders.findReminder(note, reminderId) : null;
    let nextReminder;
    try {
      nextReminder = existing
        ? App.Reminders.updateReminder(existing, {
          dueAt,
          previewText: elements.previewText.value,
          soundEnabled: elements.soundEnabled.checked,
          browserNotificationEnabled,
          appDialogEnabled,
          tabBlinkEnabled,
          anchor: null,
          lineSelection,
          status: "active",
          triggeredAt: "",
          missedAt: "",
          dismissedAt: ""
        })
        : App.Reminders.createReminder({
          noteId: note.id,
          dueAt,
          previewText: elements.previewText.value,
          soundEnabled: elements.soundEnabled.checked,
          browserNotificationEnabled,
          appDialogEnabled,
          tabBlinkEnabled,
          lineSelection
        });
    } catch (error) {
      setReminderFormError(error.message || "Die Erinnerung konnte nicht erstellt werden.");
      return;
    }

    const nextReminders = App.Reminders.withReminder(note.reminders, nextReminder);
    const saved = await saveNoteReminders(note.id, nextReminders);
    if (!saved) {
      return;
    }

    const permission = await App.Notifications.requestPermissionIfUseful({ enabled: browserNotificationEnabled });
    resetReminderForm(noteById(note.id), { keepSelection: false });
    App.UI.showToast(existing ? "Erinnerung aktualisiert." : "Erinnerung gesetzt.");
    if (browserNotificationEnabled && permission !== "granted" && permission !== "skipped") {
      App.UI.showToast("Browser-Benachrichtigungen sind nicht erlaubt. Fällige Erinnerungen erscheinen als App-Dialog.", "error");
    }
  }

  async function handleReminderListClick(event) {
    const button = closestTarget(event.target, "[data-reminder-action]");
    if (!button) {
      return;
    }

    const row = closestTarget(button, "[data-reminder-id]");
    const note = noteById(reminderDialogNoteId || selectedId);
    if (!row || !note || !App.Reminders) {
      return;
    }

    const reminder = App.Reminders.findReminder(note, row.dataset.reminderId);
    if (!reminder) {
      App.UI.showToast("Diese Erinnerung wurde nicht gefunden.", "error");
      renderReminderDialog(note);
      return;
    }

    if (button.dataset.reminderAction === "edit") {
      editReminderInForm(note, reminder);
      return;
    }

    if (button.dataset.reminderAction === "delete") {
      const nextReminders = App.Reminders.withoutReminder(note.reminders, reminder.reminderId, note.id);
      const saved = await saveNoteReminders(note.id, nextReminders);
      if (saved) {
        resetReminderForm(noteById(note.id), { keepSelection: false });
        App.UI.showToast("Erinnerung gelöscht.");
      }
      return;
    }

    if (button.dataset.reminderAction === "toggle") {
      await toggleReminderStatus(note, reminder);
    }
  }

  function editReminderInForm(note, reminder) {
    const elements = reminderFormElements();
    if (!elements || !App.Reminders) {
      return;
    }
    elements.reminderId.value = reminder.reminderId;
    setReminderFormDueAt(reminder.dueAt);
    elements.previewText.value = reminder.previewText || "";
    elements.soundEnabled.checked = Boolean(reminder.soundEnabled);
    if (elements.browserNotification) {
      elements.browserNotification.checked = reminder.browserNotificationEnabled !== false;
    }
    if (elements.appDialog) {
      elements.appDialog.checked = reminder.appDialogEnabled !== false;
    }
    if (elements.tabBlink) {
      elements.tabBlink.checked = Boolean(reminder.tabBlinkEnabled);
    }
    const resolvedSelection = reminder.lineSelection
      ? App.Reminders.resolveLineSelection(note && note.content, reminder.lineSelection)
      : null;
    const lineSelection = resolvedSelection && resolvedSelection.found
      ? App.Reminders.createLineSelection(note && note.content, resolvedSelection.ranges.map((range) => range.lineIndex))
      : (reminder.lineSelection || App.Reminders.createLineSelectionFromAnchor(note && note.content, reminder.anchor));
    setReminderDraftLineSelection(lineSelection);
    if (elements.formTitle) {
      elements.formTitle.textContent = "Erinnerung bearbeiten";
    }
    renderDraftLineSelection(note);
    setReminderFormError("");
    elements.date.focus();
  }

  async function toggleReminderStatus(note, reminder) {
    const now = new Date().toISOString();
    let patch;
    if (reminder.status === "active") {
      patch = { status: "dismissed", dismissedAt: now };
    } else {
      if (new Date(reminder.dueAt).getTime() <= Date.now()) {
        App.UI.showToast("Abgelaufene Erinnerungen bitte mit neuem Zeitpunkt bearbeiten.", "error");
        return;
      }
      patch = { status: "active", dismissedAt: "", triggeredAt: "", missedAt: "" };
    }

    const updatedReminder = App.Reminders.updateReminder(reminder, patch);
    const saved = await saveNoteReminders(note.id, App.Reminders.withReminder(note.reminders, updatedReminder));
    if (saved) {
      App.UI.showToast(updatedReminder.status === "active" ? "Erinnerung aktiviert." : "Erinnerung deaktiviert.");
    }
  }

  async function saveNoteReminders(noteId, reminders) {
    const note = noteById(noteId);
    if (!note || !App.Reminders) {
      App.UI.showToast("Die zugehörige Notiz wurde nicht gefunden.", "error");
      return false;
    }

    const stamp = note.updatedAt;
    const previous = note;
    const updated = {
      ...note,
      reminders: App.Reminders.normalizeReminders(reminders, note.id)
    };
    replaceNote(updated);

    try {
      await storage.saveNote(updated);
      const latest = noteById(noteId);
      if (latest && latest.updatedAt === stamp) {
        dirtyIds.delete(noteId);
      }
      scheduleNoteReminders(updated);
      refreshList();
      if (reminderDialogNoteId === noteId) {
        renderReminderDialog(updated);
      }
      if (selectedId === noteId) {
        App.Editor.setSaveStatus(dirtyIds.has(noteId) ? "dirty" : "saved");
      }
      return true;
    } catch (error) {
      replaceNote(previous);
      scheduleNoteReminders(previous);
      refreshList();
      if (reminderDialogNoteId === noteId) {
        renderReminderDialog(previous);
      }
      App.UI.showToast("Erinnerungen konnten nicht gespeichert werden.", "error");
      return false;
    }
  }

  function initializeReminderTimers() {
    reminderTimers.forEach((entry) => global.clearTimeout(entry.timerId));
    reminderTimers.clear();
    notes.forEach((note) => scheduleNoteReminders(note, { initial: true }));
  }

  function clearReminderTimersForNote(noteId) {
    Array.from(reminderTimers.entries()).forEach(([timerKey, entry]) => {
      if (entry.noteId === noteId) {
        global.clearTimeout(entry.timerId);
        reminderTimers.delete(timerKey);
      }
    });
  }

  function reminderTimerKey(noteId, reminderId) {
    return `${noteId}::${reminderId}`;
  }

  function scheduleNoteReminders(note, options = {}) {
    if (!note || !App.Reminders) {
      return;
    }
    clearReminderTimersForNote(note.id);
    App.Reminders.activeReminders(note).forEach((reminder) => {
      const dueTime = new Date(reminder.dueAt).getTime();
      scheduleReminderTimer(note.id, reminder, {
        missed: Boolean(options.initial && dueTime <= Date.now())
      });
    });
  }

  function scheduleReminderTimer(noteId, reminder, options = {}) {
    const dueTime = new Date(reminder.dueAt).getTime();
    if (Number.isNaN(dueTime)) {
      return;
    }

    const delay = dueTime - Date.now();
    const reminderId = reminder.reminderId;
    const timerKey = reminderTimerKey(noteId, reminderId);
    const timerId = global.setTimeout(() => {
      reminderTimers.delete(timerKey);
      if (delay > MAX_TIMER_DELAY_MS) {
        const latestNote = noteById(noteId);
        const latestReminder = App.Reminders.findReminder(latestNote, reminderId);
        if (latestReminder && latestReminder.status === "active") {
          scheduleReminderTimer(noteId, latestReminder, options);
        }
        return;
      }
      void triggerReminder(noteId, reminderId, { missed: Boolean(options.missed) });
    }, Math.max(0, Math.min(delay, MAX_TIMER_DELAY_MS)));

    reminderTimers.set(timerKey, { noteId, reminderId, timerId });
  }

  async function triggerReminder(noteId, reminderId, options = {}) {
    const note = noteById(noteId);
    if (!note || !App.Reminders) {
      clearReminderTimer(noteId, reminderId);
      return;
    }

    const reminder = App.Reminders.findReminder(note, reminderId);
    if (!reminder || reminder.status !== "active") {
      clearReminderTimer(noteId, reminderId);
      return;
    }

    const status = options.missed ? "missed" : "triggered";
    const timeKey = status === "missed" ? "missedAt" : "triggeredAt";
    const updatedReminder = App.Reminders.updateReminder(reminder, {
      status,
      [timeKey]: new Date().toISOString()
    });
    const nextReminders = App.Reminders.withReminder(note.reminders, updatedReminder);
    const saved = await saveNoteReminders(note.id, nextReminders);
    const latestNote = noteById(note.id) || { ...note, reminders: nextReminders };
    const latestReminder = App.Reminders.findReminder(latestNote, reminderId) || updatedReminder;

    if (saved) {
      const selectionResolution = App.Reminders.resolveReminderSelection(latestNote, latestReminder);
      const selectionWarning = reminderSelectionWarning(selectionResolution);
      await App.Notifications.playTone(latestReminder.soundEnabled);
      await App.Notifications.notifyReminder({
        title: `${status === "missed" ? "Verpasst" : "Erinnerung"}: ${latestNote.title || "Unbenannte Notiz"}`,
        noteTitle: latestNote.title || "Unbenannte Notiz",
        previewText: latestReminder.previewText || "",
        body: latestReminder.previewText || "",
        dueAtLabel: App.Reminders.formatDueAt(latestReminder.dueAt),
        selectedLines: App.Reminders.selectedLineTextsForReminder(latestReminder),
        warning: selectionWarning,
        tag: `${latestNote.id}-${latestReminder.reminderId}`,
        status,
        browserNotificationEnabled: latestReminder.browserNotificationEnabled,
        appDialogEnabled: latestReminder.appDialogEnabled,
        tabBlinkEnabled: latestReminder.tabBlinkEnabled,
        onClick: () => {
          void openTriggeredReminder(latestNote.id, latestReminder.reminderId);
        }
      });

      if (selectedId === latestNote.id && selectionResolution.hasSelection) {
        applyReminderHighlight(latestNote, latestReminder, { silent: true });
      }
    }
  }

  function clearReminderTimer(noteId, reminderId) {
    const entry = reminderTimers.get(reminderTimerKey(noteId, reminderId));
    if (entry) {
      global.clearTimeout(entry.timerId);
      reminderTimers.delete(reminderTimerKey(noteId, reminderId));
    }
  }

  async function openTriggeredReminder(noteId, reminderId) {
    const note = noteById(noteId);
    if (!note) {
      App.UI.showToast("Die Notiz zu dieser Erinnerung wurde nicht gefunden.", "error");
      clearReminderTimer(noteId, reminderId);
      return;
    }
    await selectNote(noteId, { keepSidebar: true });
    const latest = noteById(noteId);
    const reminder = App.Reminders.findReminder(latest, reminderId);
    if (latest && reminder) {
      applyReminderHighlight(latest, reminder, { silent: false });
    }
  }

  function reminderSelectionWarning(resolution) {
    if (!resolution || !resolution.hasSelection) {
      return "";
    }
    if (resolution.partial) {
      return "Einige gespeicherte Notizzeilen wurden nicht mehr eindeutig gefunden.";
    }
    if (resolution.stale) {
      return "Die ursprüngliche Auswahl hat sich verändert und wurde nur über ihre alte Position geöffnet.";
    }
    if (!resolution.found) {
      return "Die ursprüngliche Zeilenauswahl wurde nicht mehr eindeutig gefunden.";
    }
    return "";
  }

  function applyReminderHighlight(note, reminder, options = {}) {
    if (!App.Highlighting || !App.Reminders) {
      return { found: false };
    }
    const selectionResolution = App.Reminders.resolveReminderSelection(note, reminder);
    if (!selectionResolution.hasSelection) {
      return { found: false };
    }
    const result = App.Highlighting.highlight(note, reminder);
    if (!options.silent) {
      if (result.partial) {
        App.UI.showToast("Einige gespeicherte Notizzeilen wurden nicht mehr eindeutig gefunden.", "error");
      } else if (!result.found) {
        App.UI.showToast("Der markierte Notizbereich wurde nicht mehr eindeutig gefunden.", "error");
      } else if (result.stale) {
        App.UI.showToast("Die ursprüngliche Auswahl hat sich verändert.", "error");
      }
    }
    return result;
  }

  async function openSettings() {
    const nextSettings = await App.UI.openSettings(settings);
    if (!nextSettings) {
      return;
    }

    settings = nextSettings;
    App.Settings.applySettings(settings);
    App.Editor.setViewMode(settings.viewMode);
    App.UI.setSortValue(settings.sortBy);
    await saveSettings();
    refreshList();
    App.UI.showToast("Einstellungen gespeichert.");
  }

  App.prepareForSilentUpdate = async function prepareForSilentUpdate() {
    clearTimeout(saveTimer);
    if (selectedId) {
      const noteSaved = await saveNoteById(selectedId, true);
      if (!noteSaved) {
        throw new Error("Die aktuelle Notiz konnte vor dem Update nicht gespeichert werden.");
      }
    }
    const settingsSaved = await saveSettings();
    if (!settingsSaved) {
      throw new Error("Die Einstellungen konnten vor dem Update nicht gespeichert werden.");
    }
  };
})(window);
