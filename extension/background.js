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

  // ── Auto-Download step 3: embed PNG metadata + save via chrome.downloads ──
  // Runs entirely in the background script instead of being injected into the
  // web page via chrome.scripting.executeScript. The old approach built a
  // Blob from a content-script sandbox and clicked a page-owned <a download>
  // element to trigger the save — that Blob URL crosses from the extension's
  // principal into the page's document, which Chrome tolerates but Firefox's
  // stricter principal model does not reliably allow. chrome.downloads.download
  // (Firefox: browser.downloads, aliased here via the chrome.* compat shim) is
  // the correct cross-browser API for "save this file", has no page-injection
  // step at all, and is a strict simplification besides.
  if (message.action === "downloadPngWithMetadata") {
    (async () => {
      try {
        const { base64, mimeType, prompt, filename } = message;

        function crc32(data) {
          let crc = 0xFFFFFFFF;
          for (let i = 0; i < data.length; i++) {
            crc ^= data[i];
            for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
          }
          return (crc ^ 0xFFFFFFFF) >>> 0;
        }

        function createTextChunk(keyword, text) {
          const kBytes = new TextEncoder().encode(keyword);
          const tBytes = new TextEncoder().encode(text);
          const dataLen = kBytes.length + 1 + tBytes.length;
          const chunk = new Uint8Array(4 + 4 + dataLen + 4);
          let o = 0;
          chunk[o++] = (dataLen >> 24) & 0xFF; chunk[o++] = (dataLen >> 16) & 0xFF;
          chunk[o++] = (dataLen >> 8) & 0xFF;  chunk[o++] = dataLen & 0xFF;
          chunk[o++] = 0x74; chunk[o++] = 0x45; chunk[o++] = 0x58; chunk[o++] = 0x74; // tEXt
          chunk.set(kBytes, o); o += kBytes.length;
          chunk[o++] = 0;
          chunk.set(tBytes, o); o += tBytes.length;
          const crc = crc32(chunk.subarray(4, o));
          chunk[o++] = (crc >> 24) & 0xFF; chunk[o++] = (crc >> 16) & 0xFF;
          chunk[o++] = (crc >> 8) & 0xFF;  chunk[o++] = crc & 0xFF;
          return chunk;
        }

        function injectPngChunks(b64, generationData, workflow) {
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

          const IHDR_END = 33; // 8-byte sig + 4+4+13+4 IHDR
          const chunks = [
            createTextChunk("generation_data", JSON.stringify(generationData)),
            createTextChunk("prompt", JSON.stringify(workflow))
          ];
          const extra = chunks.reduce((s, c) => s + c.length, 0);
          const result = new Uint8Array(bytes.length + extra);
          result.set(bytes.subarray(0, IHDR_END), 0);
          let offset = IHDR_END;
          for (const c of chunks) { result.set(c, offset); offset += c.length; }
          result.set(bytes.subarray(IHDR_END), offset);

          const CHUNK = 0x8000;
          let out = "";
          for (let i = 0; i < result.length; i += CHUNK)
            out += String.fromCharCode.apply(null, result.subarray(i, i + CHUNK));
          return btoa(out);
        }

        async function blobToBase64(blob) {
          return new Promise((res, rej) => {
            const r = new FileReader();
            r.onloadend = () => res(r.result.split(",")[1]);
            r.onerror = rej;
            r.readAsDataURL(blob);
          });
        }

        const promptText = prompt || "";

        // Build generation_data metadata
        const generationData = {
          prompt: promptText, negativePrompt: "",
          width: 1024, height: 1024, imageCount: 1,
          samplerName: "Euler a", steps: 30, cfgScale: 4, seed: "-1",
          clipSkip: 2, sdVae: "Automatic", etaNoiseSeedDelta: 31337
        };

        // Minimal ComfyUI workflow carrying the prompt
        const workflow = {
          "10051": { class_type: "CLIPTextEncode", inputs: { text: promptText } }
        };

        // Convert base64 to PNG via canvas (handles both PNG and JPEG input).
        // Chrome's MV3 background is a Service Worker with NO DOM (no
        // document.createElement("canvas")); Firefox's MV3 background is a
        // real (non-persistent) page and does have DOM access. OffscreenCanvas
        // + createImageBitmap is the one API both environments support —
        // Chrome service workers, Firefox background pages, and regular
        // windows alike — so this stays portable instead of needing a
        // per-browser branch.
        const dataUrl = "data:" + mimeType + ";base64," + base64;
        const sourceBlob = await (await fetch(dataUrl)).blob();
        const bitmap = await createImageBitmap(sourceBlob);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
        const pngBlob = await canvas.convertToBlob({ type: "image/png" });
        const pngB64 = await blobToBase64(pngBlob);

        const finalB64 = injectPngChunks(pngB64, generationData, workflow);

        // Rebuild final Blob + object URL entirely within the extension's own
        // principal (background script), then hand it to chrome.downloads —
        // no <a>/click() on any page document, no cross-principal Blob URL.
        const byteChars = atob(finalB64);
        const byteArrays = [];
        for (let i = 0; i < byteChars.length; i += 512) {
          const sl = byteChars.slice(i, i + 512);
          byteArrays.push(new Uint8Array([...sl].map(c => c.charCodeAt(0))));
        }
        const finalBlob = new Blob(byteArrays, { type: "image/png" });
        const finalBlobUrl = URL.createObjectURL(finalBlob);

        chrome.downloads.download(
          { url: finalBlobUrl, filename, saveAs: false, conflictAction: "uniquify" },
          (downloadId) => {
            // Blob URLs created in a background/event page stay valid for the
            // lifetime of that page, so it's safe to revoke shortly after the
            // download API has consumed it (it copies the bytes immediately).
            setTimeout(() => URL.revokeObjectURL(finalBlobUrl), 30000);
            if (chrome.runtime.lastError || downloadId === undefined) {
              sendResponse({ success: false, error: chrome.runtime.lastError?.message || "download failed" });
            } else {
              sendResponse({ success: true, downloadId });
            }
          }
        );
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
});
