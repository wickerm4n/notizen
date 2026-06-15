(function editorModule(global) {
  "use strict";

  const App = global.NotizenApp || (global.NotizenApp = {});
  const elements = {};
  const FULLSCREEN_TRANSITION_MS = 260;
  let currentNoteId = "";
  let fullscreenTimer = 0;

  function init(callbacks) {
    elements.workspace = document.getElementById("workspace");
    elements.titleInput = document.getElementById("noteTitleInput");
    elements.textarea = document.getElementById("noteEditor");
    elements.preview = document.getElementById("markdownPreview");
    elements.saveStatus = document.getElementById("saveStatus");
    elements.updatedAtStatus = document.getElementById("updatedAtStatus");
    elements.wordCount = document.getElementById("wordCount");
    elements.charCount = document.getElementById("charCount");
    elements.saveNowButton = document.getElementById("saveNowButton");
    elements.fullscreenButton = document.getElementById("fullscreenButton");

    elements.titleInput.addEventListener("input", () => callbacks.onTitleInput(elements.titleInput.value));
    elements.textarea.addEventListener("input", () => {
      updateCounters();
      syncPreview();
      callbacks.onContentInput(elements.textarea.value);
    });
    elements.saveNowButton.addEventListener("click", callbacks.onSaveNow);
    elements.fullscreenButton.addEventListener("click", () => {
      const active = toggleFullscreen();
      callbacks.onFullscreenChange(active);
    });

    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        callbacks.onSaveNow();
      }
      if (event.key === "Escape" && isFullscreen()) {
        toggleFullscreen(false);
        callbacks.onFullscreenChange(false);
      }
    });
  }

  function loadNote(note) {
    currentNoteId = note ? note.id : "";
    elements.titleInput.value = note ? note.title : "";
    elements.textarea.value = note ? note.content : "";
    elements.titleInput.disabled = !note;
    elements.textarea.disabled = !note;
    elements.saveNowButton.disabled = !note;
    syncPreview();
    updateCounters();
    setUpdatedAt(note);
  }

  function focusEditor() {
    elements.textarea.focus();
  }

  function syncPreview() {
    elements.preview.innerHTML = App.Markdown.renderMarkdown(elements.textarea.value);
  }

  function updateCounters() {
    const content = elements.textarea.value || "";
    const words = App.Notes.wordCount(content);
    const chars = content.length;
    elements.wordCount.textContent = `${words} ${words === 1 ? "Wort" : "Wörter"}`;
    elements.charCount.textContent = `${chars} ${chars === 1 ? "Zeichen" : "Zeichen"}`;
    return { words, chars };
  }

  function setSaveStatus(status) {
    const labels = {
      saved: "Gespeichert",
      saving: "Speichert…",
      dirty: "Nicht gespeichert",
      error: "Speichern fehlgeschlagen"
    };
    elements.saveStatus.textContent = labels[status] || labels.saved;
    elements.saveStatus.dataset.status = status;
  }

  function setUpdatedAt(note) {
    if (!note) {
      elements.updatedAtStatus.textContent = "Noch nicht bearbeitet";
      return;
    }
    elements.updatedAtStatus.textContent = `Geändert: ${App.Notes.formatFullDate(note.updatedAt)}`;
  }

  function setViewMode(mode) {
    const cleanMode = App.Settings.sanitizeViewMode(mode);
    elements.workspace.dataset.viewMode = cleanMode;
    document.querySelectorAll("[data-view-mode]").forEach((button) => {
      const active = button.dataset.viewMode === cleanMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (cleanMode !== "editor") {
      syncPreview();
    }
  }

  function setPinned(isPinned) {
    const button = document.getElementById("pinNoteButton");
    button.classList.toggle("is-active", Boolean(isPinned));
    button.setAttribute("aria-pressed", String(Boolean(isPinned)));
    const label = isPinned ? "Pin entfernen" : "Notiz anpinnen";
    button.setAttribute("aria-label", label);
    button.dataset.tooltip = label;
  }

  function setControlsEnabled(enabled) {
    const ids = [
      "renameNoteButton",
      "pinNoteButton",
      "duplicateNoteButton",
      "exportNoteButton",
      "deleteNoteButton",
      "saveNowButton"
    ];
    ids.forEach((id) => {
      const button = document.getElementById(id);
      if (button) {
        button.disabled = !enabled;
      }
    });
  }

  function isFullscreen() {
    return elements.workspace.classList.contains("is-fullscreen")
      || document.body.classList.contains("fullscreen-sidebar-hidden");
  }

  function toggleFullscreen(force) {
    const nextState = typeof force === "boolean" ? force : !isFullscreen();
    clearTimeout(fullscreenTimer);
    fullscreenTimer = 0;

    if (nextState) {
      document.body.classList.remove("sidebar-open");
      document.body.classList.add("fullscreen-transition", "fullscreen-sidebar-hidden");
      setFullscreenButtonState(true);
      fullscreenTimer = window.setTimeout(() => {
        elements.workspace.classList.add("is-fullscreen");
        document.body.classList.remove("fullscreen-transition");
        fullscreenTimer = 0;
      }, FULLSCREEN_TRANSITION_MS);
      return true;
    }

    elements.workspace.classList.remove("is-fullscreen");
    document.body.classList.add("fullscreen-transition");
    setFullscreenButtonState(false);
    requestAnimationFrame(() => {
      document.body.classList.remove("fullscreen-sidebar-hidden");
      fullscreenTimer = window.setTimeout(() => {
        document.body.classList.remove("fullscreen-transition");
        fullscreenTimer = 0;
      }, FULLSCREEN_TRANSITION_MS);
    });
    return false;
  }

  function setFullscreenButtonState(nextState) {
    const label = nextState ? "Vollbild-Schreibmodus verlassen" : "Vollbild-Schreibmodus";
    elements.fullscreenButton.classList.toggle("is-active", nextState);
    elements.fullscreenButton.setAttribute("aria-pressed", String(nextState));
    elements.fullscreenButton.setAttribute("aria-label", label);
    elements.fullscreenButton.dataset.tooltip = label;
  }

  function getTitle() {
    return elements.titleInput.value;
  }

  function getContent() {
    return elements.textarea.value;
  }

  App.Editor = {
    init,
    loadNote,
    focusEditor,
    syncPreview,
    updateCounters,
    setSaveStatus,
    setUpdatedAt,
    setViewMode,
    setPinned,
    setControlsEnabled,
    getTitle,
    getContent
  };
})(window);
