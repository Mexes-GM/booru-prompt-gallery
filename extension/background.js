// Configure the side panel to open when the extension icon is clicked (Chrome).
// manifest.json's `permissions` array lists "sidePanel" for this to work — that
// permission name is Chrome/Chromium-specific. Firefox doesn't recognize it and
// logs a manifest warning on load ("Reading manifest: Unrecognized permission
// 'sidePanel'"), but does NOT refuse to load the extension over it; Firefox's
// equivalent surface is `sidebar_action` (declared separately below in the
// manifest and driven by the browser.sidebarAction branch right after this
// block). Kept as a single shared manifest rather than splitting into two
// per-browser manifests + a build step for one warning line.
if (typeof chrome !== "undefined" && chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("Error setting panel behavior:", error));
}

// In Firefox, open sidebar when action button is clicked
if (typeof browser !== "undefined" && browser.sidebarAction && browser.sidebarAction.open) {
  (browser.action || chrome.action).onClicked.addListener(() => {
    browser.sidebarAction.open();
  });
}

// ── Auto-Download: fetch image bytes for metadata embedding ──────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "fetchImage") {
    fetch(message.imageUrl, { credentials: "include" })
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        sendResponse({ success: true, base64, mimeType: blob.type });
      })
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.action === "getFullResUrl") {
    fetch("https://www.seaart.ai/api/v1/resource/download", {
      method: "POST",
      headers: {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json",
        "x-app-id": "web_global_seaart",
        "x-platform": "web",
        "x-project-id": "seaart"
      },
      credentials: "include",
      body: JSON.stringify({ url: message.imageUrl })
    })
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        sendResponse({ success: true, url: data.data?.url || data.data || message.imageUrl });
      })
      .catch(e => sendResponse({ success: false, error: e.message, url: message.imageUrl }));
    return true;
  }

  // NOTE: Auto-Download step 3 (embed PNG tEXt metadata + chrome.downloads.download)
  // deliberately does NOT live here. Chrome's MV3 background is a Service Worker
  // and URL.createObjectURL() is not exposed in that scope, so minting the Blob
  // URL for the download threw "URL.createObjectURL is not a function" and the
  // whole step failed silently. It now runs in the side panel document, which is
  // a real extension page in both Chrome and Firefox — see
  // sidepanel.js's autoDLSavePngWithMetadata.
});
