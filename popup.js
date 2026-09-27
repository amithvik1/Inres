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

  let settings = { ...DEFAULTS };

  const autoNextToggle = document.getElementById("autoNextToggle");
  const autoPipToggle = document.getElementById("autoPipToggle");
  const keepPlayingToggle = document.getElementById("keepPlayingToggle");
  const controlsToggle = document.getElementById("controlsToggle");
  const holdTo2xToggle = document.getElementById("holdTo2xToggle");
  const speedSelector = document.getElementById("speedSelector");
  const statusBadge = document.getElementById("statusBadge");

  async function loadSettings() {
    try {
      const res = await chrome.storage.local.get(STORAGE_KEY);

      if (res && res[STORAGE_KEY]) {
        settings = { ...DEFAULTS, ...res[STORAGE_KEY] };
      }
    } catch {}

    updateUI();
  }

  function updateUI() {
    autoNextToggle.checked = Boolean(settings.autoNext);
    autoPipToggle.checked = Boolean(settings.autoPip);
    keepPlayingToggle.checked = Boolean(settings.keepPlaying);
    controlsToggle.checked = Boolean(settings.controls);

    if (holdTo2xToggle) {
      holdTo2xToggle.checked = Boolean(settings.holdTo2x);
    }

    const speedChips = speedSelector.querySelectorAll(".speed-chip");

    speedChips.forEach((chip) => {
      const sp = parseFloat(chip.dataset.speed);

      chip.classList.toggle(
        "active",
        Math.abs(sp - settings.speed) < 0.01
      );
    });
  }

  async function saveSettings() {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEY]: settings
      });
    } catch {}

    try {
      chrome.tabs.query(
        { url: "*://*.instagram.com/*" },
        (tabs) => {
          if (!tabs || !tabs.length) return;

          tabs.forEach((tab) => {
            chrome.tabs
              .sendMessage(tab.id, {
                type: "RE_SETTINGS_UPDATED",
                settings
              })
              .catch(() => {});
          });
        }
      );
    } catch {}
  }

  autoNextToggle.addEventListener("change", () => {
    settings.autoNext = autoNextToggle.checked;
    saveSettings();
  });

  autoPipToggle.addEventListener("change", () => {
    settings.autoPip = autoPipToggle.checked;
    saveSettings();
  });

  keepPlayingToggle.addEventListener("change", () => {
    settings.keepPlaying = keepPlayingToggle.checked;
    saveSettings();
  });

  controlsToggle.addEventListener("change", () => {
    settings.controls = controlsToggle.checked;
    saveSettings();
  });

  if (holdTo2xToggle) {
    holdTo2xToggle.addEventListener("change", () => {
      settings.holdTo2x = holdTo2xToggle.checked;
      saveSettings();
    });
  }

  speedSelector.addEventListener("click", (e) => {
    const chip = e.target.closest(".speed-chip");

    if (!chip) return;

    const sp = parseFloat(chip.dataset.speed);

    if (!Number.isNaN(sp)) {
      settings.speed = sp;
      updateUI();
      saveSettings();
    }
  });

  chrome.tabs?.query(
    { active: true, currentWindow: true },
    (tabs) => {
      if (tabs && tabs[0] && tabs[0].url) {
        const url = tabs[0].url;

        if (url.includes("instagram.com/reel")) {
          statusBadge.textContent = "On Reels";
          statusBadge.style.color = "#10b981";
          statusBadge.style.background =
            "rgba(16, 185, 129, 0.15)";
        } else if (url.includes("instagram.com")) {
          statusBadge.textContent = "Instagram";
          statusBadge.style.color = "#38bdf8";
          statusBadge.style.background =
            "rgba(56, 189, 248, 0.15)";
        } else {
          statusBadge.textContent = "Ready";
        }
      }
    }
  );

  loadSettings();
})();
