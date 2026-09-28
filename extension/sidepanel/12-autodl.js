// sidepanel/12-autodl.js — Auto-Download: SeaArt observer, prompt matching, PNG metadata + chrome.downloads.
// Classic script: shares the global scope with the other sidepanel/*.js
// files, loaded in numeric order by sidepanel.html. Load-time code may only
// use names declared in this file or an earlier one.

// ─────────────────────────────────────────────────────────────────────────────
// Auto-Download: a single persistent MutationObserver in the SeaArt page detects
// every newly-rendered generated image and downloads it with metadata. This is
// the same detection approach as the SeaArt metadata content script (watch the
// DOM for `.c-history-img .media-attachments-img`), so it is instant and works
// for any number of images completing in any order.
// ─────────────────────────────────────────────────────────────────────────────

/** URLs already downloaded this session (dedupe across observer notifications). */
const autoDLDownloaded = new Set();

/**
 * Per-character QUEUED counts THIS SESSION (resets on side panel reload —
 * intentionally not persisted, since the point is "the user is currently
 * churning through many of this character right now", not a lifetime total).
 * Keyed by the folder-name form of the character tag (see
 * characterTagToFolderName on the React side / detectSearchCharacterName).
 *
 * Incremented at ENQUEUE time (see enqueueAndProcess), not at download time —
 * images sit in the generation queue for a while before they finish and get
 * downloaded, so counting only completed downloads meant the first few
 * images of a big batch (e.g. sending 4 of "mona" at once) always missed the
 * subfolder even though the user had clearly already committed to several.
 * Counting at enqueue means "I sent N of this character" decides the folder
 * for ALL N of them, including the ones still generating.
 */
const characterQueuedCounts = new Map();

/** Minimum images of the same character QUEUED this session before their
 *  images start getting filed into a dedicated subfolder. Below this, images
 *  stay directly in the "Booru Prompt Auto Download" root — a couple of test
 *  generations for a character shouldn't spawn a folder for it. */
const CHARACTER_SUBFOLDER_THRESHOLD = 3;

/** Root folder (relative to the browser's Downloads directory) all
 *  Auto-Downloading images are saved under, keeping them out of the flat
 *  Downloads listing. chrome.downloads.download resolves a relative
 *  `filename` against Downloads and creates intermediate folders as needed. */
const AUTODL_ROOT_FOLDER = "Booru Prompt Auto Download";

/**
 * Builds the relative download path (folder(s) + filename) for an
 * auto-downloaded image, always under AUTODL_ROOT_FOLDER. When
 * characterSubfoldersEnabled is on and `character` is known, files it into a
 * AUTODL_ROOT_FOLDER/<character> subfolder once that character's QUEUED count
 * (characterQueuedCounts, incremented at enqueue time) has crossed
 * CHARACTER_SUBFOLDER_THRESHOLD — read-only here, never incremented at
 * download time (see characterQueuedCounts' comment for why).
 */
