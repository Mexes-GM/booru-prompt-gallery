// sidepanel/15-main.js — Startup. Runs last: picks the iframe host only once every handler above exists.
// Classic script: shares the global scope with the other sidepanel/*.js
// files, loaded in numeric order by sidepanel.html. Load-time code may only
// use names declared in this file or an earlier one.

// ─────────────────────────────────────────────────────────────────────────────
// Environment selection (dev switcher or production host)
// ─────────────────────────────────────────────────────────────────────────────
if (DEV_MODE) {
  // Reveal the environment switcher and restore the last-used environment.
  if (configBar) configBar.hidden = false;
  setEnvironment(localStorage.getItem(LOCAL_STORAGE_KEY) || DEV_URL);

  btnLocal?.addEventListener("click", () => {
    const url = btnLocal.getAttribute("data-url");
    localStorage.setItem(LOCAL_STORAGE_KEY, url);
    setEnvironment(url);
  });

  btnProd?.addEventListener("click", () => {
    const url = btnProd.getAttribute("data-url");
    localStorage.setItem(LOCAL_STORAGE_KEY, url);
    setEnvironment(url);
  });
} else {
  // End users always load production (primary, or the fallback host for a
  // while after a failover).
  setEnvironment(pickProdUrl());
}

// ─────────────────────────────────────────────────────────────────────────────
// Startup: Restore queue + site profiles from storage and initialize UI
// ─────────────────────────────────────────────────────────────────────────────
loadSiteProfiles();
startLedgerWatchdog();

restoreLedger().then(() => restoreQueue()).then(() => {
  updateQueueUI();
  // If there are restored prompts, kick off processing
  if (promptQueue.length > 0) {
    dlog(`[Queue] Starting processing for ${promptQueue.length} restored prompts.`);
    processNext();
  }
});
