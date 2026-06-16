(function editorModule(global) {
  "use strict";

  const App = global.NotizenApp || (global.NotizenApp = {});
  const elements = {};
  const REQUIRED_ELEMENTS = [
    ["workspace", "workspace"],
    ["titleInput", "noteTitleInput"],
    ["textarea", "noteEditor"],
    ["preview", "markdownPreview"],
    ["saveStatus", "saveStatus"],
    ["updatedAtStatus", "updatedAtStatus"],
    ["wordCount", "wordCount"],
    ["charCount", "charCount"],
    ["saveNowButton", "saveNowButton"],
    ["fullscreenButton", "fullscreenButton"]
  ];
  const FULLSCREEN_TRANSITION_MS = 260;
  const MOBILE_FULLSCREEN_QUERY = "(max-width: 980px), (max-height: 560px) and (hover: none)";
  let currentNoteId = "";
  let fullscreenTimer = 0;

  function init(callbacks) {
    callbacks = callbacks || {};
    if (!collectElements()) {
      return false;
    }

    const handlers = {
      onTitleInput: typeof callbacks.onTitleInput === "function" ? callbacks.onTitleInput : () => {},
      onContentInput: typeof callbacks.onContentInput === "function" ? callbacks.onContentInput : () => {},
      onSaveNow: typeof callbacks.onSaveNow === "function" ? callbacks.onSaveNow : () => {},
      onFullscreenChange: typeof callbacks.onFullscreenChange === "function" ? callbacks.onFullscreenChange : () => {}
    };

    elements.titleInput.addEventListener("input", () => handlers.onTitleInput(elements.titleInput.value));
    elements.textarea.addEventListener("input", () => {
      updateCounters();
      syncPreview();
      handlers.onContentInput(elements.textarea.value);
    });
    elements.saveNowButton.addEventListener("click", handlers.onSaveNow);
    elements.fullscreenButton.addEventListener("click", () => {
      const active = toggleFullscreen();
      handlers.onFullscreenChange(active);
    });

    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        handlers.onSaveNow();
      }
      if (event.key === "Escape" && isFullscreen()) {
        toggleFullscreen(false);
        handlers.onFullscreenChange(false);
      }
    });

    return true;
  }

  function collectElements() {
    const missing = [];
    REQUIRED_ELEMENTS.forEach(([key, id]) => {
      elements[key] = document.getElementById(id);
      if (!elements[key]) {
        missing.push(id);
      }
    });

    if (missing.length) {
      console.error(`Notizen-App: Editor-Elemente fehlen: ${missing.join(", ")}`);
      return false;
    }
    return true;
  }

  function loadNote(note) {
    if (!elements.titleInput || !elements.textarea) {
      return;
    }
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
    if (elements.textarea) {
      elements.textarea.focus();
    }
  }

  function syncPreview() {
    if (!elements.preview || !elements.textarea) {
      return;
    }
    elements.preview.innerHTML = renderSafePreviewHtml(elements.textarea.value);
  }

  function renderSafePreviewHtml(content) {
    if (App.Markdown && typeof App.Markdown.renderMarkdown === "function") {
      return App.Markdown.renderMarkdown(content);
    }
    const escape = App.Markdown && typeof App.Markdown.escapeHtml === "function"
      ? App.Markdown.escapeHtml
      : (value) => String(value ?? "");
    return `<p>${escape(content).replace(/\n/g, "<br>\n")}</p>`;
  }

  function updateCounters() {
    if (!elements.textarea || !elements.wordCount || !elements.charCount) {
      return { words: 0, chars: 0 };
    }
    const content = elements.textarea.value || "";
    const words = App.Notes.wordCount(content);
    const chars = content.length;
    elements.wordCount.textContent = `${words} ${words === 1 ? "Wort" : "Wörter"}`;
    elements.charCount.textContent = `${chars} ${chars === 1 ? "Zeichen" : "Zeichen"}`;
    return { words, chars };
  }

  function setSaveStatus(status) {
    if (!elements.saveStatus) {
      return;
    }
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
    if (!elements.updatedAtStatus) {
      return;
    }
    if (!note) {
      elements.updatedAtStatus.textContent = "Noch nicht bearbeitet";
      return;
    }
    elements.updatedAtStatus.textContent = `Geändert: ${App.Notes.formatFullDate(note.updatedAt)}`;
  }

  function setViewMode(mode) {
    if (!elements.workspace) {
      return;
    }
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
    if (!button) {
      return;
    }
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
    return Boolean(elements.workspace && elements.workspace.classList.contains("is-fullscreen"))
      || document.body.classList.contains("fullscreen-sidebar-hidden");
  }

  function toggleFullscreen(force) {
    if (!elements.workspace || !elements.fullscreenButton) {
      return false;
    }
    const nextState = typeof force === "boolean" ? force : !isFullscreen();
    clearPendingFullscreenTimer();

    if (nextState) {
      document.body.classList.remove("sidebar-open");
      document.body.classList.add("fullscreen-sidebar-hidden");
      if (shouldApplyFullscreenImmediately()) {
        elements.workspace.classList.add("is-fullscreen");
      } else {
        document.body.classList.add("fullscreen-transition");
        fullscreenTimer = global.setTimeout(() => {
          elements.workspace.classList.add("is-fullscreen");
          document.body.classList.remove("fullscreen-transition");
          fullscreenTimer = 0;
        }, FULLSCREEN_TRANSITION_MS);
      }
      setFullscreenButtonState(true);
      return true;
    }

    elements.workspace.classList.remove("is-fullscreen");
    document.body.classList.remove("fullscreen-sidebar-hidden", "fullscreen-transition");
    setFullscreenButtonState(false);
    return false;
  }

  function shouldApplyFullscreenImmediately() {
    return Boolean(global.matchMedia && global.matchMedia(MOBILE_FULLSCREEN_QUERY).matches);
  }

  function clearPendingFullscreenTimer() {
    if (!fullscreenTimer) {
      return;
    }
    global.clearTimeout(fullscreenTimer);
    fullscreenTimer = 0;
  }

  function exitFullscreen() {
    if (isFullscreen()) {
      toggleFullscreen(false);
    }
  }

  function setFullscreenButtonState(nextState) {
    const label = nextState ? "Vollbild-Schreibmodus verlassen" : "Vollbild-Schreibmodus";
    elements.fullscreenButton.classList.toggle("is-active", nextState);
    elements.fullscreenButton.setAttribute("aria-pressed", String(nextState));
    elements.fullscreenButton.setAttribute("aria-label", label);
    elements.fullscreenButton.dataset.tooltip = label;
  }

  function getTitle() {
    return elements.titleInput ? elements.titleInput.value : "";
  }

  function getContent() {
    return elements.textarea ? elements.textarea.value : "";
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
    exitFullscreen,
    getTitle,
    getContent
  };
})(window);