function buildAutoDLPath(character, baseFilename) {
  if (!characterSubfoldersEnabled || !character) {
    return `${AUTODL_ROOT_FOLDER}/${baseFilename}`;
  }
  const queuedCount = characterQueuedCounts.get(character) || 0;
  if (queuedCount < CHARACTER_SUBFOLDER_THRESHOLD) {
    return `${AUTODL_ROOT_FOLDER}/${baseFilename}`;
  }
  // chrome.downloads.download's `filename` is a path, not a single segment —
  // forward slashes create/reuse subfolders. The character name is already a
  // sanitized folder-name form (see characterTagToFolderName), so no further
  // escaping is needed beyond stripping path-breaking characters defensively.
  const safeCharacter = character.replace(/[\\/:*?"<>|]/g, "").trim();
  return `${AUTODL_ROOT_FOLDER}/${safeCharacter || character}/${baseFilename}`;
}

/**
 * Pool of the REAL prompt text sent to SeaArt for each generation that was
 * successfully injected (pushed right where processNext() confirms injection
 * succeeded — see "sentPromptsQueue.push" below).
 *
 * Why this is a content-matched pool, not a FIFO: completions do not arrive
 * in send order. SeaArt runs several generation slots concurrently, and when the
 * tab is backgrounded the images render in a burst on refocus — so a prompt
 * sent later can finish (and be reported) before an earlier one, and a FIFO
 * would embed the wrong prompt into an image.
 *
 * The page observer already reports, alongside each finished image, the prompt
 * SeaArt shows next to THAT image in its history (`.c-workflow-history-item
 * .c-text-content`). That DOM text is correctly ASSOCIATED with the image but
 * can be truncated/reformatted. So we use it as a matching key: pick the pool
 * entry whose tags best cover the DOM prompt (see matchSentPromptForImage) to
 * recover the exact, complete prompt string while keeping the right pairing.
 *
 * Entries are { prompt, character } objects — `character` is the
 * Auto-Downloading "group by character" folder name detected for the search
 * this prompt was queued from (see queueItem.character / detectSearchCharacterName),
 * or undefined when the queue item had none.
 */
const sentPromptsQueue = [];

/**
 * Splits a prompt into a set of normalized tag tokens for fuzzy comparison.
 * Tolerant of the reformatting SeaArt applies when it echoes a prompt back into
 * its history DOM: strips weight syntax (`:1.2`), brackets, and normalizes
 * underscores/whitespace so "long_hair" and "long hair" match.
 */
function tokenizePrompt(s) {
  const set = new Set();
  if (!s) return set;
  for (const part of String(s).split(",")) {
    const tag = part
      .replace(/[()[\]{}<>]/g, " ") // weight/emphasis brackets
      .replace(/:\s*[\d.]+/g, " ")  // numeric weights like ":1.2"
      .replace(/_/g, " ")           // underscore <-> space normalization
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (tag) set.add(tag);
  }
  return set;
}

/**
 * Similarity in [0..1] between a DOM-scraped prompt (the ground-truth key for
 * an image, possibly truncated) and a candidate sent prompt. Weighted toward
 * COVERAGE — the fraction of the DOM prompt's tags present in the candidate —
 * so a truncated DOM prompt still scores ~1.0 against the full prompt it was
 * cut from. A small Jaccard term breaks ties toward the tightest-sized match.
 */
function promptSimilarity(domPrompt, candidate) {
  const domTokens = tokenizePrompt(domPrompt);
  const candTokens = tokenizePrompt(candidate);
  if (domTokens.size === 0 || candTokens.size === 0) return 0;
  let covered = 0;
  for (const t of domTokens) if (candTokens.has(t)) covered++;
  const coverage = covered / domTokens.size;
  const union = domTokens.size + candTokens.size - covered;
  const jaccard = union > 0 ? covered / union : 0;
  return coverage * 0.8 + jaccard * 0.2;
}

/** Minimum similarity for a DOM prompt to be considered the same generation. */
const PROMPT_MATCH_THRESHOLD = 0.5;

/**
 * Resolves which prompt to embed into a just-completed image, given the prompt
 * SeaArt renders next to it in the DOM (`domPrompt`, correctly associated but
 * maybe truncated). Strategy, best-to-worst:
 *   1. Best content match in the sent pool above the threshold → return its
 *      exact text and REMOVE it from the pool (correct pairing + full text).
 *   2. A DOM prompt exists but nothing matches (e.g. a generation started
 *      outside our queue) → return the DOM prompt itself; leave the pool intact
 *      so a later, matching image can still claim those entries.
 *   3. No DOM prompt at all → fall back to FIFO (oldest sent), the legacy
 *      best-effort behavior.
 * On ties, the earliest (oldest) matching entry wins because the loop keeps the
 * first max — a harmless, order-stable tiebreaker.
 *
 * Returns { prompt, character, jobId, source, score?, index? } — `character`
 * is the Auto-Downloading "group by character" folder name carried alongside
 * the matched sent-pool entry (see sentPromptsQueue below), and `jobId` is
 * the ledger entry to mark `completed` once the download succeeds — both
 * undefined when the matched/fallback entry has none (e.g. a generation that
 * bypassed our queue entirely).
 */
function matchSentPromptForImage(domPrompt) {
  const hasDom = !!(domPrompt && domPrompt.trim());

  if (sentPromptsQueue.length === 0) {
    return { prompt: hasDom ? domPrompt : "", source: hasDom ? "dom-only" : "empty" };
  }

  if (!hasDom) {
    // Nothing to match against — best we can do is the oldest sent prompt.
    const oldest = sentPromptsQueue.shift();
    return { prompt: oldest.prompt, character: oldest.character, jobId: oldest.jobId, source: "fifo-fallback" };
  }

  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < sentPromptsQueue.length; i++) {
    const score = promptSimilarity(domPrompt, sentPromptsQueue[i].prompt);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx >= 0 && bestScore >= PROMPT_MATCH_THRESHOLD) {
    const [matched] = sentPromptsQueue.splice(bestIdx, 1);
    return { prompt: matched.prompt, character: matched.character, jobId: matched.jobId, source: "matched", score: bestScore, index: bestIdx };
  }

  // No confident match: the DOM prompt is still correctly associated with this
  // image, so it beats a wrong FIFO guess. Keep the pool untouched.
  return { prompt: domPrompt, source: "dom-nomatch", score: bestScore };
}

/**
 * Installed into the SeaArt page. Marks all currently-visible generated images
 * as "seen" (so we don't re-download history), then watches for new ones and
 * reports each loaded image back via chrome.runtime.sendMessage. Idempotent.
 */
function installAutoDownloadObserverInPage() {
  const LOG = (...a) => console.log("%c[AutoDL]", "color:#a855f7;font-weight:bold", ...a);

  // ── Idempotency guard ─────────────────────────────────────────────────
  // processNext() calls startAutoDownloadObserver() on every iteration to
  // re-install the observer if the page was reloaded. But if the observer
  // is still alive, re-installing would disconnect it and re-seed all
  // visible images — creating a race window where a just-completed
  // generation's image gets marked as "seen" before the old observer had
  // a chance to report it. Skipping when already active prevents this.
  if (window.__booruAutoDLActive && window.__booruAutoDLObserver) {
    LOG("observer already active — skipping re-install (seen:", window.__booruAutoDLSeen?.size || 0, ")");
    return { status: "already_active", seen: window.__booruAutoDLSeen?.size || 0 };
  }

  // Disconnect any stale observer/interval before (re)installing
  if (window.__booruAutoDLObserver) { try { window.__booruAutoDLObserver.disconnect(); } catch (e) {} }
  if (window.__booruAutoDLInterval) { try { clearInterval(window.__booruAutoDLInterval); } catch (e) {} }
  window.__booruAutoDLObserver = null;
  window.__booruAutoDLInterval = null;

  window.__booruAutoDLActive = true;
  window.__booruAutoDLSeen = window.__booruAutoDLSeen || new Set();

  // Background-tab keep-alive for the SeaArt page itself. The side panel's
  // startBackgroundAudioKeepAlive only protects timers in the side panel
  // document; the setInterval(scan, 1500) below lives in this page, so while
  // the tab is backgrounded Chrome throttles it and images are missed. A
  // silent, near-zero-volume oscillator exempts this tab's timers too.
  if (!window.__booruAutoDLKeepAliveCtx) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 10; // sub-audible (below ~20 Hz)
        gain.gain.value = 0.02;   // low but non-zero energy
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        window.__booruAutoDLKeepAliveCtx = ctx;
        LOG("background-tab keep-alive oscillator started (ctx state:", ctx.state, ")");
        // No user gesture is available inside this injected script, so the
        // context very likely starts "suspended" under autoplay policy —
        // that's fine: a visible generation click on THIS page (the whole
        // reason this observer exists) is itself a user gesture in the page,
        // and browsers commonly resume already-created contexts on the next
        // interaction rather than requiring a fresh one. Retry the resume
        // opportunistically on the next few user interactions.
        if (ctx.state === "suspended") {
          const tryResume = () => { ctx.resume().catch(() => {}); };
          document.addEventListener("pointerdown", tryResume, { once: true, capture: true });
          document.addEventListener("keydown", tryResume, { once: true, capture: true });
        }
      }
    } catch (e) {
      LOG("keep-alive oscillator failed to start:", e);
    }
  }

  // Helper to find elements recursively, including traversing open shadow roots
  const querySelectorAllDeep = (selector, root = document) => {
    const list = [];
    const seen = new Set();
    const find = (node) => {
      if (!node) return;
      if (node.querySelectorAll) {
        const matches = node.querySelectorAll(selector);
        for (const m of matches) {
          if (!seen.has(m)) {
            seen.add(m);
            list.push(m);
          }
        }
      }
      if (node.shadowRoot) find(node.shadowRoot);
      if (node.children) {
        for (const child of node.children) find(child);
      }
    };
    find(root);
    return list;
  };

  const getPrompt = (img) => {
    let node = img;
    while (node) {
      if (node.matches && node.matches(".c-workflow-history-item")) {
        const el = querySelectorAllDeep(".c-text-content", node)[0];
        return el ? el.textContent.trim() : "";
      }
      node = node.parentNode || node.host;
    }
    return "";
  };

  const report = (img) => {
    const src = img.currentSrc || img.src || img.getAttribute("src") || "";
    if (!src || !/^https?:/.test(src) || src.startsWith("data:") || src.startsWith("blob:")) return;
    if (img.naturalWidth <= 1) return; // not a real decoded image yet
    if (window.__booruAutoDLSeen.has(src)) return;
    const prompt = getPrompt(img);
    LOG("new image →", src.slice(0, 80), "| prompt:", prompt.slice(0, 50));
    try {
      chrome.runtime.sendMessage({ type: "AUTODL_NEW_IMAGE", src, prompt });
      window.__booruAutoDLSeen.add(src); // Only mark as seen AFTER successful send
    } catch (e) {
      LOG("send failed — extension context likely invalidated, flagging for re-install", e);
      // Don't add to seen set: image was never reported, so a fresh observer
      // should retry it. Flag inactive so the next processNext() will
      // re-install with a fresh extension context.
      window.__booruAutoDLActive = false;
    }
  };

  const handleImg = (img) => {
    // SeaArt's history images may use native loading="lazy". In a
    // backgrounded tab the browser can skip fetching the bytes entirely
    // (naturalWidth stays 0) until the element scrolls into view. Forcing
    // eager loading removes the dependency on viewport visibility.
    if (img.loading === "lazy") { try { img.loading = "eager"; } catch (_) {} }
    if (img.complete && img.naturalWidth > 1) report(img);
    else img.addEventListener("load", () => report(img), { once: true });
  };

  // Seed: mark every existing generated image as seen so we only grab NEW ones.
  const seedSelector = ".c-history-img .media-attachments-img, .media-attachments-img, .c-workflow-history-item img";
  querySelectorAllDeep(seedSelector).forEach(img => {
    const src = img.currentSrc || img.src || img.getAttribute("src") || "";
    if (src && /^https?:/.test(src)) window.__booruAutoDLSeen.add(src);
  });

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "attributes" && m.target.matches && m.target.matches(".media-attachments-img")) {
        handleImg(m.target);
        continue;
      }
      for (const node of m.addedNodes) {
        if (!node || node.nodeType !== 1) continue;
        if (node.matches && node.matches(".media-attachments-img")) handleImg(node);
        if (node.querySelectorAll) {
          node.querySelectorAll(".c-history-img .media-attachments-img").forEach(handleImg);
        }
      }
    }
  });
  observer.observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["src"]
  });
  window.__booruAutoDLObserver = observer;

  // Primary Shadow DOM polling scanner (run every 1.5s to cover web component history elements)
  const scan = () => {
    const images = querySelectorAllDeep(".media-attachments-img, .c-history-img img, .c-workflow-history-item img");
    images.forEach(handleImg);
  };

  // Diagnostic: detect actual scan cadence drifting far past the requested
  // 1500ms — the direct symptom of Chrome's background-tab timer throttling
  // (1/sec first, then 1/min after ~5min backgrounded) actually landing
  // despite the keep-alive oscillator above. Logged only when materially
  // late (>3x the requested interval) so a healthy run stays quiet.
  let __booruAutoDLLastScanAt = Date.now();
  const scanWithDriftCheck = () => {
    const now = Date.now();
    const drift = now - __booruAutoDLLastScanAt;
    __booruAutoDLLastScanAt = now;
    if (drift > 4500) {
      LOG(`⚠ scan() cadence drifted to ${drift}ms (expected ~1500ms) — likely background-tab timer throttling still landing despite keep-alive. document.hidden=${document.hidden}`);
    }
    scan();
  };

  scan();
  const intervalId = setInterval(scanWithDriftCheck, 1500);
  window.__booruAutoDLInterval = intervalId;

  LOG(`observer installed (seeded ${window.__booruAutoDLSeen.size} existing image(s) + Shadow DOM polling)`);
  return { status: "installed", seen: window.__booruAutoDLSeen.size };
}

