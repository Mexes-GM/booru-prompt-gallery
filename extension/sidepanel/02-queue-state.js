// sidepanel/02-queue-state.js — Queue state, persistence (chrome.storage.local) and clearQueue.
// Classic script: shares the global scope with the other sidepanel/*.js
// files, loaded in numeric order by sidepanel.html. Load-time code may only
// use names declared in this file or an earlier one.

// ─────────────────────────────────────────────────────────────────────────────
// Queue State
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Each item is `{ prompt: string, width?: number, height?: number }`.
 * `width`/`height`, when present, come from the "Match image resolution"
 * feature (React side computes them from the source post's aspect ratio) and
 * are applied to the site's configured width/height fields right before
 * Generate is clicked — see injectPromptToTab's size-setting step.
 * @type {{ prompt: string, width?: number, height?: number }[]}
 */
const promptQueue = [];
let isProcessing = false;
let isWaitingForSlot = false; // True when paused due to SeaArt task limit
let isPausedForVisibility = false; // True when target tab is hidden
let isPausedManually = false; // True when the user explicitly paused via the queue pill's pause button
let currentActiveTasks = 0;   // Last known active task count
let seaArtLimit = 5;          // Default to 5 (Standard plan). Auto-updated if upgrade modal reveals a different number.
let currentPlatform = "Unknown";
let autoDownloadEnabled = false; // Auto-download images with metadata when generation completes (SeaArt only)
// Auto-Downloading "group by character": when true (default), images whose
// generation was queued from a search locked to a single character tag are
// filed into a per-character subfolder once enough of that character have
// been queued this session — see CHARACTER_SUBFOLDER_THRESHOLD and
// triggerAutoDownload's folder-name logic below. Desactivable by the user.
let characterSubfoldersEnabled = true;
// When true, the queue keeps injecting/generating even while the target tab is
// hidden (backgrounded/tab-switched) instead of pausing for visibility, and a
// sub-audible audio keep-alive runs in this side panel document to blunt
// Chrome's background timer throttling of the queue's own polling loops.
let backgroundGenerationEnabled = false;

// ── Safety: duplicate / stuck-prompt detection ──────────────────────────────
let lastGeneratedPrompt = null;     // Track the last prompt that was successfully sent to Generate
let consecutiveSamePrompt = 0;      // How many times in a row the same prompt was generated
const MAX_CONSECUTIVE_SAME = 2;     // Pause queue if same prompt generated more than this many times
let currentPromptRetries = 0;       // Retry counter for the current prompt
const MAX_PROMPT_RETRIES = 3;       // Max retries before skipping a prompt
let isPausedForError = false;       // True when paused due to safety error (stuck prompt, etc.)

// Timeout (ms) to wait for the Generate button to free up before giving up on an item
const GENERATE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
// Polling interval (ms) to check if the Generate button is free
const POLL_INTERVAL_MS = 1500;
// Interval (ms) to poll while waiting for a task slot to open
const SLOT_POLL_INTERVAL_MS = 3000;
// Time (ms) to keep watching for SeaArt's upgrade modal after clicking Generate.
// The Generate button in ComfyUI never becomes 'busy', so we MUST wait this long
// to catch the modal before declaring the generation "free".
const POST_CLICK_MODAL_WATCH_MS = 6000;
// Grace period (ms) after button becomes clickable before we inject the next prompt
// (gives SeaArt and other platforms a safe cooldown window — SeaArt has a ~2-3s cooldown)
const GRACE_PERIOD_MS = 3500;

// ─────────────────────────────────────────────────────────────────────────────
// Queue Persistence (chrome.storage.local)
// ─────────────────────────────────────────────────────────────────────────────
const QUEUE_STORAGE_KEY = "booru_prompt_queue";
const AUTODL_STORAGE_KEY = "booru_auto_download_enabled";
const BACKGROUND_GEN_STORAGE_KEY = "booru_background_generation_enabled";
const CHARACTER_SUBFOLDERS_STORAGE_KEY = "booru_character_subfolders_enabled";
const LEDGER_STORAGE_KEY = "booru_prompt_job_ledger";

/** Save the current promptQueue and autoDownload settings to chrome.storage.local */
function persistQueue() {
  try {
    chrome.storage.local.set({ 
      [QUEUE_STORAGE_KEY]: [...promptQueue],
      [AUTODL_STORAGE_KEY]: autoDownloadEnabled,
      [BACKGROUND_GEN_STORAGE_KEY]: backgroundGenerationEnabled,
      [CHARACTER_SUBFOLDERS_STORAGE_KEY]: characterSubfoldersEnabled
    });
  } catch (e) {
    console.warn("[Queue] Failed to persist queue:", e);
  }
}

/** Save the job ledger to chrome.storage.local so batch reports survive sidepanel reloads */
function persistLedger() {
  try {
    const serialized = Array.from(jobLedger.entries());
    chrome.storage.local.set({ [LEDGER_STORAGE_KEY]: serialized });
  } catch (e) {
    console.warn("[Ledger] Failed to persist ledger:", e);
  }
}

/** Restore job ledger from chrome.storage.local on startup */
function restoreLedger() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([LEDGER_STORAGE_KEY], (result) => {
        const saved = result[LEDGER_STORAGE_KEY];
        if (Array.isArray(saved) && saved.length > 0) {
          for (const [jobId, job] of saved) {
            if (jobId && job && typeof job === "object") {
              jobLedger.set(jobId, job);
            }
          }
          dlog(`[Ledger] Restored ${jobLedger.size} jobs from storage.`);
        }
        resolve();
      });
    } catch (_) {
      resolve();
    }
  });
}

