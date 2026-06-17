(function notificationsModule(global) {
  "use strict";

  const App = global.NotizenApp || (global.NotizenApp = {});
  const TONE_DEDUPE_MS = 1400;
  let notificationStack = null;
  let lastToneAt = 0;

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

  async function requestPermissionIfUseful() {
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

  function showFallback({ title, body, status, onClick }) {
    const stack = ensureStack();
    const card = document.createElement("section");
    card.className = "reminder-notification";
    card.tabIndex = 0;

    const content = document.createElement("button");
    content.type = "button";
    content.className = "reminder-notification-main";
    content.addEventListener("click", () => {
      if (typeof onClick === "function") {
        onClick();
      }
      card.remove();
    });

    const heading = document.createElement("strong");
    heading.textContent = title || "Erinnerung";
    const text = document.createElement("span");
    text.textContent = body || "Eine Erinnerung ist fällig.";
    const meta = document.createElement("small");
    meta.textContent = status === "missed" ? "Verpasste Erinnerung" : "Jetzt fällig";
    content.append(heading, text, meta);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "icon-button reminder-notification-close";
    close.setAttribute("aria-label", "Hinweis schließen");
    close.textContent = "x";
    close.addEventListener("click", () => card.remove());

    card.append(content, close);
    stack.prepend(card);

    global.setTimeout(() => {
      if (document.body.contains(card)) {
        card.classList.add("is-fading");
        global.setTimeout(() => card.remove(), 220);
      }
    }, 22000);
  }

  function showBrowserNotification({ title, body, tag, onClick }) {
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
      return true;
    } catch (error) {
      return false;
    }
  }

  async function notifyReminder(payload) {
    const title = payload && payload.title ? String(payload.title) : "Erinnerung";
    const body = payload && payload.body ? String(payload.body) : "";
    const shown = showBrowserNotification({ ...payload, title, body });
    if (!shown) {
      showFallback({ ...payload, title, body });
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

  App.Notifications = {
    requestPermissionIfUseful,
    notifyReminder,
    playTone
  };
})(window);