/** Removes the observer from the SeaArt page. */
function uninstallAutoDownloadObserverInPage() {
  if (window.__booruAutoDLObserver) { try { window.__booruAutoDLObserver.disconnect(); } catch (e) {} }
  if (window.__booruAutoDLInterval) { try { clearInterval(window.__booruAutoDLInterval); } catch (e) {} }
  if (window.__booruAutoDLKeepAliveCtx) { try { window.__booruAutoDLKeepAliveCtx.close(); } catch (e) {} window.__booruAutoDLKeepAliveCtx = null; }
  window.__booruAutoDLObserver = null;
  window.__booruAutoDLInterval = null;
  window.__booruAutoDLActive = false;
  return { status: "removed" };
}

/** Find the SeaArt tab id in the current window. */
function findSeaArtTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      const t = tabs.find(t => t.url && t.url.includes("seaart.ai"));
      resolve(t || null);
    });
  });
}

/** Start auto-download: install the page observer on the SeaArt tab. */
async function startAutoDownloadObserver() {
  const tab = await findSeaArtTab();
  if (!tab || !tab.id) {
    console.warn("[AutoDL] No SeaArt tab found — observer not installed");
    return;
  }
  currentPlatform = "SeaArt"; // we have a confirmed SeaArt tab
  chrome.scripting.executeScript(
    { target: { tabId: tab.id, allFrames: false }, func: installAutoDownloadObserverInPage },
    (res) => {
      if (chrome.runtime.lastError) { console.warn("[AutoDL] install error:", chrome.runtime.lastError.message); return; }
      dlog("[AutoDL] observer:", res?.[0]?.result);
    }
  );
}

