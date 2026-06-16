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
  let dragImportDepth = 0;

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
    selectNote(selectedId, { keepSidebar: true });
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
      updatedAt: normalizeStoredDate(note.updatedAt, createdAt)
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
        importedNotes.push(...result.notes);
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
