(() => {
  "use strict";

  const STORAGE_KEY = "reEnhancerSettings";
  const DEFAULTS = {
    autoNext: false,
    autoPip: true,
    keepPlaying: true,
    controls: true,
    speed: 1,
    holdTo2x: true
  };
  const root = document.documentElement;

  let settings = { ...DEFAULTS };
  let activeVideo = null;
  let pipVideo = null;

  let controls = null;
  let progress = null;
  let progressBg = null;
  let btnPlay = null;
  let timeLabel = null;
  let curTimeSpan = null;
  let durTimeSpan = null;

  let isSeeking = false;
  let resumeAfterSeek = false;
  let showRemainingTime = false;
  let hideTimer = null;
  let lastScrollVideo = null;
  let lastScrollTime = 0;
  let tickQueued = false;
  let lastMouse = null;
  let mouseQueued = false;

  // last values written to the controls, so unchanged values don't touch the DOM
  let lastPct = -1;
  let lastCur = "";
  let lastDur = "";
  let lastPaused = null;
  let lastLayout = "";

  const boundVideos = new WeakSet();

  const playIcon = `<svg viewBox="0 0 24 24"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>`;
  const pauseIcon = `<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;

  const isReelsPage = () => {
    const p = location.pathname.toLowerCase().replace(/\/+$/, "");
    return p === "" || p === "/" || p.includes("reel") || p.startsWith("/p/");
  };

  // ---- settings ----

  const syncSettingsToPage = () => {
    root.dataset.reKeepPlaying = String(settings.keepPlaying);
    root.dataset.reAutoPip = String(settings.autoPip);
    root.dataset.reHoldTo2x = String(settings.holdTo2x);
    window.dispatchEvent(new CustomEvent("re-sync-settings", { detail: { ...settings } }));
  };

  const setSettings = (next) => {
    settings = { ...DEFAULTS, ...next };
    syncSettingsToPage();
    applyToVideos();
  };

  async function initSettings() {
    try {
      const res = await chrome.storage.local.get(STORAGE_KEY);
      setSettings(res?.[STORAGE_KEY]);
    } catch {
      setSettings();
    }
  }

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) setSettings(changes[STORAGE_KEY].newValue);
  });

  chrome.runtime?.onMessage?.addListener((msg) => {
    if (msg?.type === "RE_SETTINGS_UPDATED" && msg.settings) setSettings(msg.settings);
  });

  function configureVideo(v) {
    try {
      if (root.dataset.reHoldSpeeding !== "true" && v.playbackRate !== settings.speed) {
        v.playbackRate = settings.speed;
      }
      v.disablePictureInPicture = false;
    } catch {}
  }

  function applyToVideos() {
    if (isReelsPage()) document.querySelectorAll("video").forEach(configureVideo);
    scheduleTick();
  }

  // ---- video discovery ----

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const s = Math.floor(sec);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function findReelCard(video) {
    return (
      video.closest("article") ||
      video.closest('div[role="presentation"]') ||
      video.parentElement?.parentElement ||
      video.parentElement
    );
  }

  function getAllVideos() {
    return [...document.querySelectorAll("video")].filter((v) => {
      if (!v.isConnected) return false;
      if (v.hasAttribute("data-re-pip-active")) return true;
      if (v.offsetParent === null) return false;
      const r = v.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      if (v.hasAttribute("data-prebuffer-clone") || v.dataset.prebuffer) return false;
      if (v.id && v.id.includes("pip")) return false;
      return true;
    });
  }

  function getActiveVideo(all) {
    const mid = innerHeight / 2;
    const vs = all
      .map((v) => ({ v, r: v.getBoundingClientRect() }))
      .filter(({ r }) => r.bottom > 0 && r.top < innerHeight)
      .sort((a, b) => Math.abs((a.r.top + a.r.bottom) / 2 - mid) - Math.abs((b.r.top + b.r.bottom) / 2 - mid))
      .map(({ v }) => v);

    return vs.find((v) => !v.paused && !v.ended && v.readyState >= 2) || vs[0] || null;
  }

  // ---- auto-next ----

  function scrollToNextReel(video) {
    if (!settings.autoNext || !isReelsPage()) return;
    const now = Date.now();
    if (lastScrollVideo === video && now - lastScrollTime < 1500) return;
    lastScrollVideo = video;
    lastScrollTime = now;

    const currentCard = findReelCard(video);
    const articles = [...document.querySelectorAll("article, [role='presentation']")].filter((a) => {
      const r = a.getBoundingClientRect();
      return r.height > innerHeight * 0.4 && r.width > 200;
    });

    if (currentCard) {
      const cr = currentCard.getBoundingClientRect();
      const next = articles
        .filter((a) => a !== currentCard && a.getBoundingClientRect().top > cr.top + 50)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];

      if (next) {
        next.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }

    window.scrollBy({ top: Math.max(innerHeight * 0.85, 450), behavior: "smooth" });
  }

  // ---- seek bar / controls ----

  function createControls() {
    if (controls) return;

    controls = document.createElement("div");
    controls.className = "re-reel-controls";

    controls.innerHTML = `
      <button class="re-icon-btn re-btn-play" aria-label="Play/Pause">${playIcon}</button>
      <div class="re-progress-container">
        <div class="re-progress-row">
          <div class="re-progress-track"></div>
          <div class="re-progress-bg"></div>
          <input class="re-progress" type="range" min="0" max="100" value="0" step="0.1" aria-label="Seek">
        </div>
      </div>
      <div class="re-time-label" title="Click to toggle remaining time">
        <span class="re-cur-time">0:00</span>
        <span class="re-time-sep">/</span>
        <span class="re-dur-time">0:00</span>
      </div>
    `;

    root.appendChild(controls);

    progressBg = controls.querySelector(".re-progress-bg");
    progress = controls.querySelector(".re-progress");
    btnPlay = controls.querySelector(".re-btn-play");
    timeLabel = controls.querySelector(".re-time-label");
    curTimeSpan = controls.querySelector(".re-cur-time");
    durTimeSpan = controls.querySelector(".re-dur-time");

    ["mousedown", "mouseup", "click", "dblclick", "pointerdown", "pointerup"].forEach((evt) => {
      controls.addEventListener(evt, (e) => e.stopPropagation());
    });

    const startSeek = (e) => {
      e.stopPropagation();
      if (isSeeking) return;
      isSeeking = true;
      resumeAfterSeek = !!activeVideo && !activeVideo.paused;
    };

    progress.addEventListener("pointerdown", startSeek);
    progress.addEventListener("mousedown", startSeek);
    progress.addEventListener("touchstart", startSeek, { passive: true });

    progress.addEventListener("input", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!activeVideo) return;
      const val = Number(progress.value);
      const dur = activeVideo.duration;
      if (Number.isFinite(dur) && dur > 0) {
        const target = Math.max(0, Math.min(dur - 0.1, (val / 100) * dur));
        try { activeVideo.currentTime = target; } catch {}
        lastCur = formatTime(target);
        curTimeSpan.textContent = lastCur;
      }
      lastPct = val;
      progressBg.style.clipPath = `inset(0 ${100 - val}% 0 0)`;
    });

    const finishSeek = () => {
      if (!isSeeking) return;
      isSeeking = false;
      if (activeVideo) {
        const dur = activeVideo.duration;
        if (Number.isFinite(dur) && dur > 0) {
          const target = Math.max(0, Math.min(dur - 0.1, (Number(progress.value) / 100) * dur));
          try { activeVideo.currentTime = target; } catch {}
        }
        if (resumeAfterSeek) activeVideo.play().catch(() => {});
      }
      updateProgress();
    };

    progress.addEventListener("pointerup", finishSeek);
    progress.addEventListener("mouseup", finishSeek);
    progress.addEventListener("touchend", finishSeek);
    progress.addEventListener("change", finishSeek);

    btnPlay.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!activeVideo) return;
      if (activeVideo.paused) activeVideo.play().catch(() => {});
      else activeVideo.pause();
      updateProgress();
    });

    timeLabel.addEventListener("click", (e) => {
      e.stopPropagation();
      showRemainingTime = !showRemainingTime;
      lastDur = "";
      updateProgress();
    });
  }

  function resetProgressCache() {
    lastPct = -1;
    lastCur = "";
    lastDur = "";
    lastPaused = null;
  }

  function updateProgress() {
    if (!controls || !activeVideo) return;
    const rawDur = activeVideo.duration;
    const dur = Number.isFinite(rawDur) ? rawDur : 0;
    const cur = activeVideo.currentTime || 0;

    if (!isSeeking) {
      const pct = dur > 0 ? (cur / dur) * 100 : 0;
      if (Math.abs(pct - lastPct) >= 0.05) {
        lastPct = pct;
        progress.value = String(pct);
        progressBg.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
      }

      const c = formatTime(cur);
      if (c !== lastCur) {
        lastCur = c;
        curTimeSpan.textContent = c;
      }

      const d = showRemainingTime && dur > 0 ? `-${formatTime(dur - cur)}` : formatTime(dur);
      if (d !== lastDur) {
        lastDur = d;
        durTimeSpan.textContent = d;
      }
    }

    if (activeVideo.paused !== lastPaused) {
      lastPaused = activeVideo.paused;
      btnPlay.innerHTML = lastPaused ? playIcon : pauseIcon;
    }
  }

  function hideControls() {
    if (controls && controls.style.display !== "none") controls.style.display = "none";
  }

  function positionControls() {
    if (!controls) return;
    if (!activeVideo || !isReelsPage() || !settings.controls) {
      hideControls();
      return;
    }

    const r = activeVideo.getBoundingClientRect();
    if (
      (r.width < 50 || r.height < 50 || r.bottom <= 0 || r.top >= innerHeight) &&
      !activeVideo.hasAttribute("data-re-pip-active")
    ) {
      hideControls();
      return;
    }

    const left = Math.round(r.left + 12);
    const width = Math.round(r.width - 60);
    const bottom = Math.max(10, Math.round(innerHeight - r.bottom + 12));
    const layout = `${left}|${width}|${bottom}`;
    if (layout !== lastLayout || controls.style.display !== "flex") {
      lastLayout = layout;
      controls.style.display = "flex";
      controls.style.left = `${left}px`;
      controls.style.width = `${width}px`;
      controls.style.bottom = `${bottom}px`;
    }
  }

  // ---- per-video events ----

  function bindVideoEvents(video) {
    if (boundVideos.has(video)) return;
    boundVideos.add(video);
    configureVideo(video);

    video.addEventListener("ended", () => {
      if (settings.autoNext && video === activeVideo) setTimeout(() => scrollToNextReel(video), 120);
    });

    video.addEventListener("timeupdate", () => {
      if (video !== activeVideo) return;
      updateProgress();
      if (settings.autoNext && video.duration > 2 && video.currentTime >= video.duration - 0.25) {
        scrollToNextReel(video);
      }
    });

    ["play", "pause", "loadedmetadata", "durationchange"].forEach((evt) => {
      video.addEventListener(evt, () => {
        if (video === activeVideo) updateProgress();
      });
    });
  }

  // ---- main loop (coalesced to one run per frame) ----

  function tick() {
    tickQueued = false;
    if (!isReelsPage()) {
      hideControls();
      return;
    }

    // Runs even while the tab is hidden: this is exactly when autoscroll advances to
    // the next reel, and PiP needs to follow that or it's left showing a stale video.
    const all = getAllVideos();
    all.forEach(bindVideoEvents);

    const prev = activeVideo;
    activeVideo = getActiveVideo(all);
    const changed = activeVideo !== prev;
    if (changed) resetProgressCache();

    followPipTarget();

    if (document.hidden) return; // nothing to draw while hidden

    if (!settings.controls) {
      hideControls();
      return;
    }

    createControls();
    if (changed && activeVideo) updateProgress();
    positionControls();
  }

  function scheduleTick() {
    if (tickQueued) return;
    tickQueued = true;
    requestAnimationFrame(tick);
  }

  // ---- show/hide controls near the bottom of the reel ----

  function handleMouse() {
    mouseQueued = false;
    const e = lastMouse;
    if (!e || !controls || !isReelsPage() || !settings.controls) return;

    let show = isSeeking;
    if (!show && activeVideo) {
      const vr = activeVideo.getBoundingClientRect();
      const cr = controls.getBoundingClientRect();
      const inBottomReel =
        e.clientX >= vr.left - 10 &&
        e.clientX <= vr.right + 10 &&
        e.clientY >= vr.bottom - 140 &&
        e.clientY <= vr.bottom + 20;
      const inControls =
        e.clientX >= cr.left && e.clientX <= cr.right && e.clientY >= cr.top && e.clientY <= cr.bottom;
      show = inBottomReel || inControls;
    }

    clearTimeout(hideTimer);
    if (show) {
      controls.classList.add("re-visible");
    } else {
      hideTimer = setTimeout(() => {
        if (!isSeeking && !controls.matches(":hover")) controls.classList.remove("re-visible");
      }, 180);
    }
  }

  window.addEventListener(
    "mousemove",
    (e) => {
      lastMouse = e;
      if (mouseQueued) return;
      mouseQueued = true;
      requestAnimationFrame(handleMouse);
    },
    { passive: true }
  );

  // ---- picture-in-picture ----
  // Enter/exit run through one queue so they can never overlap (an exit racing a pending
  // enter is what leaves Chrome showing "Playing in picture-in-picture" with no window).
  // Every outcome is logged to the console as "[re-pip]".

  const log = (...a) => console.debug("[re-pip]", ...a);
  let pipBusy = 0;
  let pipQueue = Promise.resolve();
  let visibleSince = 0;
  let lastEnterAt = 0;
  let awayAt = 0;

  // Starts immediately when idle, so requestPictureInPicture() is still called inside
  // the media-session handler; queues behind any operation already running.
  function runPip(fn) {
    const run = () =>
      fn()
        .catch((e) => log("error:", e?.name || e))
        .finally(() => { pipBusy--; });
    pipBusy++;
    pipQueue = pipBusy === 1 ? run() : pipQueue.then(run);
    return pipQueue;
  }

  // The playing video nearest the viewport centre.
  function pickVideo() {
    const mid = innerHeight / 2;
    let best = null;
    let bestDist = Infinity;
    for (const v of document.querySelectorAll("video")) {
      if (v.paused || v.ended || v.readyState < 2) continue;
      const r = v.getBoundingClientRect();
      if (r.width < 50 || r.height < 50 || r.bottom <= 0 || r.top >= innerHeight) continue;
      const d = Math.abs((r.top + r.bottom) / 2 - mid);
      if (d < bestDist) {
        best = v;
        bestDist = d;
      }
    }
    return best;
  }

  function enterPiP(viaHandler = false) {
    return runPip(async () => {
      if (!settings.autoPip || !document.pictureInPictureEnabled) return;
      if (document.pictureInPictureElement) return;
      if (!viaHandler && !document.hidden) return;

      const v = pickVideo();
      if (!v) {
        log("no playing video to pop out");
        return;
      }

      lastEnterAt = Date.now();
      pipVideo = v;
      v.disablePictureInPicture = false;
      v.setAttribute("data-re-pip-active", "true");
      try {
        await v.requestPictureInPicture();
        log("entered via", viaHandler ? "media-session" : "visibilitychange");
      } catch (e) {
        v.removeAttribute("data-re-pip-active");
        pipVideo = null;
        log("request rejected:", e.name, "-", e.message);
      }
    });
  }

  let lastFollowAt = 0;

  // Moves an already-open PiP window to whatever video has actually become the active
  // one (e.g. autoscroll landed on the next reel). Chrome allows retargeting PiP to a
  // different element with no fresh user gesture as long as a PiP session is already
  // open, so this doesn't need runPip's gesture-sensitive path.
  function followPipTarget() {
    if (!pipVideo || document.pictureInPictureElement !== pipVideo) return;
    if (!activeVideo || activeVideo === pipVideo) return;
    if (activeVideo.paused || activeVideo.ended || activeVideo.readyState < 2) return;
    if (Date.now() - lastFollowAt < 800) return;

    lastFollowAt = Date.now();
    const from = pipVideo;
    const to = activeVideo;

    runPip(async () => {
      try {
        await to.requestPictureInPicture();
        from.removeAttribute("data-re-pip-active");
        to.setAttribute("data-re-pip-active", "true");
        pipVideo = to;
        lastEnterAt = Date.now();
        log("PiP followed autoscroll to the next reel");
      } catch (e) {
        log("PiP follow failed:", e.name);
      }
    });
  }

  function resume(v) {
    if (v && v.isConnected && v.paused) v.play().catch(() => {});
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function exitPiP() {
    return runPip(async () => {
      const v = pipVideo || document.pictureInPictureElement;
      pipVideo = null;

      for (let i = 0; i < 3 && document.pictureInPictureElement; i++) {
        try {
          await document.exitPictureInPicture();
        } catch (e) {
          log("exit failed:", e.name);
        }

        if (document.pictureInPictureElement) await wait(250);
      }

      const stuck = document.pictureInPictureElement;
      if (stuck) log("could not close PiP yet, will retry on the next check");

      document.querySelectorAll("video[data-re-pip-active]").forEach((x) => {
        if (x !== stuck) x.removeAttribute("data-re-pip-active");
      });

      resume(v);
      scheduleTick();
    });
  }

  function checkPip() {
    if (document.hidden) return;

    const el = document.pictureInPictureElement;
    if (!el || !el.hasAttribute("data-re-pip-active")) return;

    const now = Date.now();

    if (now - visibleSince < 300) return;

    if (lastEnterAt > visibleSince && now - lastEnterAt < 1500) return;

    log("PiP still active on a visible tab, closing");
    exitPiP();
  }

  document.addEventListener(
    "leavepictureinpicture",
    (e) => {
      const v = e.target;

      v.removeAttribute?.("data-re-pip-active");

      if (pipVideo === v) pipVideo = null;

      log("left PiP");

      if (!document.hidden) resume(v);

      scheduleTick();
    },
    true
  );

  document.addEventListener(
    "enterpictureinpicture",
    (e) => {
      const v = e.target;
      const enteredAt = Date.now();

      setTimeout(() => {
        if (!settings.autoPip || document.pictureInPictureElement !== v) return;
        if (v.hasAttribute("data-re-pip-active")) return;

        if (document.hidden || Math.abs(awayAt - enteredAt) < 1500) {
          v.setAttribute("data-re-pip-active", "true");
          lastEnterAt = enteredAt;
          log("adopted a PiP that started while away");
        }
      }, 300);
    },
    true
  );

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      awayAt = Date.now();
      enterPiP(false);
    } else {
      visibleSince = Date.now();
      setTimeout(checkPip, 350);
      scheduleTick();
    }
  });

  window.addEventListener("re-enter-pip", () => {
    awayAt = Date.now();
    enterPiP(true);
  });

  setInterval(checkPip, 1000);

  // ---- wiring ----

  const style = document.createElement("style");
  style.id = "re-pip-style-override";
  style.textContent =
    'video[data-re-pip-active="true"] { display: block !important; visibility: visible !important; opacity: 1 !important; pointer-events: auto !important; } .playing-in-pip video, [data-re-pip-active="true"] { background-color: transparent !important; }';

  (document.head || root).appendChild(style);

  new MutationObserver((records) => {
    if (controls && records.every((r) => controls.contains(r.target))) return;
    scheduleTick();
  }).observe(root, { childList: true, subtree: true });

  window.addEventListener("scroll", scheduleTick, { passive: true });
  window.addEventListener("resize", scheduleTick, { passive: true });
  window.addEventListener("popstate", scheduleTick);

  setInterval(scheduleTick, 500);

  initSettings().then(scheduleTick);
})();