/** Stop auto-download: remove the page observer. */
async function stopAutoDownloadObserver() {
  const tab = await findSeaArtTab();
  if (!tab || !tab.id) return;
  chrome.scripting.executeScript(
    { target: { tabId: tab.id, allFrames: false }, func: uninstallAutoDownloadObserverInPage }
  ).catch(() => {});
}

// Receive new-image notifications from the page observer and download them.
//
// `msg.src` is added to autoDLDownloaded only once the download is confirmed
// complete (see triggerAutoDownload below), so a transient failure (fetch
// 429/timeout, dropped background.js round-trip, interrupted download) can be
// retried. Failed attempts retry with backoff up to AUTODL_MAX_RETRIES, then
// the src is marked as downloaded anyway so a broken URL doesn't retry forever.
const AUTODL_MAX_RETRIES = 3;
const AUTODL_RETRY_BASE_MS = 2000;
/** URLs currently mid-retry, so a duplicate observer notification for the
 *  same src (seed + live-scan overlap) doesn't kick off a second parallel
 *  download attempt for it. */
const autoDLInFlight = new Set();

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "AUTODL_NEW_IMAGE") return;
  if (!autoDownloadEnabled) return;
  // Trust the sender tab: the observer only runs on SeaArt pages.
  const tabId = sender.tab?.id;
  const fromSeaArt = sender.tab?.url?.includes("seaart.ai");
  if (!tabId || !fromSeaArt) return;
  if (!msg.src || autoDLDownloaded.has(msg.src) || autoDLInFlight.has(msg.src)) return;
  autoDLInFlight.add(msg.src);

  // Pair this finished image with the prompt SeaArt actually generated it from.
  // msg.prompt is the text SeaArt renders next to THIS image in its history —
  // correctly associated but sometimes truncated/reformatted. We use it as a
  // key to recover the exact, complete prompt from the sent pool by content
  // (matchSentPromptForImage), instead of blindly taking the oldest sent one.
  // This is what fixes "crossed prompts" when images finish out of send order
  // (concurrent SeaArt slots, or a burst of renders when the tab regains focus).
  const match = matchSentPromptForImage(msg.prompt);
  const promptToEmbed = match.prompt || "";
  console.log(`[AutoDL] new image detected: ${msg.src.slice(0, 80)} | jobId=${match.jobId || "none"} | prompt source=${match.source}${match.score !== undefined ? ` (score=${match.score.toFixed(2)})` : ""} | pool left=${sentPromptsQueue.length}`);

  (async () => {
    let lastError = null;
    for (let attempt = 1; attempt <= AUTODL_MAX_RETRIES; attempt++) {
      const result = await triggerAutoDownload(tabId, msg.src, promptToEmbed, match.character, match.jobId);
      if (result.success) {
        autoDLDownloaded.add(msg.src);
        autoDLInFlight.delete(msg.src);
        if (match.jobId) ledgerTransition(match.jobId, JOB_STATE.COMPLETED, { downloadId: result.downloadId, attempt });
        console.log(`[AutoDL] ✓ Download confirmed jobId=${match.jobId || "none"} downloadId=${result.downloadId} attempt=${attempt}`);
        updateQueueUI();
        return;
      }
      lastError = result.error;
      console.warn(`[AutoDL] Download attempt ${attempt}/${AUTODL_MAX_RETRIES} failed for ${msg.src.slice(0, 80)}: ${lastError}`);
      if (attempt < AUTODL_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, AUTODL_RETRY_BASE_MS * attempt));
      }
    }
    // Exhausted retries — give up on this image but don't retry forever on a
    // permanently broken URL. Recorded in the ledger as a real failure so the
    // batch report reflects it instead of the item just vanishing.
    console.error(`[AutoDL] Giving up on ${msg.src.slice(0, 80)} after ${AUTODL_MAX_RETRIES} attempts: ${lastError}`);
    autoDLDownloaded.add(msg.src);
    autoDLInFlight.delete(msg.src);
    if (match.jobId) ledgerTransition(match.jobId, JOB_STATE.FAILED, { reason: "download_failed", error: lastError });
    updateQueueUI();
  })();
});


