(function settingsModule(global) {
  "use strict";

  const App = global.NotizenApp || (global.NotizenApp = {});

  const DEFAULT_SETTINGS = {
    theme: "system",
    fontFamily: "system",
    fontSize: 18,
    viewMode: "editor",
    autoSave: true,
    showCounters: true,
    sortBy: "updatedAt",
    lastSelectedNoteId: ""
  };

  const FONT_STACKS = {
    system: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    serif: 'ui-serif, Georgia, "Times New Roman", serif',
    mono: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace',
    atkinson: '"Atkinson Hyperlegible", "Segoe UI", Verdana, sans-serif'
  };

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, number));
  }

  function sanitizeTheme(value) {
    return ["system", "light", "dark"].includes(value) ? value : DEFAULT_SETTINGS.theme;
  }

  function sanitizeViewMode(value) {
    return ["editor", "preview", "split"].includes(value) ? value : DEFAULT_SETTINGS.viewMode;
  }

  function sanitizeSortBy(value) {
    return ["updatedAt", "createdAt", "title"].includes(value) ? value : DEFAULT_SETTINGS.sortBy;
  }

  function mergeSettings(stored) {
    const merged = { ...DEFAULT_SETTINGS, ...(stored || {}) };
    return {
      theme: sanitizeTheme(merged.theme),
      fontFamily: Object.prototype.hasOwnProperty.call(FONT_STACKS, merged.fontFamily) ? merged.fontFamily : DEFAULT_SETTINGS.fontFamily,
      fontSize: clampNumber(merged.fontSize, 14, 28, DEFAULT_SETTINGS.fontSize),
      viewMode: sanitizeViewMode(merged.viewMode),
      autoSave: Boolean(merged.autoSave),
      showCounters: Boolean(merged.showCounters),
      sortBy: sanitizeSortBy(merged.sortBy),
      lastSelectedNoteId: String(merged.lastSelectedNoteId || "")
    };
  }

  function getSystemTheme() {
    return global.matchMedia && global.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function effectiveTheme(settings) {
    return settings.theme === "system" ? getSystemTheme() : settings.theme;
  }

  function applySettings(settings) {
    const clean = mergeSettings(settings);
    const root = document.documentElement;
    const body = document.body;
    body.dataset.theme = effectiveTheme(clean);
    body.classList.toggle("show-counters", clean.showCounters);

    root.style.setProperty("--editor-font-family", FONT_STACKS[clean.fontFamily]);
    root.style.setProperty("--editor-font-size", `${clean.fontSize}px`);

    const workspace = document.getElementById("workspace");
    if (workspace) {
      workspace.dataset.viewMode = clean.viewMode;
    }
  }

  function populateForm(form, settings) {
    const clean = mergeSettings(settings);
    form.elements.fontFamily.value = clean.fontFamily;
    form.elements.fontSize.value = String(clean.fontSize);
    form.elements.theme.value = clean.theme;
    form.elements.viewMode.value = clean.viewMode;
    form.elements.autoSave.checked = clean.autoSave;
    form.elements.showCounters.checked = clean.showCounters;
  }

  function readForm(form, currentSettings) {
    return mergeSettings({
      ...currentSettings,
      fontFamily: form.elements.fontFamily.value,
      fontSize: form.elements.fontSize.value,
      theme: form.elements.theme.value,
      viewMode: form.elements.viewMode.value,
      autoSave: form.elements.autoSave.checked,
      showCounters: form.elements.showCounters.checked
    });
  }

  function watchSystemTheme(callback) {
    if (!global.matchMedia) {
      return () => {};
    }
    const query = global.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => callback();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", handler);
      return () => query.removeEventListener("change", handler);
    }
    query.addListener(handler);
    return () => query.removeListener(handler);
  }

  App.Settings = {
    DEFAULT_SETTINGS,
    mergeSettings,
    applySettings,
    populateForm,
    readForm,
    watchSystemTheme,
    sanitizeViewMode,
    sanitizeSortBy
  };
})(window);
