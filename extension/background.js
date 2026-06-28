// Configure the side panel to open when the extension icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("Error setting panel behavior:", error));

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
});