// ─────────────────────────────────────────────────────────────────────────────
// Auto-Download step 3: embed PNG tEXt metadata + save via chrome.downloads.
//
// This runs in the SIDE PANEL document. It is deliberately not in either of the
// two places it has lived before:
//
//   1. Injected into the SeaArt page (chrome.scripting.executeScript). That made
//      the PAGE's own <a download> element click a Blob URL minted by the
//      extension — a cross-principal hand-off Chrome tolerates but Firefox's
//      stricter principal model does not reliably allow.
//
//   2. background.js. Chrome's MV3 background is a Service Worker, and
//      URL.createObjectURL() is NOT exposed there (the File API spec exposes it
//      to Window/DedicatedWorker/SharedWorker only). Calling it threw
//      "URL.createObjectURL is not a function", which the handler's try/catch
//      swallowed into { success: false } — so auto-download silently stopped
//      saving anything while looking healthy.
//
// The side panel is a real extension page in BOTH browsers: it has a DOM, it has
// URL.createObjectURL, and chrome.downloads is available to it. One
// implementation, no cross-principal Blob hand-off, no per-browser branch.
// ─────────────────────────────────────────────────────────────────────────────

function autoDLCrc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** Builds a PNG tEXt chunk (length + "tEXt" + keyword\0text + CRC32). */
function autoDLCreateTextChunk(keyword, text) {
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
  const crc = autoDLCrc32(chunk.subarray(4, o));
  chunk[o++] = (crc >> 24) & 0xFF; chunk[o++] = (crc >> 16) & 0xFF;
  chunk[o++] = (crc >> 8) & 0xFF;  chunk[o++] = crc & 0xFF;
  return chunk;
}

