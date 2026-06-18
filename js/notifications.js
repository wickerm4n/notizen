(function notificationsModule(global) {
  "use strict";

  const App = global.NotizenApp || (global.NotizenApp = {});
  const TONE_DEDUPE_MS = 1400;
  const APP_DIALOG_ID = "reminderAlertDialog";
  const TITLE_BLINK_MS = 650;
  const DEFAULT_DOCUMENT_TITLE = document.title || "Notizen";
  const TITLE_BLINK_ALERT = "● Erinnerung fällig";
  const TITLE_BLINK_ICON = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#ffd84d"/><path d="M42 25a10 10 0 0 0-20 0c0 12-5 15-5 15h30s-5-3-5-15" fill="none" stroke="#172033" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M28 48h8" fill="none" stroke="#172033" stroke-width="5" stroke-linecap="round"/></svg>'
  )}`;
  let notificationStack = null;
  let lastToneAt = 0;
  let appDialog = null;
  let appDialogElements = null;
  let appDialogQueue = [];
  let activeDialogPayload = null;
  let titleBlinkTimer = 0;
  let titleBlinkBase = "";
  let titleBlinkOn = false;
  let titleBlinkStartedHidden = false;
  let titleBlinkSawHidden = false;
  let faviconLink = null;
  let faviconOriginal = null;
  const titleBlinkTags = new Set();

  function ensureStack() {
    if (notificationStack && document.body.contains(notificationStack)) {
      return notificationStack;
    }
    notificationStack = document.createElement("div");
    notificationStack.className = "reminder-notification-stack";
    notificationStack.setAttribute("aria-live", "polite");
    notificationStack.setAttribute("aria-atomic", "false");
    document.body.append(notificationStack);
    return notificationStack;
  }

  function canUseBrowserNotifications() {
    return "Notification" in global && typeof global.Notification === "function";
  }

  async function requestPermissionIfUseful(options = {}) {
    const enabled = typeof options === "boolean" ? options : options.enabled !== false;
    if (!enabled) {
      return "skipped";
    }
    if (!canUseBrowserNotifications()) {
      return "unavailable";
    }
    if (global.Notification.permission !== "default") {
      return global.Notification.permission;
    }
    try {
      return await global.Notification.requestPermission();
    } catch (error) {
      return "denied";
    }
  }

  function startTabBlink(tag) {
    const cleanTag = String(tag || "reminder");
    titleBlinkTags.add(cleanTag);
    if (titleBlinkTimer) {
      return;
    }

    titleBlinkBase = document.title && document.title !== TITLE_BLINK_ALERT
      ? document.title
      : DEFAULT_DOCUMENT_TITLE;
    titleBlinkOn = false;
    titleBlinkStartedHidden = document.visibilityState === "hidden";
    titleBlinkSawHidden = titleBlinkStartedHidden;
    tickTabBlink();
  }

  function tickTabBlink() {
    titleBlinkOn = !titleBlinkOn;
    document.title = titleBlinkOn ? TITLE_BLINK_ALERT : titleBlinkBase;
    setFaviconBlink(titleBlinkOn);
    titleBlinkTimer = global.setTimeout(tickTabBlink, TITLE_BLINK_MS);
  }

  function ensureFaviconLink() {
    if (faviconLink && document.head.contains(faviconLink)) {
      return faviconLink;
    }

    faviconLink = document.querySelector('link[rel~="icon"]');
    if (!faviconLink) {
      faviconLink = document.createElement("link");
      faviconLink.rel = "icon";
      document.head.append(faviconLink);
    }

    if (!faviconOriginal) {
      faviconOriginal = {
        href: faviconLink.getAttribute("href") || "",
        type: faviconLink.getAttribute("type") || ""
      };
    }
    return faviconLink;
  }

  function setFaviconBlink(active) {
    const link = ensureFaviconLink();
    if (active) {
      link.setAttribute("href", TITLE_BLINK_ICON);
      link.setAttribute("type", "image/svg+xml");
      return;
    }
    restoreFavicon();
  }

  function restoreFavicon() {
    if (!faviconLink || !faviconOriginal) {
      return;
    }
    if (faviconOriginal.href) {
      faviconLink.setAttribute("href", faviconOriginal.href);
    } else {
      faviconLink.removeAttribute("href");
    }
    if (faviconOriginal.type) {
      faviconLink.setAttribute("type", faviconOriginal.type);
    } else {
      faviconLink.removeAttribute("type");
    }
  }

  function stopTabBlink(tag) {
    if (tag) {
      titleBlinkTags.delete(String(tag));
    } else {
      titleBlinkTags.clear();
    }

    if (titleBlinkTags.size || !titleBlinkTimer) {
      return;
    }

    global.clearTimeout(titleBlinkTimer);
    titleBlinkTimer = 0;
    titleBlinkOn = false;
    titleBlinkStartedHidden = false;
    titleBlinkSawHidden = false;
    document.title = titleBlinkBase || DEFAULT_DOCUMENT_TITLE;
    restoreFavicon();
    titleBlinkBase = "";
  }

  function stopPayloadBlink(payload) {
    if (payload && payload.blinkTag) {
      stopTabBlink(payload.blinkTag);
    }
  }

  function createIconButton(label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-button";
    button.setAttribute("aria-label", label);
    button.dataset.tooltip = label;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#icon-close");
    svg.append(use);
    button.append(svg);
    return button;
  }

  function ensureAppDialog() {
    if (appDialog && document.body.contains(appDialog) && appDialogElements) {
      return appDialogElements;
    }

    const dialog = document.createElement("dialog");
    dialog.id = APP_DIALOG_ID;
    dialog.className = "modal reminder-alert-dialog";

    const card = document.createElement("section");
    card.className = "modal-card";
    card.setAttribute("aria-labelledby", "reminderAlertTitle");

    const header = document.createElement("div");
    header.className = "modal-header";
    const headingGroup = document.createElement("div");
    const heading = document.createElement("h2");
    heading.id = "reminderAlertTitle";
    heading.textContent = "Erinnerung";
    const subtitle = document.createElement("p");
    subtitle.className = "modal-subtitle";
    headingGroup.append(heading, subtitle);
    const closeIcon = createIconButton("Schließen");
    header.append(headingGroup, closeIcon);

    const body = document.createElement("div");
    body.className = "reminder-alert-body";
    const meta = document.createElement("p");
    meta.className = "reminder-alert-meta";
    const text = document.createElement("p");
    text.className = "reminder-alert-text";
    const lineList = document.createElement("ul");
    lineList.className = "reminder-alert-lines";
    const warning = document.createElement("p");
    warning.className = "reminder-alert-warning";
    warning.hidden = true;
    body.append(meta, text, lineList, warning);

    const actions = document.createElement("menu");
    actions.className = "modal-actions reminder-alert-actions";
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "button button-ghost";
    closeButton.textContent = "Schließen";
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "button button-primary";
    openButton.textContent = "Notiz öffnen";
    actions.append(closeButton, openButton);

    card.append(header, body, actions);
    dialog.append(card);
    document.body.append(dialog);

    function dismissActive() {
      const payload = activeDialogPayload;
      if (payload) {
        payload.dismissed = true;
        stopPayloadBlink(payload);
        if (typeof payload.onDismiss === "function") {
          payload.onDismiss();
        }
      }
      closeAppDialog("dismiss");
    }

    function openActive() {
      const payload = activeDialogPayload;
      if (payload) {
        payload.opened = true;
        stopPayloadBlink(payload);
        if (typeof payload.onOpen === "function") {
          payload.onOpen();
        }
      }
      closeAppDialog("open");
    }

    closeIcon.addEventListener("click", dismissActive);
    closeButton.addEventListener("click", dismissActive);
    openButton.addEventListener("click", openActive);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      dismissActive();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        dismissActive();
      }
    });
    dialog.addEventListener("close", () => {
      activeDialogPayload = null;
      showNextAppDialog();
    });

    appDialog = dialog;
    appDialogElements = {
      dialog,
      heading,
      subtitle,
      meta,
      text,
      lineList,
      warning,
      openButton
    };
    return appDialogElements;
  }

  function closeAppDialog(returnValue) {
    if (!appDialog) {
      return;
    }
    if (App.UI && typeof App.UI.closeDialog === "function") {
      App.UI.closeDialog(appDialog, returnValue);
    } else if (typeof appDialog.close === "function" && appDialog.open) {
      appDialog.close(returnValue);
    } else {
      appDialog.removeAttribute("open");
      appDialog.dispatchEvent(new Event("close"));
    }
  }

  function openAppDialog(dialog) {
    if (App.UI && typeof App.UI.openDialog === "function") {
      App.UI.openDialog(dialog);
      return;
    }
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    requestAnimationFrame(() => dialog.classList.add("is-open"));
  }

  function renderLineList(list, selectedLines) {
    list.replaceChildren();
    const lines = (Array.isArray(selectedLines) ? selectedLines : [])
      .map((line) => String(line || "").trim())
      .filter(Boolean);
    lines.slice(0, 8).forEach((line) => {
      const item = document.createElement("li");
      item.textContent = line;
      list.append(item);
    });
    list.hidden = !lines.length;
  }

  function renderAppDialog(payload) {
    const elements = ensureAppDialog();
    const title = payload.title || "Erinnerung";
    const noteTitle = payload.noteTitle || "Unbenannte Notiz";
    elements.heading.textContent = title;
    elements.subtitle.textContent = noteTitle;
    elements.meta.textContent = payload.dueAtLabel
      ? `Fällig: ${payload.dueAtLabel}`
      : (payload.status === "missed" ? "Verpasste Erinnerung" : "Jetzt fällig");
    const hintText = String(payload.previewText || "").trim();
    elements.text.textContent = hintText;
    elements.text.hidden = !hintText;
    renderLineList(elements.lineList, payload.selectedLines);
    elements.warning.textContent = payload.warning || "";
    elements.warning.hidden = !payload.warning;
    elements.openButton.disabled = typeof payload.onOpen !== "function";
    return elements.dialog;
  }

  function showNextAppDialog() {
    if (activeDialogPayload || !appDialogQueue.length) {
      return;
    }

    activeDialogPayload = appDialogQueue.shift();
    const dialog = renderAppDialog(activeDialogPayload);
    openAppDialog(dialog);
  }

  function enqueueAppDialog(payload) {
    appDialogQueue.push(payload);
    showNextAppDialog();
  }

  function showFallback({ title, body, status, onClick, blinkTag }) {
    const stack = ensureStack();
    const card = document.createElement("section");
    card.className = "reminder-notification";
    card.tabIndex = 0;

    const content = document.createElement("button");
    content.type = "button";
    content.className = "reminder-notification-main";
    content.addEventListener("click", () => {
      stopTabBlink(blinkTag);
      if (typeof onClick === "function") {
        onClick();
      }
      card.remove();
    });

    const heading = document.createElement("strong");
    heading.textContent = title || "Erinnerung";
    const text = document.createElement("span");
    const bodyText = String(body || "").trim();
    text.textContent = bodyText;
    text.hidden = !bodyText;
    const meta = document.createElement("small");
    meta.textContent = status === "missed" ? "Verpasste Erinnerung" : "Jetzt fällig";
    content.append(heading, text, meta);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "icon-button reminder-notification-close";
    close.setAttribute("aria-label", "Hinweis schließen");
    close.textContent = "x";
    close.addEventListener("click", () => {
      stopTabBlink(blinkTag);
      card.remove();
    });

    card.append(content, close);
    stack.prepend(card);

    global.setTimeout(() => {
      if (document.body.contains(card)) {
        card.classList.add("is-fading");
        global.setTimeout(() => card.remove(), 220);
      }
    }, 22000);
  }

  function showBrowserNotification({ title, body, tag, onClick, onClose }) {
    if (!canUseBrowserNotifications() || global.Notification.permission !== "granted") {
      return false;
    }

    try {
      const notification = new global.Notification(title || "Erinnerung", {
        body: body || "",
        tag: tag || undefined,
        renotify: Boolean(tag),
        silent: true,
        icon: "icons/app-icon.svg"
      });
      notification.onclick = () => {
        try {
          global.focus();
        } catch (error) {
          // Focusing can be blocked; opening the note inside the app still works.
        }
        if (typeof onClick === "function") {
          onClick();
        }
        notification.close();
      };
      notification.onclose = () => {
        if (typeof onClose === "function") {
          onClose();
        }
      };
      return true;
    } catch (error) {
      return false;
    }
  }

  async function notifyReminder(payload) {
    const title = payload && payload.title ? String(payload.title) : "Erinnerung";
    const body = payload && payload.body ? String(payload.body) : "";
    const tag = payload && payload.tag ? String(payload.tag) : `reminder-${Date.now()}`;
    const browserEnabled = payload && payload.browserNotificationEnabled !== false;
    const appDialogEnabled = !payload || payload.appDialogEnabled !== false;
    const browserCloseStopsBlink = !appDialogEnabled;
    const blinkTag = tag;
    const wrappedOpen = () => {
      stopTabBlink(blinkTag);
      if (payload && typeof payload.onClick === "function") {
        payload.onClick();
      }
    };

    if (payload && payload.tabBlinkEnabled) {
      startTabBlink(blinkTag);
    }

    const browserShown = browserEnabled
      ? showBrowserNotification({
        ...payload,
        title,
        body,
        tag,
        onClick: wrappedOpen,
        onClose: () => {
          if (browserCloseStopsBlink) {
            stopTabBlink(blinkTag);
          }
        }
      })
      : false;

    const needsBrowserFallback = browserEnabled && !browserShown;
    const shouldShowAppDialog = appDialogEnabled || needsBrowserFallback;
    const warning = [
      payload && payload.warning ? payload.warning : "",
      needsBrowserFallback ? "Browser-Benachrichtigungen sind nicht erlaubt oder nicht verfügbar. Diese Erinnerung wird als App-Dialog angezeigt." : ""
    ].filter(Boolean).join(" ");

    if (shouldShowAppDialog) {
      enqueueAppDialog({
        ...payload,
        title,
        body,
        tag,
        blinkTag,
        warning,
        onOpen: wrappedOpen
      });
      return;
    }

    if (!browserShown) {
      showFallback({ ...payload, title, body, blinkTag, onClick: wrappedOpen });
    }
  }

  async function playTone(enabled) {
    if (!enabled) {
      return;
    }

    const now = Date.now();
    if (now - lastToneAt < TONE_DEDUPE_MS) {
      return;
    }
    lastToneAt = now;

    const AudioContext = global.AudioContext || global.webkitAudioContext;
    if (!AudioContext) {
      return;
    }

    try {
      const context = new AudioContext();
      if (context.state === "suspended" && typeof context.resume === "function") {
        await context.resume();
      }

      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(660, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(880, context.currentTime + 0.18);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.045, context.currentTime + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.44);
      oscillator.onended = () => {
        if (typeof context.close === "function") {
          context.close().catch(() => {});
        }
      };
    } catch (error) {
      // Browser autoplay policies can reject audio. The reminder should stay quiet and continue.
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && titleBlinkTimer) {
      titleBlinkSawHidden = true;
      return;
    }
    if (document.visibilityState === "visible" && (titleBlinkStartedHidden || titleBlinkSawHidden)) {
      stopTabBlink();
    }
  });
  global.addEventListener("focus", () => {
    if (document.visibilityState === "visible" && (titleBlinkStartedHidden || titleBlinkSawHidden)) {
      stopTabBlink();
    }
  });

  App.Notifications = {
    requestPermissionIfUseful,
    notifyReminder,
    playTone,
    stopTabBlink
  };
})(window);
