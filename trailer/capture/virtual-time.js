// Injected before any page script (Playwright addInitScript). Replaces the page's clocks with a
// virtual clock that only advances when the capture driver calls window.__vt.advance(ms).
// Rendering in headless software WebGL is slow; with virtual time every captured frame is exactly
// 1/30 s of game time apart, so the footage plays back at true speed and is perfectly smooth.
// Nothing in the game is modified: the same code runs, it just sees a steady clock.
(() => {
  const SEED = Number(new URLSearchParams(location.search).get("seed") || 7);
  // deterministic Math.random so a shot can be re-captured identically
  let s = SEED >>> 0;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let now = 1000; // virtual ms
  const epoch = Date.now();
  performance.now = () => now;
  Date.now = () => epoch + now;

  let rafId = 0;
  let rafQ = new Map();
  window.requestAnimationFrame = (cb) => {
    rafQ.set(++rafId, cb);
    return rafId;
  };
  window.cancelAnimationFrame = (id) => rafQ.delete(id);

  let tid = 1;
  const timers = new Map();
  window.setTimeout = (cb, ms = 0, ...args) => {
    const id = tid++;
    timers.set(id, { at: now + Math.max(0, Number(ms) || 0), cb, args, iv: 0, seq: id });
    return id;
  };
  window.setInterval = (cb, ms = 0, ...args) => {
    const id = tid++;
    const iv = Math.max(1, Number(ms) || 0);
    timers.set(id, { at: now + iv, cb, args, iv, seq: id });
    return id;
  };
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);

  // CSS animations / transitions: pause them and drive currentTime from the virtual clock
  const seen = new WeakSet();
  function stepAnimations(ms) {
    for (const a of document.getAnimations()) {
      try {
        if (!seen.has(a)) {
          seen.add(a);
          a.pause();
          a.currentTime = 0;
        } else {
          if (a.playState === "running") a.pause();
          a.currentTime = (a.currentTime || 0) + ms;
        }
      } catch {
        /* finished / detached */
      }
    }
  }

  function runTimersUntil(target) {
    for (let guard = 0; guard < 10000; guard++) {
      let next = null;
      for (const [id, t] of timers) if (t.at <= target && (!next || t.at < next[1].at || (t.at === next[1].at && t.seq < next[1].seq))) next = [id, t];
      if (!next) return;
      const [id, t] = next;
      now = Math.max(now, t.at);
      if (t.iv) t.at += t.iv;
      else timers.delete(id);
      try {
        typeof t.cb === "function" ? t.cb(...t.args) : new Function(String(t.cb))();
      } catch (e) {
        console.error("[vt] timer error", e);
      }
    }
  }

  window.__vt = {
    get now() {
      return now;
    },
    /** advance the clock by ms: fire due timers, then one animation frame */
    advance(ms) {
      const target = now + ms;
      runTimersUntil(target);
      now = target;
      const q = rafQ;
      rafQ = new Map();
      for (const cb of q.values()) {
        try {
          cb(now);
        } catch (e) {
          console.error("[vt] raf error", e);
        }
      }
      stepAnimations(ms);
    },
  };
})();