/** Splices generation_data + prompt tEXt chunks in right after IHDR. */
function autoDLInjectPngChunks(bytes, generationData, workflow) {
  const IHDR_END = 33; // 8-byte signature + 4+4+13+4 IHDR
  const chunks = [
    autoDLCreateTextChunk("generation_data", JSON.stringify(generationData)),
    autoDLCreateTextChunk("prompt", JSON.stringify(workflow))
  ];
  const extra = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(bytes.length + extra);
  result.set(bytes.subarray(0, IHDR_END), 0);
  let offset = IHDR_END;
  for (const c of chunks) { result.set(c, offset); offset += c.length; }
  result.set(bytes.subarray(IHDR_END), offset);
  return result;
}

/** base64 → Blob, without round-tripping through a data: URL. */
function autoDLBase64ToBlob(b64, mimeType) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
}

/** Blob → Uint8Array. */
async function autoDLBlobToBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Waits for a chrome.downloads item to leave the "in_progress" state.
 * chrome.downloads.download()'s callback only confirms the download was
 * ACCEPTED — not that the bytes actually landed on disk. A download can still
 * end up `state: "interrupted"` (disk full, blocked by AV, revoked Blob URL
 * race, etc.), which must not count as a successful save.
 * Resolves { success, state, error? }. Falls back to a bounded timeout so a
 * download that never fires onChanged (observed occasionally in MV3) doesn't
 * hang the caller forever — in that case we trust the initial "download was
 * accepted" signal rather than blocking the whole batch on one item.
 */