/** Restore promptQueue and autoDownload settings from chrome.storage.local on startup */
function restoreQueue() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([QUEUE_STORAGE_KEY, AUTODL_STORAGE_KEY, BACKGROUND_GEN_STORAGE_KEY, CHARACTER_SUBFOLDERS_STORAGE_KEY], (result) => {
        const saved = result[QUEUE_STORAGE_KEY];
        if (Array.isArray(saved) && saved.length > 0) {
          // Migrate legacy string items (pre width/height support) to the
          // object shape { prompt, width?, height? }. Mixed arrays (some
          // legacy, some new) are supported since this maps per-item.
          const normalized = saved
            .map((item) => {
              if (typeof item === "string") return { prompt: item };
              if (item && typeof item.prompt === "string") return item;
              return null;
            })
            .filter(Boolean)
            .map((item) => ({
              ...item,
              jobId: item.jobId && jobLedger.has(item.jobId)
                ? item.jobId
                : ledgerCreate(item.prompt, item.character, item.width, item.height, item.targetOrigin)
            }));
          promptQueue.push(...normalized);
          dlog(`[Queue] Restored ${normalized.length} prompts from storage.`);
        }
        
        const savedAutoDL = result[AUTODL_STORAGE_KEY];
        if (typeof savedAutoDL === "boolean") {
          autoDownloadEnabled = savedAutoDL;
          dlog(`[Queue] Restored autoDownloadEnabled: ${autoDownloadEnabled}`);
          if (autoDownloadEnabled) {
            startAutoDownloadObserver();
          }
        }

        const savedBackgroundGen = result[BACKGROUND_GEN_STORAGE_KEY];
        if (typeof savedBackgroundGen === "boolean") {
          backgroundGenerationEnabled = savedBackgroundGen;
          dlog(`[Queue] Restored backgroundGenerationEnabled: ${backgroundGenerationEnabled}`);
          // NOTE: the audio keep-alive is NOT (re)started here. AudioContext
          // resume requires a user gesture, and startup runs without one — a
          // silently-suspended context would give a false sense of protection.
          // It's (re)armed the next time the user toggles the setting, or best-
          // effort on the first queue activity while the flag is on.
        }

        const savedCharacterSubfolders = result[CHARACTER_SUBFOLDERS_STORAGE_KEY];
        if (typeof savedCharacterSubfolders === "boolean") {
          characterSubfoldersEnabled = savedCharacterSubfolders;
          dlog(`[Queue] Restored characterSubfoldersEnabled: ${characterSubfoldersEnabled}`);
        } // else: keep the true default (feature is opt-out, not opt-in)

        updateQueueUI();
        resolve();
      });
    } catch (e) {
      console.warn("[Queue] Failed to restore queue:", e);
      resolve();
    }
  });
}


// Clear the prompt queue + reset safety state. Triggered by the React iframe
// via the QUEUE_ACTION "clear" message.
function clearQueue() {
  promptQueue.length = 0;
  // Reset safety state
  isPausedForError = false;
  consecutiveSamePrompt = 0;
  currentPromptRetries = 0;
  lastGeneratedPrompt = null;
  sentPromptsQueue.length = 0;
  jobLedger.clear();
  persistLedger();
  persistQueue();
  updateQueueUI();
}
