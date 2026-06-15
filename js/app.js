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

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    App.UI.init({
      onContextAction: handleContextAction
    });
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

    App.Editor.init({
      onTitleInput: handleTitleInput,
      onContentInput: handleContentInput,
      onSaveNow: () => saveCurrentNote(false),
      onFullscreenChange: () => {}
    });
    App.Editor.setViewMode(settings.viewMode);

    bindEvents();
    await loadNotes();
    chooseInitialNote();
    refreshList();
    selectNote(selectedId, { keepSidebar: true });
    App.Editor.setSaveStatus("saved");
  }

  function bindEvents() {
    document.getElementById("newNoteButton").addEventListener("click", createNewNote);
    document.getElementById("emptyNewNoteButton").addEventListener("click", createNewNote);
    document.getElementById("openSidebarButton").addEventListener("click", () => App.UI.setSidebarOpen(true));
    document.getElementById("sidebarScrim").addEventListener("click", () => App.UI.setSidebarOpen(false));

    document.getElementById("noteList").addEventListener("click", async (event) => {
      const openTarget = event.target.closest("[data-note-open]");
      if (!openTarget) {
        return;
      }
      const card = event.target.closest("[data-note-id]");
      if (!card) {
        return;
      }
      await selectNote(card.dataset.noteId);
    });

    document.getElementById("noteList").addEventListener("change", (event) => {
      const checkbox = event.target.closest("[data-note-checkbox]");
      if (!checkbox) {
        return;
      }
      const card = checkbox.closest("[data-note-id]");
      if (!card) {
        return;
      }
      toggleNoteSelection(card.dataset.noteId, checkbox.checked);
    });

    document.getElementById("noteList").addEventListener("contextmenu", (event) => {
      const card = event.target.closest("[data-note-id]");
      if (!card) {
        return;
      }
      event.preventDefault();
      const note = noteById(card.dataset.noteId);
      App.UI.openNoteContextMenu(note, event.clientX, event.clientY);
    });

    document.getElementById("searchInput").addEventListener("input", (event) => {
      searchQuery = event.target.value;
      refreshList();
    });

    document.getElementById("sortSelect").addEventListener("change", async (event) => {
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

    document.getElementById("renameNoteButton").addEventListener("click", renameCurrentNote);
    document.getElementById("pinNoteButton").addEventListener("click", toggleCurrentPin);
    document.getElementById("duplicateNoteButton").addEventListener("click", duplicateCurrentNote);
    document.getElementById("deleteNoteButton").addEventListener("click", deleteCurrentNote);
    document.getElementById("exportNoteButton").addEventListener("click", exportCurrentNote);
    document.getElementById("exportAllButton").addEventListener("click", exportAllNotes);
    document.getElementById("bulkExportButton").addEventListener("click", exportSelectedNotes);
    document.getElementById("bulkDuplicateButton").addEventListener("click", duplicateSelectedNotes);
    document.getElementById("bulkDeleteButton").addEventListener("click", deleteSelectedNotes);
    document.getElementById("clearSelectionButton").addEventListener("click", clearNoteSelection);
    document.getElementById("settingsButton").addEventListener("click", openSettings);
    document.getElementById("importButton").addEventListener("click", () => document.getElementById("importInput").click());
    document.getElementById("importInput").addEventListener("change", handleImport);

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
    if (!note || typeof note !== "object" || typeof note.id !== "string") {
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
    if (typeof content === "string") {
      return content;
    }
    if (content == null) {
      return "";
    }
    try {
      return JSON.stringify(content, null, 2);
    } catch (error) {
      return String(content);
    }
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
      return;
    }
    clearTimeout(saveTimer);
    await saveNoteById(selectedId, silent);
  }

  async function saveNoteById(id, silent) {
    const note = notes.find((item) => item.id === id);
    if (!note) {
      return;
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
    } catch (error) {
      if (selectedId === id) {
        App.Editor.setSaveStatus("error");
      }
      App.UI.showToast("Die Notiz konnte nicht gespeichert werden.", "error");
    }
  }

  async function saveSettings() {
    try {
      await storage.saveSettings(settings);
    } catch (error) {
      App.UI.showToast("Einstellungen konnten nicht gespeichert werden.", "error");
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
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) {
      return;
    }

    if (file.size > App.Storage.MAX_IMPORT_FILE_BYTES) {
      App.UI.showToast("Die Importdatei ist zu groß. Maximal 5 MB sind erlaubt.", "error");
      return;
    }

    try {
      const text = await file.text();
      const result = App.Storage.parseImportData(text, file.name);
      await storage.saveNotes(result.notes);
      notes.push(...result.notes);
      selectedIds.clear();
      await selectNote(result.notes[0].id);
      const suffix = result.skipped ? ` ${result.skipped} beschädigte Einträge wurden übersprungen.` : "";
      App.UI.showToast(`${result.notes.length} ${result.notes.length === 1 ? "Notiz" : "Notizen"} importiert.${suffix}`);
    } catch (error) {
      App.UI.showToast(error.message || "Import fehlgeschlagen.", "error");
    }
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
})(window);
