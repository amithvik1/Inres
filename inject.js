(() => {
  "use strict";

  // Runs in the page's own JS world at document_start.
  // Job 1: keep Instagram from noticing the tab is hidden, so it keeps playing.
  // Job 2: register Chrome's auto-PiP media-session handler and relay it to content.js.

  let keepPlaying = true;
  let holdTo2x = false;

  const syncFromDataset = () => {
    const ds = document.documentElement?.dataset;
    const v = ds?.reKeepPlaying;
    if (v !== undefined) keepPlaying = v === "true";

    const hold = ds?.reHoldTo2x;
    if (hold !== undefined) holdTo2x = hold === "true";
  };

  window.addEventListener("re-sync-settings", (e) => {
    if (typeof e.detail?.keepPlaying === "boolean") {
      keepPlaying = e.detail.keepPlaying;
    }

    if (typeof e.detail?.holdTo2x === "boolean") {
      holdTo2x = e.detail.holdTo2x;
    } else {
      syncFromDataset();
    }

    if (!holdTo2x) stopHoldSpeed();
  });

  // ---- visibility spoofing ----

  try {
    const proto = Document.prototype;
    const nativeHidden = Object.getOwnPropertyDescriptor(proto, "hidden").get;
    const nativeState = Object.getOwnPropertyDescriptor(proto, "visibilityState").get;
    const nativeHasFocus = proto.hasFocus;

    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => (keepPlaying ? false : nativeHidden.call(document))
    });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (keepPlaying ? "visible" : nativeState.call(document))
    });

    document.hasFocus = () => keepPlaying || nativeHasFocus.call(document);
  } catch {}

  // Page listeners for visibilitychange/blur on window/document go quiet while
  // keepPlaying is on. Wrappers are remembered so removeEventListener still works.
  const SWALLOWED = new Set(["visibilitychange", "blur"]);
  const wrappers = new WeakMap();
  const nativeAdd = EventTarget.prototype.addEventListener;
  const nativeRemove = EventTarget.prototype.removeEventListener;

  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (
      SWALLOWED.has(type) &&
      (this === window || this === document) &&
      listener &&
      (typeof listener === "function" || typeof listener === "object")
    ) {
      let wrapped = wrappers.get(listener);

      if (!wrapped) {
        wrapped = function (event) {
          if (keepPlaying) return;

          return typeof listener === "function"
            ? listener.call(this, event)
            : listener.handleEvent?.(event);
        };

        wrappers.set(listener, wrapped);
      }

      return nativeAdd.call(this, type, wrapped, options);
    }

    return nativeAdd.call(this, type, listener, options);
  };

  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const wrapped =
      SWALLOWED.has(type) && listener ? wrappers.get(listener) : undefined;

    return nativeRemove.call(this, type, wrapped || listener, options);
  };

  // ---- hold-to-2x (page/main world) ----

  const HOLD_DELAY_MS = 500;
  const HOLD_MOVE_TOLERANCE_PX = 15;

  let holdTimer = null;
  let holdPointerId = null;
  let holdTarget = null;
  let holdPreviousRate = 1;
  let holdSpeeding = false;
  let holdStartX = 0;
  let holdStartY = 0;
  let suppressNextHoldClick = false;

  function publishHoldState(active) {
    try {
      document.documentElement.dataset.reHoldSpeeding = active
        ? "true"
        : "false";
    } catch {}
  }

  function ensureHoldBadge() {
    let badge = document.getElementById("re-hold-2x-badge");

    if (badge) return badge;

    badge = document.createElement("div");
    badge.id = "re-hold-2x-badge";

    badge.innerHTML =
      '<span style="display:inline-flex;align-items:center;gap:7px;">' +
      '<span style="font:600 15px/1 Arial,sans-serif;letter-spacing:-.2px;">2x</span>' +
      '<svg width="17" height="13" viewBox="0 0 24 24" aria-hidden="true">' +
      '<polygon points="3 5 11 12 3 19 3 5"></polygon>' +
      '<polygon points="12 5 20 12 12 19 12 5"></polygon>' +
      "</svg></span>";

    Object.assign(badge.style, {
      position: "fixed",
      zIndex: "2147483647",
      pointerEvents: "none",
      transform: "translate(-50%, -50%)",
      padding: "0",
      background: "transparent",
      color: "rgba(255,255,255,.78)",
      opacity: "0",
      transition: "opacity .12s ease"
    });

    const svg = badge.querySelector("svg");

    if (svg) {
      svg.style.fill = "rgba(255,255,255,.78)";
      svg.style.display = "block";
    }

    document.documentElement.appendChild(badge);

    return badge;
  }

  function showHoldBadge(video) {
    if (!video) return;

    const badge = ensureHoldBadge();
    const r = video.getBoundingClientRect();

    badge.style.left = `${Math.round(r.left + r.width / 2)}px`;
    badge.style.top = `${Math.max(24, Math.round(r.top + 44))}px`;
    badge.style.opacity = "1";
  }

  function hideHoldBadge() {
    const badge = document.getElementById("re-hold-2x-badge");

    if (badge) {
      badge.style.opacity = "0";
    }
  }

  function isReelsPage() {
    const p = location.pathname.toLowerCase().replace(/\/+$/, "");

    return (
      p === "" ||
      p === "/" ||
      p.includes("reel") ||
      p.startsWith("/p/")
    );
  }

  function videoContainsPoint(video, x, y) {
    if (!video || !video.isConnected) return false;

    const r = video.getBoundingClientRect();

    return (
      r.width > 1 &&
      r.height > 1 &&
      x >= r.left &&
      x <= r.right &&
      y >= r.top &&
      y <= r.bottom
    );
  }

  function getPlayingVideoAtPoint(x, y) {
    const candidates = [...document.querySelectorAll("video")].filter((v) => {
      if (v.paused || v.ended || v.readyState < 2) return false;

      if (
        v.hasAttribute("data-prebuffer-clone") ||
        v.dataset.prebuffer
      ) {
        return false;
      }

      if (v.id && v.id.includes("pip")) return false;

      return videoContainsPoint(v, x, y);
    });

    if (!candidates.length) return null;

    candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();

      return (
        br.width * br.height -
        ar.width * ar.height
      );
    });

    return candidates[0];
  }

  function isExplicitControlAtPoint(x, y) {
    const el = document.elementFromPoint(x, y);

    if (!el) return false;

    const control = el.closest(
      "button, a, input, textarea, select, [role='slider'], " +
      "[role='progressbar'], [role='menuitem'], " +
      "[contenteditable='true'], .re-reel-controls"
    );

    if (!control || control.id === "re-hold-2x-badge") {
      return false;
    }

    const r = control.getBoundingClientRect();

    return (
      r.width > 0 &&
      r.height > 0 &&
      x >= r.left &&
      x <= r.right &&
      y >= r.top &&
      y <= r.bottom &&
      r.width < Math.max(180, innerWidth * 0.35) &&
      r.height < Math.max(180, innerHeight * 0.35)
    );
  }

  function clearHoldTimer() {
    if (holdTimer !== null) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  }

  function clearHoldState() {
    clearHoldTimer();
    holdPointerId = null;
    holdTarget = null;
  }

  function stopHoldSpeed() {
    clearHoldTimer();

    const video = holdTarget;
    const wasSpeeding = holdSpeeding;

    holdSpeeding = false;

    if (wasSpeeding && video) {
      try {
        video.playbackRate = holdPreviousRate;
      } catch {}
    }

    hideHoldBadge();
    publishHoldState(false);

    holdPointerId = null;
    holdTarget = null;
  }

  function startHold(e) {
    if (!holdTo2x || !isReelsPage()) return;
    if (e.button !== 0) return;
    if (holdPointerId !== null) return;

    if (isExplicitControlAtPoint(e.clientX, e.clientY)) {
      return;
    }

    const video = getPlayingVideoAtPoint(
      e.clientX,
      e.clientY
    );

    if (!video) return;

    holdPointerId = e.pointerId;
    holdTarget = video;

    holdPreviousRate = Number.isFinite(video.playbackRate)
      ? video.playbackRate
      : 1;

    holdStartX = e.clientX;
    holdStartY = e.clientY;

    clearHoldTimer();

    holdTimer = setTimeout(() => {
      holdTimer = null;

      const v = holdTarget;

      if (
        holdPointerId === null ||
        !holdTo2x ||
        !isReelsPage() ||
        !v ||
        !v.isConnected ||
        v.paused ||
        v.ended ||
        v.readyState < 2
      ) {
        clearHoldState();
        return;
      }

      holdSpeeding = true;
      publishHoldState(true);

      try {
        v.playbackRate = 2;
      } catch {}

      showHoldBadge(v);
    }, HOLD_DELAY_MS);
  }

  function moveHold(e) {
    if (
      holdPointerId === null ||
      e.pointerId !== holdPointerId ||
      !holdTarget
    ) {
      return;
    }

    if (holdSpeeding) return;

    const dist = Math.hypot(
      e.clientX - holdStartX,
      e.clientY - holdStartY
    );

    if (dist > HOLD_MOVE_TOLERANCE_PX) {
      clearHoldState();
    }
  }

  function endHold(e) {
    if (
      holdPointerId !== null &&
      e.pointerId !== holdPointerId
    ) {
      return;
    }

    // This is the important fix:
    // a completed hold must not become Instagram's normal click-to-pause.
    if (holdSpeeding) {
      suppressNextHoldClick = true;

      try {
        e.preventDefault();
        e.stopImmediatePropagation();
      } catch {}

      const video = holdTarget;
      const restoreRate = holdPreviousRate;

      stopHoldSpeed();

      if (
        video &&
        video.isConnected &&
        !video.ended
      ) {
        try {
          video.playbackRate = restoreRate;
        } catch {}

        // Always resume playback after the hold.
        if (video.paused) {
          video.play().catch(() => {});
        }
      }

      setTimeout(() => {
        suppressNextHoldClick = false;
      }, 400);

      return;
    }

    stopHoldSpeed();
  }

  // Unified mouse/trackpad/touch handling.
  window.addEventListener(
    "pointerdown",
    startHold,
    {
      capture: true,
      passive: true
    }
  );

  window.addEventListener(
    "pointermove",
    moveHold,
    {
      capture: true,
      passive: true
    }
  );

  window.addEventListener(
    "pointerup",
    endHold,
    {
      capture: true,
      passive: false
    }
  );

  window.addEventListener(
    "pointercancel",
    endHold,
    {
      capture: true,
      passive: false
    }
  );

  // Prevent Instagram's follow-up click from pausing the Reel.
  window.addEventListener(
    "click",
    (e) => {
      if (!suppressNextHoldClick) return;

      suppressNextHoldClick = false;

      try {
        e.preventDefault();
        e.stopImmediatePropagation();
      } catch {}
    },
    true
  );

  window.addEventListener(
    "blur",
    stopHoldSpeed
  );

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) {
        stopHoldSpeed();
      }
    },
    true
  );

  document.addEventListener(
    "pause",
    (e) => {
      if (e.target === holdTarget) {
        stopHoldSpeed();
      }
    },
    true
  );

  document.addEventListener(
    "ended",
    (e) => {
      if (e.target === holdTarget) {
        stopHoldSpeed();
      }
    },
    true
  );

  // Keep 2x active if another Instagram handler tries to change the rate.
  document.addEventListener(
    "ratechange",
    (e) => {
      if (
        !holdSpeeding ||
        e.target !== holdTarget
      ) {
        return;
      }

      try {
        if (e.target.playbackRate !== 2) {
          e.target.playbackRate = 2;
        }
      } catch {}
    },
    true
  );

  publishHoldState(false);
  syncFromDataset();

  // ---- auto picture-in-picture ----

  try {
    navigator.mediaSession.setActionHandler(
      "enterpictureinpicture",
      () => {
        window.dispatchEvent(
          new Event("re-enter-pip")
        );
      }
    );
  } catch {}

  const nativePlay = HTMLMediaElement.prototype.play;

  HTMLMediaElement.prototype.play = function () {
    try {
      navigator.mediaSession.playbackState = "playing";
    } catch {}

    return nativePlay.apply(this, arguments);
  };
})();