function autoDLWaitForDownloadSettled(downloadId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { chrome.downloads.onChanged.removeListener(listener); } catch (_) {}
      clearTimeout(timer);
      resolve(result);
    };
    const listener = (delta) => {
      if (delta.id !== downloadId || !delta.state) return;
      const state = delta.state.current;
      if (state === "complete") finish({ success: true, state });
      else if (state === "interrupted") finish({ success: false, state, error: "download_interrupted" });
      // "in_progress" — keep waiting
    };
    chrome.downloads.onChanged.addListener(listener);
    // Race: also poll once immediately in case the download already settled
    // before the listener was attached (fast local saves).
    try {
      chrome.downloads.search({ id: downloadId }, (items) => {
        const item = items && items[0];
        if (item && item.state === "complete") finish({ success: true, state: "complete" });
        else if (item && item.state === "interrupted") finish({ success: false, state: "interrupted", error: "download_interrupted" });
      });
    } catch (_) { /* ignore — onChanged listener still covers it */ }
    const timer = setTimeout(() => finish({ success: true, state: "unknown_timeout" }), timeoutMs);
  });
}

/**
 * Re-encodes the fetched image as PNG, splices the metadata chunks in, and
 * saves it via chrome.downloads. Resolves { success, downloadId? , error? }.
 */
