// sidepanel/03-keepalive.js — Background audio keep-alive against timer throttling.
// Classic script: shares the global scope with the other sidepanel/*.js
// files, loaded in numeric order by sidepanel.html. Load-time code may only
// use names declared in this file or an earlier one.

// ─────────────────────────────────────────────────────────────────────────────
// Background audio keep-alive (Option 3) — blunt background timer throttling
// ─────────────────────────────────────────────────────────────────────────────
// The queue's driving loops (processNext, waitForGenerateButtonFree polling,
// the pacing setTimeouts) all live in THIS side panel document. When its window
// loses focus or is minimized, Chrome throttles those timers to ~1/sec and,
// after ~5 min, to ~1/min (intensive throttling), which stalls the queue.
// Chrome exempts documents that are "playing audible audio" from that
// throttling, so while background generation is on we play a continuous ~10 Hz
// tone: below the ~20 Hz human hearing floor (inaudible, and most speakers
// can't reproduce it) yet carrying real signal energy, which is what Chrome
// measures to decide a page is producing audio. Best-effort: efficacy varies
// by Chrome version/OS, and it does NOT un-pause requestAnimationFrame on the
// *target* tab (a separate limitation that mainly affects canvas/ComfyUI sites
// like SeaArt when their window is minimized).
//
// CROSS-BROWSER NOTE (Firefox/Gecko): this entire mechanism is Chromium-
// specific and is a documented no-op on Firefox. Gecko's background tab timer
// throttling model isn't built around an "audible audio" exemption the way
// Chromium's is, so keeping this oscillator running costs a little CPU/battery
// on Firefox for zero benefit — but it's also harmless: AudioContext itself is
// a standard Web Audio API and exists in both engines, so nothing here throws
// or crashes. This is a documented behavioral limitation, not a bug to
// silently "fix" — there's no equivalent lightweight always-on hook to
// substitute for it on Firefox, and disabling it outright would only remove
// the Chrome benefit without adding anything back for either engine. Users on
// Firefox/Zen relying on "Background generation" should keep the side panel's
// window focused (or at least not minimized) for long unattended queue runs.
let keepAliveAudioCtx = null;
let keepAliveOscillator = null;
let keepAliveGain = null;

function startBackgroundAudioKeepAlive() {
  try {
    if (!keepAliveAudioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) { dlog("[KeepAlive] Web Audio API unavailable — skipping audio keep-alive."); return; }
      keepAliveAudioCtx = new AudioCtx();
    }
    // Resume if the autoplay policy left the context suspended. This succeeds
    // when a user gesture propagated to this document (the settings toggle
    // click, forwarded via postMessage); otherwise it stays suspended until
    // the next interaction and the keep-alive is simply inactive until then.
    if (keepAliveAudioCtx.state === "suspended") {
      keepAliveAudioCtx.resume().catch(() => {});
    }
    if (!keepAliveOscillator) {
      keepAliveOscillator = keepAliveAudioCtx.createOscillator();
      keepAliveGain = keepAliveAudioCtx.createGain();
      keepAliveOscillator.frequency.value = 10; // sub-audible (below ~20 Hz)
      keepAliveGain.gain.value = 0.02;           // low but non-zero energy
      keepAliveOscillator.connect(keepAliveGain);
      keepAliveGain.connect(keepAliveAudioCtx.destination);
      keepAliveOscillator.start();
      dlog("[KeepAlive] Background audio keep-alive started (ctx state:", keepAliveAudioCtx.state, ").");
    }
  } catch (e) {
    console.warn("[KeepAlive] Failed to start audio keep-alive:", e);
  }
}

function stopBackgroundAudioKeepAlive() {
  try {
    if (keepAliveOscillator) { try { keepAliveOscillator.stop(); } catch (_) {} try { keepAliveOscillator.disconnect(); } catch (_) {} keepAliveOscillator = null; }
    if (keepAliveGain) { try { keepAliveGain.disconnect(); } catch (_) {} keepAliveGain = null; }
    if (keepAliveAudioCtx) { keepAliveAudioCtx.close().catch(() => {}); keepAliveAudioCtx = null; }
    dlog("[KeepAlive] Background audio keep-alive stopped.");
  } catch (e) {
    console.warn("[KeepAlive] Failed to stop audio keep-alive:", e);
  }
}
