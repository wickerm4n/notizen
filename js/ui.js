(function uiModule(global) {
  "use strict";

  const App = global.NotizenApp || (global.NotizenApp = {});
  const elements = {};
  let tooltipTarget = null;
  let contextMenuHandler = null;

  function init(callbacks = {}) {
    elements.noteList = document.getElementById("noteList");
    elements.noteCount = document.getElementById("noteCount");
    elements.selectionBar = document.getElementById("selectionBar");
    elements.selectionCount = document.getElementById("selectionCount");
    elements.contextMenu = document.getElementById("noteContextMenu");
    elements.contextPinLabel = elements.contextMenu.querySelector("[data-pin-label]");
    elements.emptyState = document.getElementById("emptyState");
    elements.editorGrid = document.getElementById("editorGrid");
    elements.toastStack = document.getElementById("toastStack");
    elements.searchInput = document.getElementById("searchInput");
    elements.sortSelect = document.getElementById("sortSelect");
    elements.sidebarScrim = document.getElementById("sidebarScrim");
    elements.settingsDialog = document.getElementById("settingsDialog");
    elements.settingsForm = document.getElementById("settingsForm");
    elements.fontSizeOutput = document.getElementById("fontSizeOutput");
    elements.confirmDialog = document.getElementById("confirmDialog");
    elements.renameDialog = document.getElementById("renameDialog");
    elements.renameInput = document.getElementById("renameInput");
    elements.exportDialog = document.getElementById("exportDialog");
    elements.exportTitle = document.getElementById("exportTitle");
    elements.exportFormat = document.getElementById("exportFormat");

    elements.settingsForm.elements.fontSize.addEventListener("input", () => {
      updateFontSizeOutput(elements.settingsForm.elements.fontSize.value);
    });
    contextMenuHandler = callbacks.onContextAction || null;
    initTooltips();
    initContextMenu();
    initAnimatedDialogs();
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
      const button = event.target.closest("[data-context-action]");
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
      const target = event.target.closest("[data-tooltip]");
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
      const target = event.target.closest("[data-tooltip]");
      if (target) {
        showTooltip(target);
      }
    });

    document.addEventListener("focusout", (event) => {
      if (event.target === tooltipTarget || event.target.closest("[data-tooltip]") === tooltipTarget) {
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
    elements.fontSizeOutput.textContent = `${value} px`;
  }

  function openDialog(dialog) {
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
    elements.selectionBar.hidden = selectedCount === 0;
    elements.selectionCount.textContent = `${selectedCount} ${selectedCount === 1 ? "Notiz" : "Notizen"} ausgewählt`;
  }

  function openNoteContextMenu(note, x, y) {
    if (!note) {
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
    elements.emptyState.hidden = !isEmpty;
    elements.editorGrid.hidden = isEmpty;
  }

  function setSidebarOpen(open) {
    document.body.classList.toggle("sidebar-open", open);
  }

  function showToast(message, type = "info") {
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
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmMessage").textContent = message;
    document.getElementById("confirmAcceptButton").textContent = confirmText;

    return new Promise((resolve) => {
      const onClose = () => resolve(dialog.returnValue === "confirm");
      dialog.addEventListener("close", onClose, { once: true });
      openDialog(dialog);
    });
  }

  function promptRename(currentTitle) {
    const dialog = elements.renameDialog;
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
    elements.searchInput.value = value || "";
  }

  function setSortValue(value) {
    elements.sortSelect.value = App.Settings.sanitizeSortBy(value);
  }

  App.UI = {
    init,
    renderNoteList,
    updateSelectionBar,
    openNoteContextMenu,
    closeContextMenu,
    setEmptyState,
    setSidebarOpen,
    showToast,
    confirmDanger,
    promptRename,
    chooseExportFormat,
    openSettings,
    setSearchValue,
    setSortValue
  };
})(window);
