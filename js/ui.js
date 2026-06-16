(function uiModule(global) {
  "use strict";

  const App = global.NotizenApp || (global.NotizenApp = {});
  const MOBILE_LAYOUT_QUERY = "(max-width: 980px), (max-height: 560px) and (hover: none)";
  const elements = {};
  const REQUIRED_ELEMENTS = [
    ["noteList", "noteList"],
    ["noteCount", "noteCount"],
    ["selectionBar", "selectionBar"],
    ["selectionCount", "selectionCount"],
    ["contextMenu", "noteContextMenu"],
    ["emptyState", "emptyState"],
    ["editorGrid", "editorGrid"],
    ["toastStack", "toastStack"],
    ["searchInput", "searchInput"],
    ["sortSelect", "sortSelect"],
    ["sidebarScrim", "sidebarScrim"],
    ["settingsDialog", "settingsDialog"],
    ["settingsForm", "settingsForm"],
    ["fontSizeOutput", "fontSizeOutput"],
    ["confirmDialog", "confirmDialog"],
    ["renameDialog", "renameDialog"],
    ["renameInput", "renameInput"],
    ["exportDialog", "exportDialog"],
    ["exportTitle", "exportTitle"],
    ["exportFormat", "exportFormat"]
  ];
  const SIDEBAR_TRANSITION_MS = 240;
  let tooltipTarget = null;
  let contextMenuHandler = null;
  let sidebarCloseTimer = 0;
  let mobileLayoutQuery = null;

  function init(callbacks = {}) {
    if (!collectElements()) {
      return false;
    }
    elements.contextPinLabel = elements.contextMenu.querySelector("[data-pin-label]");
    if (!elements.contextPinLabel) {
      console.error("Notizen-App: Kontextmenue-Pin-Label fehlt.");
      return false;
    }

    if (elements.settingsForm.elements.fontSize) {
      elements.settingsForm.elements.fontSize.addEventListener("input", () => {
        updateFontSizeOutput(elements.settingsForm.elements.fontSize.value);
      });
    }
    contextMenuHandler = callbacks.onContextAction || null;
    initTooltips();
    initContextMenu();
    initAnimatedDialogs();
    initSidebarLayoutWatcher();
    syncSidebarA11y(false);
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
      console.error(`Notizen-App: UI-Elemente fehlen: ${missing.join(", ")}`);
      return false;
    }
    return true;
  }

  function closestTarget(target, selector) {
    return target && typeof target.closest === "function" ? target.closest(selector) : null;
  }

  function initAnimatedDialogs() {
    document.querySelectorAll(".modal").forEach((dialog) => {
      const form = dialog.querySelector('form[method="dialog"]');
      if (form) {
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          const submitter = event.submitter;
          const defaultButton = form.querySelector('[value="confirm"], [value="default"]');
          const returnValue = submitter ? submitter.value : (defaultButton ? defaultButton.value : "cancel");
          closeDialog(dialog, returnValue);
        });
      }

      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        closeDialog(dialog, "cancel");
      });
    });
  }

  function initContextMenu() {
    elements.contextMenu.addEventListener("click", (event) => {
      const button = closestTarget(event.target, "[data-context-action]");
      if (!button) {
        return;
      }
      const noteId = elements.contextMenu.dataset.noteId || "";
      const action = button.dataset.contextAction;
      closeContextMenu();
      if (contextMenuHandler && noteId && action) {
        contextMenuHandler(action, noteId);
      }
    });

    document.addEventListener("click", (event) => {
      if (!elements.contextMenu.hidden && !elements.contextMenu.contains(event.target)) {
        closeContextMenu();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeContextMenu();
        if (document.body.classList.contains("sidebar-open")) {
          event.preventDefault();
          setSidebarOpen(false);
        }
      }
    });

    document.addEventListener("scroll", closeContextMenu, true);
    global.addEventListener("resize", closeContextMenu);
  }

  function initTooltips() {
    elements.tooltip = document.createElement("div");
    elements.tooltip.className = "app-tooltip";
    elements.tooltip.hidden = true;
    document.body.append(elements.tooltip);

    document.addEventListener("pointerover", (event) => {
      const target = closestTarget(event.target, "[data-tooltip]");
      if (target && target !== tooltipTarget) {
        showTooltip(target);
      }
    });

    document.addEventListener("pointerout", (event) => {
      if (tooltipTarget && !tooltipTarget.contains(event.relatedTarget)) {
        hideTooltip();
      }
    });

    document.addEventListener("focusin", (event) => {
      const target = closestTarget(event.target, "[data-tooltip]");
      if (target) {
        showTooltip(target);
      }
    });

    document.addEventListener("focusout", (event) => {
      if (event.target === tooltipTarget || closestTarget(event.target, "[data-tooltip]") === tooltipTarget) {
        hideTooltip();
      }
    });

    document.addEventListener("click", hideTooltip);
    global.addEventListener("resize", hideTooltip);
    document.addEventListener("scroll", hideTooltip, true);
  }

  function showTooltip(target) {
    const text = target.getAttribute("data-tooltip");
    if (!text || target.disabled) {
      return;
    }

    tooltipTarget = target;
    const modalHost = moveTooltipToHost(target);
    elements.tooltip.textContent = text;
    elements.tooltip.hidden = false;
    elements.tooltip.classList.remove("is-visible", "is-above", "is-below");
    positionTooltip(target, modalHost);
    requestAnimationFrame(() => elements.tooltip.classList.add("is-visible"));
  }

  function moveTooltipToHost(target) {
    const modalHost = target.closest(".modal[open]");
    const host = modalHost || document.body;
    if (elements.tooltip.parentElement !== host) {
      host.append(elements.tooltip);
    }
    elements.tooltip.classList.toggle("is-in-modal", Boolean(modalHost));
    return modalHost;
  }

  function positionTooltip(target, modalHost) {
    const rect = target.getBoundingClientRect();
    const tooltipRect = elements.tooltip.getBoundingClientRect();
    const margin = 12;
    const gap = 16;
    const halfWidth = tooltipRect.width / 2;
    const viewportHeight = global.innerHeight;
    const minLeft = halfWidth + margin;
    const maxLeft = Math.max(minLeft, global.innerWidth - halfWidth - margin);
    let left = Math.min(maxLeft, Math.max(minLeft, rect.left + rect.width / 2));
    const topAbove = rect.top - tooltipRect.height - gap;
    const topBelow = rect.bottom + gap;
    const preferBelow = modalHost || topAbove < margin;
    const canPlaceBelow = topBelow + tooltipRect.height <= viewportHeight - margin;
    const placeBelow = preferBelow && canPlaceBelow;
    let top = placeBelow ? topBelow : Math.max(margin, topAbove);

    if (modalHost) {
      const modalRect = modalHost.getBoundingClientRect();
      left -= modalRect.left;
      top -= modalRect.top;
    }

    elements.tooltip.style.left = `${left}px`;
    elements.tooltip.style.top = `${top}px`;
    elements.tooltip.classList.toggle("is-below", placeBelow);
    elements.tooltip.classList.toggle("is-above", !placeBelow);
  }

  function hideTooltip() {
    tooltipTarget = null;
    if (!elements.tooltip) {
      return;
    }
    elements.tooltip.classList.remove("is-visible");
    window.setTimeout(() => {
      if (!tooltipTarget) {
        elements.tooltip.hidden = true;
        elements.tooltip.classList.remove("is-in-modal", "is-above", "is-below");
        if (elements.tooltip.parentElement !== document.body) {
          document.body.append(elements.tooltip);
        }
      }
    }, 140);
  }

  function updateFontSizeOutput(value) {
    if (!elements.fontSizeOutput) {
      return;
    }
    elements.fontSizeOutput.textContent = `${value} px`;
  }

  function openDialog(dialog) {
    if (!dialog) {
      return;
    }
    dialog.classList.remove("is-open", "is-closing");
    dialog.dataset.closing = "";
    dialog.returnValue = "";
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    requestAnimationFrame(() => dialog.classList.add("is-open"));
  }

  function closeDialog(dialog, returnValue = "cancel") {
    if (!dialog) {
      return;
    }
    if (dialog.dataset.closing === "true" || (!dialog.open && !dialog.hasAttribute("open"))) {
      return;
    }

    hideTooltip();
    dialog.dataset.closing = "true";
    dialog.classList.remove("is-open");
    dialog.classList.add("is-closing");

    window.setTimeout(() => {
      dialog.classList.remove("is-closing");
      delete dialog.dataset.closing;

      if (typeof dialog.close === "function" && dialog.open) {
        dialog.close(returnValue);
      } else {
        dialog.returnValue = returnValue;
        dialog.removeAttribute("open");
        dialog.dispatchEvent(new Event("close"));
      }
    }, 180);
  }

  function countLabel(visibleCount, totalCount) {
    const totalLabel = `${totalCount} ${totalCount === 1 ? "Notiz" : "Notizen"}`;
    if (visibleCount === totalCount) {
      return totalLabel;
    }
    return `${visibleCount} von ${totalLabel}`;
  }

  function renderNoteList(notes, selectedId, totalCount, selectedIds = new Set()) {
    if (!elements.noteList || !elements.noteCount) {
      return;
    }
    elements.noteList.replaceChildren();
    elements.noteCount.textContent = countLabel(notes.length, totalCount);

    if (!notes.length) {
      const empty = document.createElement("div");
      empty.className = "note-card note-empty";
      empty.textContent = totalCount ? "Keine Treffer gefunden." : "Noch keine Notizen vorhanden.";
      elements.noteList.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    notes.forEach((note) => {
      const item = document.createElement("div");
      item.className = "note-card";
      item.setAttribute("role", "listitem");
      item.dataset.noteId = note.id;
      item.classList.toggle("is-selected", note.id === selectedId);
      item.classList.toggle("is-multi-selected", selectedIds.has(note.id));

      const checkboxLabel = document.createElement("label");
      checkboxLabel.className = "note-select";
      checkboxLabel.dataset.tooltip = `${note.title || "Unbenannte Notiz"} auswählen`;
      const checkbox = document.createElement("input");
      checkbox.className = "note-checkbox";
      checkbox.type = "checkbox";
      checkbox.checked = selectedIds.has(note.id);
      checkbox.dataset.noteCheckbox = "true";
      checkbox.setAttribute("aria-label", `${note.title || "Unbenannte Notiz"} auswählen`);
      checkboxLabel.append(checkbox);

      const main = document.createElement("button");
      main.type = "button";
      main.className = "note-card-main";
      main.dataset.noteOpen = "true";
      main.dataset.tooltip = `Notiz öffnen: ${note.title || "Unbenannte Notiz"}`;

      const title = document.createElement("div");
      title.className = "note-card-title";
      if (note.pinned) {
        const pin = document.createElement("span");
        pin.className = "pin-dot";
        pin.setAttribute("aria-label", "Angepinnt");
        title.append(pin);
      }
      const titleText = document.createElement("span");
      titleText.textContent = note.title || "Unbenannte Notiz";
      title.append(titleText);

      const preview = document.createElement("div");
      preview.className = "note-card-preview";
      preview.textContent = App.Notes.preview(note);

      const meta = document.createElement("div");
      meta.className = "note-card-meta";
      const updated = document.createElement("span");
      updated.textContent = `Geändert ${App.Notes.formatRelativeDate(note.updatedAt)}`;
      const created = document.createElement("span");
      created.textContent = `Erstellt ${App.Notes.formatRelativeDate(note.createdAt)}`;
      meta.append(updated, created);

      main.append(title, preview, meta);
      item.append(checkboxLabel, main);
      fragment.append(item);
    });

    elements.noteList.append(fragment);
  }

  function updateSelectionBar(selectedCount) {
    if (!elements.selectionBar || !elements.selectionCount) {
      return;
    }
    elements.selectionBar.hidden = selectedCount === 0;
    elements.selectionCount.textContent = `${selectedCount} ${selectedCount === 1 ? "Notiz" : "Notizen"} ausgewählt`;
  }

  function openNoteContextMenu(note, x, y) {
    if (!note || !elements.contextMenu || !elements.contextPinLabel) {
      return;
    }
    hideTooltip();
    elements.contextMenu.dataset.noteId = note.id;
    elements.contextPinLabel.textContent = note.pinned ? "Pin entfernen" : "Notiz anpinnen";
    elements.contextMenu.hidden = false;

    const menuRect = elements.contextMenu.getBoundingClientRect();
    const margin = 10;
    const left = Math.min(global.innerWidth - menuRect.width - margin, Math.max(margin, x));
    const top = Math.min(global.innerHeight - menuRect.height - margin, Math.max(margin, y));
    elements.contextMenu.style.left = `${left}px`;
    elements.contextMenu.style.top = `${top}px`;

    const firstButton = elements.contextMenu.querySelector("button");
    if (firstButton) {
      firstButton.focus({ preventScroll: true });
    }
  }

  function closeContextMenu() {
    if (elements.contextMenu) {
      elements.contextMenu.hidden = true;
      elements.contextMenu.dataset.noteId = "";
    }
  }

  function setEmptyState(isEmpty) {
    if (elements.emptyState) {
      elements.emptyState.hidden = !isEmpty;
    }
    if (elements.editorGrid) {
      elements.editorGrid.hidden = isEmpty;
    }
  }

  function setSidebarOpen(open) {
    const isOpen = Boolean(open);
    const wasOpen = document.body.classList.contains("sidebar-open");

    clearSidebarCloseTimer();

    if (isOpen && shouldExitFullscreenBeforeOpeningSidebar()) {
      App.Editor.exitFullscreen();
      document.body.classList.remove("fullscreen-sidebar-hidden", "fullscreen-transition");
      const workspace = document.getElementById("workspace");
      if (workspace) {
        workspace.classList.remove("is-fullscreen");
      }
    }

    document.body.classList.remove("sidebar-closing");

    if (isOpen) {
      document.body.classList.add("sidebar-open");
      syncSidebarA11y(true);
      return;
    }

    if (wasOpen && isMobileFullscreenSidebarState()) {
      document.body.classList.add("sidebar-closing");
      sidebarCloseTimer = global.setTimeout(() => {
        document.body.classList.remove("sidebar-closing");
        sidebarCloseTimer = 0;
      }, SIDEBAR_TRANSITION_MS);
    }

    document.body.classList.remove("sidebar-open");
    syncSidebarA11y(false);
  }

  function shouldExitFullscreenBeforeOpeningSidebar() {
    if (!App.Editor || typeof App.Editor.exitFullscreen !== "function") {
      return false;
    }
    if (isMobileFullscreenSidebarState()) {
      return false;
    }
    return true;
  }

  function isMobileFullscreenSidebarState() {
    return isMobileLayout()
      && typeof App.Editor.isFullscreen === "function"
      && App.Editor.isFullscreen();
  }

  function isMobileLayout() {
    const query = getMobileLayoutQuery();
    return Boolean(query && query.matches);
  }

  function getMobileLayoutQuery() {
    if (!global.matchMedia) {
      return null;
    }
    if (!mobileLayoutQuery) {
      mobileLayoutQuery = global.matchMedia(MOBILE_LAYOUT_QUERY);
    }
    return mobileLayoutQuery;
  }

  function initSidebarLayoutWatcher() {
    const query = getMobileLayoutQuery();
    if (!query) {
      return;
    }
    const onLayoutChange = () => {
      if (!query.matches) {
        clearSidebarCloseTimer();
        document.body.classList.remove("sidebar-closing");
      }
      syncSidebarA11y(document.body.classList.contains("sidebar-open"));
    };
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", onLayoutChange);
    } else if (typeof query.addListener === "function") {
      query.addListener(onLayoutChange);
    }
    global.addEventListener("resize", onLayoutChange);
  }

  function clearSidebarCloseTimer() {
    if (!sidebarCloseTimer) {
      return;
    }
    global.clearTimeout(sidebarCloseTimer);
    sidebarCloseTimer = 0;
  }

  function syncSidebarA11y(isOpen) {
    const sidebar = document.getElementById("sidebar");
    if (sidebar) {
      sidebar.setAttribute("aria-hidden", String(!isOpen && isMobileLayout()));
    }
    if (elements.sidebarScrim) {
      elements.sidebarScrim.setAttribute("aria-hidden", String(!isOpen));
      elements.sidebarScrim.tabIndex = isOpen ? 0 : -1;
    }
    const label = isOpen ? "Notizliste schließen" : "Notizliste öffnen";
    document.querySelectorAll("#openSidebarButton, #fullscreenSidebarButton").forEach((button) => {
      button.setAttribute("aria-expanded", String(isOpen));
      button.setAttribute("aria-label", label);
      button.dataset.tooltip = label;
      button.classList.toggle("is-active", isOpen);
    });
  }

  function toggleSidebar() {
    setSidebarOpen(!document.body.classList.contains("sidebar-open"));
  }

  function showToast(message, type = "info") {
    if (!elements.toastStack) {
      console[type === "error" ? "error" : "log"](message);
      return;
    }
    const toast = document.createElement("div");
    toast.className = `toast ${type === "error" ? "error" : ""}`.trim();
    toast.textContent = message;
    elements.toastStack.append(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(8px)";
      setTimeout(() => toast.remove(), 180);
    }, 3600);
  }

  function confirmDanger({ title, message, confirmText = "Löschen" }) {
    const dialog = elements.confirmDialog;
    const titleElement = document.getElementById("confirmTitle");
    const messageElement = document.getElementById("confirmMessage");
    const acceptButton = document.getElementById("confirmAcceptButton");
    if (!dialog || !titleElement || !messageElement || !acceptButton) {
      return Promise.resolve(false);
    }
    titleElement.textContent = title;
    messageElement.textContent = message;
    acceptButton.textContent = confirmText;

    return new Promise((resolve) => {
      const onClose = () => resolve(dialog.returnValue === "confirm");
      dialog.addEventListener("close", onClose, { once: true });
      openDialog(dialog);
    });
  }

  function promptRename(currentTitle) {
    const dialog = elements.renameDialog;
    if (!dialog || !elements.renameInput) {
      return Promise.resolve("");
    }
    elements.renameInput.value = currentTitle || "";

    return new Promise((resolve) => {
      const onClose = () => {
        if (dialog.returnValue === "confirm") {
          resolve(elements.renameInput.value.trim());
        } else {
          resolve("");
        }
      };
      dialog.addEventListener("close", onClose, { once: true });
      openDialog(dialog);
      setTimeout(() => {
        elements.renameInput.focus();
        elements.renameInput.select();
      }, 0);
    });
  }

  function chooseExportFormat(scopeLabel) {
    const dialog = elements.exportDialog;
    if (!dialog || !elements.exportTitle || !elements.exportFormat) {
      return Promise.resolve("");
    }
    elements.exportTitle.textContent = `${scopeLabel} exportieren`;
    elements.exportFormat.value = "json";

    return new Promise((resolve) => {
      const onClose = () => {
        resolve(dialog.returnValue === "confirm" ? elements.exportFormat.value : "");
      };
      dialog.addEventListener("close", onClose, { once: true });
      openDialog(dialog);
    });
  }

  function openSettings(settings) {
    const dialog = elements.settingsDialog;
    if (!dialog || !elements.settingsForm || !elements.settingsForm.elements.fontSize) {
      return Promise.resolve(null);
    }
    App.Settings.populateForm(elements.settingsForm, settings);
    updateFontSizeOutput(elements.settingsForm.elements.fontSize.value);

    return new Promise((resolve) => {
      const onClose = () => {
        if (dialog.returnValue === "default") {
          resolve(App.Settings.readForm(elements.settingsForm, settings));
        } else {
          resolve(null);
        }
      };
      dialog.addEventListener("close", onClose, { once: true });
      openDialog(dialog);
    });
  }

  function setSearchValue(value) {
    if (elements.searchInput) {
      elements.searchInput.value = value || "";
    }
  }

  function setSortValue(value) {
    if (elements.sortSelect) {
      elements.sortSelect.value = App.Settings.sanitizeSortBy(value);
    }
  }

  App.UI = {
    init,
    renderNoteList,
    updateSelectionBar,
    openNoteContextMenu,
    closeContextMenu,
    setEmptyState,
    setSidebarOpen,
    toggleSidebar,
    showToast,
    confirmDanger,
    promptRename,
    chooseExportFormat,
    openSettings,
    setSearchValue,
    setSortValue
  };
})(window);