async function autoDLSavePngWithMetadata({ base64, mimeType, prompt, filename }) {
  const promptText = prompt || "";

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

  // Normalize to PNG (SeaArt serves some images as JPEG/WebP, and tEXt chunks
  // only exist in PNG). createImageBitmap + OffscreenCanvas is supported in
  // both Chrome and Firefox document contexts, and unlike <img>.src it needs
  // no img-src CSP allowance and no load-event plumbing.
  const bitmap = await createImageBitmap(autoDLBase64ToBlob(base64, mimeType));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close();
  const pngBytes = await autoDLBlobToBytes(await canvas.convertToBlob({ type: "image/png" }));

  const finalBlob = new Blob(
    [autoDLInjectPngChunks(pngBytes, generationData, workflow)],
    { type: "image/png" }
  );

  // Minted and consumed entirely within the side panel's own principal — the
  // page is never involved, so there is no cross-principal Blob URL.
  const blobUrl = URL.createObjectURL(finalBlob);
  try {
    const downloadResult = await new Promise((resolve) => {
      chrome.downloads.download(
        { url: blobUrl, filename, saveAs: false, conflictAction: "uniquify" },
        (downloadId) => {
          if (chrome.runtime.lastError || downloadId === undefined) {
            resolve({ success: false, error: chrome.runtime.lastError?.message || "download failed" });
          } else {
            resolve({ success: true, downloadId });
          }
        }
      );
    });
    if (!downloadResult.success) return downloadResult;

    // A downloadId alone only means "accepted", not "saved to disk".
    const settleResult = await autoDLWaitForDownloadSettled(downloadResult.downloadId);
    if (!settleResult.success) {
      return { success: false, downloadId: downloadResult.downloadId, error: settleResult.error || "download_interrupted" };
    }
    return { success: true, downloadId: downloadResult.downloadId };
  } finally {
    // chrome.downloads copies the bytes as it starts, but revoking immediately
    // can race the download's own fetch of the URL — hold it briefly.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  }
}

/**
 * Downloads a completed SeaArt image with embedded PNG metadata (generation
 * params + a minimal ComfyUI workflow carrying the prompt), reusing the same
 * chunk-injection logic as the separate "SeaArt metadata" extension's
 * content.js. Fetches the image via background.js (bypasses CORS), then embeds
 * the metadata and saves it from this side panel document — see the block
 * comment above autoDLCrc32 for why step 3 lives here rather than in the page
 * or in background.js.
 * `tabId` is accepted for API-shape parity with the caller/onMessage listener
 * but is unused, since step 3 doesn't inject into the tab.
 * `character` (optional) is the Auto-Downloading "group by character" folder
 * name recovered alongside the matched prompt (see buildAutoDLPath).
 * `jobId` (optional) is the ledger entry this download corresponds to.
 *
 * Deliberately does not check the global `currentPlatform`: it is reassigned on
 * every processNext() iteration, so it may point at a non-SeaArt tab while
 * downloads are in flight. The caller already confirmed `sender.tab.url` is a
 * SeaArt tab. Returns { success, downloadId?, error? } so callers can retry.
 */
async function triggerAutoDownload(tabId, imageUrl, prompt, character, jobId) { // eslint-disable-line no-unused-vars
  if (!autoDownloadEnabled) return { success: false, error: "auto_download_disabled" };

  // Step 1: Get full-res URL via background (background.js already handles this)
  let downloadUrl = imageUrl;
  try {
    const urlResponse = await chrome.runtime.sendMessage({
      action: "getFullResUrl",
      imageUrl
    });
    if (urlResponse?.success && urlResponse.url) downloadUrl = urlResponse.url;
  } catch (e) {
    console.warn("[AutoDL] Could not get full-res URL, using original:", e);
  }

  // Step 2: Fetch image bytes via background (bypasses CORS)
  let imageBase64, mimeType;
  try {
    const fetchResponse = await chrome.runtime.sendMessage({
      action: "fetchImage",
      imageUrl: downloadUrl
    });
    if (!fetchResponse?.success) throw new Error(fetchResponse?.error || "fetch failed");
    imageBase64 = fetchResponse.base64;
    mimeType = fetchResponse.mimeType || "";
  } catch (e) {
    console.error("[AutoDL] Failed to fetch image:", e);
    return { success: false, error: `fetch_failed: ${e.message || e}` };
  }

  // Step 3: Embed PNG metadata + save, right here in the side panel document.
  // Not injected into the SeaArt tab (cross-principal Blob URL hand-off that
  // Firefox rejects) and not delegated to background.js (Chrome's MV3 service
  // worker has no URL.createObjectURL) — see the block comment above
  // autoDLCrc32 for the full rationale.
  const now = new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
  const slug = (prompt || "").toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 10);
  const relativePath = buildAutoDLPath(character, `SA-${ts}-${slug}.png`);
  try {
    const saveResponse = await autoDLSavePngWithMetadata({
      base64: imageBase64,
      mimeType,
      prompt: prompt || "",
      filename: relativePath,
    });
    if (!saveResponse?.success) {
      console.error("[AutoDL] Download failed:", saveResponse?.error);
      return { success: false, error: saveResponse?.error || "save_failed" };
    }
    dlog(`[AutoDL] saved (downloadId=${saveResponse.downloadId})`);
    return { success: true, downloadId: saveResponse.downloadId };
  } catch (e) {
    console.error("[AutoDL] Failed to embed metadata / save image:", e);
    return { success: false, error: `embed_failed: ${e.message || e}` };
  }
}
