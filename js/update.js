(function updateModule(global) {
  "use strict";

  const App = global.NotizenApp || (global.NotizenApp = {});
  const currentScript = document.currentScript;
  const CURRENT_VERSION = normalizeVersion(currentScript ? currentScript.dataset.appVersion : "");
  const VERSION_ENDPOINT = "version.json";
  const INITIAL_CHECK_DELAY_MS = 15000;
  const CHECK_INTERVAL_MS = 5 * 60 * 1000;
  const RELOAD_GUARD_MS = 30000;
  const PENDING_VERSION_KEY = "notizenApp.pendingUpdateVersion";
  const PENDING_RELOAD_AT_KEY = "notizenApp.pendingUpdateReloadAt";

  let checkTimer = 0;
  let checkInFlight = false;
  let reloadStarted = false;

  function normalizeVersion(value) {
    return String(value || "").trim();
  }

  function sessionGet(key) {
    try {
      return global.sessionStorage.getItem(key) || "";
    } catch (error) {
      return "";
    }
  }

  function sessionSet(key, value) {
    try {
      global.sessionStorage.setItem(key, value);
    } catch (error) {
      // Storage can be unavailable in strict privacy modes. The update still works without this guard.
    }
  }

  function sessionRemove(key) {
    try {
      global.sessionStorage.removeItem(key);
    } catch (error) {
      // Nothing to clean up when sessionStorage is unavailable.
    }
  }

  function buildVersionUrl() {
    const url = new URL(VERSION_ENDPOINT, global.location.href);
    url.searchParams.set("_", `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
    return url.href;
  }

  async function fetchLatestVersion() {
    const response = await fetch(buildVersionUrl(), {
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      return "";
    }

    const data = await response.json();
    return data && typeof data.version === "string" ? normalizeVersion(data.version) : "";
  }

  function clearMatchedPendingVersion(version) {
    if (sessionGet(PENDING_VERSION_KEY) === version) {
      sessionRemove(PENDING_VERSION_KEY);
      sessionRemove(PENDING_RELOAD_AT_KEY);
    }
  }

  function recentlyReloadedFor(version) {
    if (sessionGet(PENDING_VERSION_KEY) !== version) {
      return false;
    }

    const timestamp = Number(sessionGet(PENDING_RELOAD_AT_KEY));
    return Number.isFinite(timestamp) && Date.now() - timestamp < RELOAD_GUARD_MS;
  }

  async function prepareAppForReload() {
    if (App && typeof App.prepareForSilentUpdate === "function") {
      await App.prepareForSilentUpdate();
    }
  }

  async function warmEntryDocument() {
    try {
      await fetch(global.location.href, {
        cache: "reload",
        credentials: "same-origin",
        headers: {
          "Accept": "text/html"
        }
      });
    } catch (error) {
      // A failed prefetch should not block the update attempt; reload can still revalidate normally.
    }
  }

  async function reloadSilentlyFor(version) {
    if (reloadStarted) {
      return;
    }

    reloadStarted = true;
    sessionSet(PENDING_VERSION_KEY, version);
    sessionSet(PENDING_RELOAD_AT_KEY, String(Date.now()));

    try {
      await prepareAppForReload();
      await warmEntryDocument();
      global.location.reload();
    } catch (error) {
      reloadStarted = false;
      scheduleNextCheck(CHECK_INTERVAL_MS);
    }
  }

  async function checkForUpdate() {
    if (checkInFlight || reloadStarted || !CURRENT_VERSION) {
      return;
    }

    checkInFlight = true;
    try {
      const latestVersion = await fetchLatestVersion();
      if (!latestVersion) {
        return;
      }

      if (latestVersion === CURRENT_VERSION) {
        clearMatchedPendingVersion(latestVersion);
        return;
      }

      if (recentlyReloadedFor(latestVersion)) {
        return;
      }

      await reloadSilentlyFor(latestVersion);
    } catch (error) {
      // Update checks are best-effort and intentionally silent.
    } finally {
      checkInFlight = false;
      if (!reloadStarted) {
        scheduleNextCheck(CHECK_INTERVAL_MS);
      }
    }
  }

  function scheduleNextCheck(delay) {
    global.clearTimeout(checkTimer);
    checkTimer = global.setTimeout(checkForUpdate, delay);
  }

  function checkSoonWhenVisible() {
    if (document.visibilityState === "visible") {
      scheduleNextCheck(500);
    }
  }

  document.addEventListener("visibilitychange", checkSoonWhenVisible);
  global.addEventListener("online", () => scheduleNextCheck(500));
  scheduleNextCheck(INITIAL_CHECK_DELAY_MS);

  App.Updates = {
    checkForUpdate
  };
})(window);
