# Inres

**Inres** is a Chrome extension that enhances the Instagram Reels experience with additional playback controls, navigation features, Picture-in-Picture support, background audio, and a YouTube Shorts-style hold-to-2× playback gesture.

- Im lazy and I like scrolling on my laptop and this extension adds a lot of useful features from Youtube shorts / Instagram mobile app to the web-client. Just for fun project

- Feel Free to let me know if any changes / errors are encountered while using this extension

**Current version:** `7.0.1` (after lot of changes) 

---

## Download & install

Here is simple way to use it in chrome: 

1. Download the project ZIP.
2. Extract it
3. Open Chrome and go to:
   ```text
   chrome://extensions
   ```
4. Turn on **Developer mode** in the top-right.
5. Click **Load unpacked**.
6. Pick the extracted **Inres** folder.
7. Open Instagram, go to Reels, and reload! thats it tbh. 

You can open the Inres icon in Chrome's toolbar to change the features and playback speed.

If you update the extension files later, go back to `chrome://extensions` and hit **Reload** on Inres.

## What it can do

### Auto-scroll Reels

Automatically advances to the next Reel when the current Reel finishes.

- Detects when the active Reel reaches the end.
- Finds the next Reel on the page and smoothly scrolls to it.
- Falls back to a viewport-sized scroll when a specific next Reel cannot be located.
- Includes protection against repeatedly triggering the same Reel.

**Default:** Off

---

### Auto Picture-in-Picture

Automatically moves the currently playing Reel into the browser's Picture-in-Picture window when switching away from the Instagram tab.

- Uses the browser's native Picture-in-Picture API.
- Detects the currently active/playing Reel.
- Keeps the PiP window synchronized with the active Reel.
- Can follow an auto-scroll transition to the next Reel while PiP is already open.
- Handles PiP entry and exit through a queued operation system to avoid conflicting requests.
- Restores playback when PiP is closed.
- Cleans up PiP state when the active video changes.

**Default:** On

---

### Background Audio

Keeps Reel playback active when switching tabs or applications.

Inres modifies the page's visibility/focus behavior so Instagram does not automatically treat the page as inactive while the feature is enabled.

- Keeps the Reel playing when changing tabs.
- Keeps audio playing when switching applications.
- Suppresses relevant page-level visibility/blur handling while enabled.
- Works alongside Auto Picture-in-Picture.

**Default:** On

---

### Translucent Scrubber

Adds a custom glass-style Reel playback control bar.

The controls include:

- Play/Pause button
- Interactive seek bar
- Current playback time
- Total duration
- Remaining-time display

#### Seeking

The progress bar can be dragged to seek through the Reel.

- Preserves whether the video was playing before seeking.
- Automatically resumes playback after a seek if it was playing beforehand.
- Prevents the custom controls from accidentally triggering Instagram's own Reel interactions.

#### Time display

Clicking the time display switches between:

```text
0:42 / 1:15
```

and:

```text
0:42 / -0:33
```

**Default:** On

---

### Hold to 2× Speed

Provides a YouTube Shorts-style press-and-hold playback gesture.

When enabled:

1. Press and hold the mouse button on the playing Reel.
2. After the hold threshold, playback switches to `2×`.
3. A small translucent `2x` indicator appears.
4. Keep holding to remain at `2×`.
5. Release the mouse/trackpad button.
6. Playback immediately returns to the previous playback speed and continues playing.

#### Click vs hold

A short click does not activate 2× playback.

The gesture uses a hold threshold rather than treating every click as a speed change.

#### Mouse and trackpad

The feature uses Pointer Events, allowing the same interaction to work with:

- Mouse
- Trackpad
- Other pointer-compatible input

#### Playback behavior

The feature:

- Only activates on an actively playing Reel.
- Temporarily overrides the normal configured playback rate.
- Restores the playback rate that was active before the hold.
- Prevents Instagram's release/click handling from pausing the Reel after a completed hold.
- Stops the temporary 2× state if the video is paused or ended.
- Cancels appropriately when the pointer interaction is cancelled or the page loses focus.
- Avoids interfering with the custom seek controls.

**Default:** On in version `7.0.1`

---

## Playback Speed

Inres provides configurable default playback speeds:

| Speed |
|---|
| `0.5×` |
| `1×` |
| `1.25×` |
| `1.5×` |
| `2×` |

The selected speed becomes the normal playback rate for Reels.

The Hold to 2× feature is temporary: it does **not** permanently change the selected playback speed.

For example, if the selected speed is `1.5×`:

```text
Normal playback → 1.5×
        ↓
Hold → 2×
        ↓
Release → 1.5×
```

If the selected speed is `1×`:

```text
Normal playback → 1×
        ↓
Hold → 2×
        ↓
Release → 1×
```

---

## The popup

The popup is where you can turn features on/off and change the playback speed.

### Main features

- Auto-scroll Reels
- Auto Picture-in-Picture
- Background Audio
- Translucent Scrubber
- Hold to 2× Speed

### Playback preferences

The popup also contains the default Playback Speed selector.

### Experimental

The Experimental section is intentionally kept for future features.

Current text:

> More to come

---

## Settings (nothing fancy)

Inres stores its settings using Chrome's local extension storage.

The settings include:

```text
autoNext
autoPip
keepPlaying
controls
speed
holdTo2x
```

Changing a setting in the popup is immediately synchronized with open Instagram tabs.

---

## How it works under the hood

Inres uses two content-script contexts.

### `inject.js`

Runs in Chrome's **MAIN** JavaScript world at `document_start`.

It handles functionality that needs to interact directly with the Instagram page's own JavaScript environment, including:

- Page visibility/focus handling
- Background playback support
- Hold-to-2× pointer handling
- 2× playback indicator
- Temporary playback-rate changes
- PiP media-session integration
- PiP state handling

### `content.js`

Runs as the normal extension content script.

It handles:

- Settings
- Reel/video discovery
- Active Reel detection
- Auto-scroll
- Custom playback controls
- Seek bar
- Playback-speed configuration
- PiP coordination
- Popup-to-page settings synchronization

### `popup.html`

Defines the extension's popup interface.

### `popup.js`

Handles:

- Loading settings
- Updating toggle states
- Saving settings
- Playback-speed selection
- Synchronizing changes with Instagram tabs

### `popup.css`

Provides the popup's visual design.

### `content.css`

Provides styling for the custom Reel controls.

### `manifest.json`

Defines the Chrome extension configuration, content scripts, permissions, icons, and version.

---

## Where it works

Inres is designed for:

- Google Chrome
- Instagram's web interface
- Instagram Reels

The extension is intended for desktop browser use, with mouse and trackpad interactions supported by the Hold to 2× feature.

Because Instagram is a constantly changing web application, internal DOM structures and playback behavior may change over time.

---

## Permissions

Inres currently requests:

```json
"permissions": [
  "storage"
]
```

The extension uses storage to save the user's preferences.

Its content scripts run on:

```text
https://www.instagram.com/*
```

---

## Privacy

Inres does not require an external server for its core functionality.

The extension's settings are stored locally using Chrome extension storage.

The extension's functionality operates directly on the Instagram page and its HTML5 video elements.

---

## Default settings

A fresh installation uses the following defaults:

| Feature | Default |
|---|---|
| Auto-scroll Reels | Off |
| Auto Picture-in-Picture | On |
| Background Audio | On |
| Translucent Scrubber | On |
| Hold to 2× Speed | On |
| Playback Speed | 1× |

---

## Developer / local installation

### If you're developing it locally

1. Download or clone the project.
2. Open Chrome.
3. Navigate to:

```text
chrome://extensions
```

4. Enable **Developer mode**.
5. Select **Load unpacked**.
6. Select the Inres project directory.
7. Open Instagram and navigate to Reels.
8. Open the Inres popup to configure the features.

After changing extension files during development, use **Reload** on the Inres card in `chrome://extensions`.

---

## Project structure

```text
Inres/
├── manifest.json
├── popup.html
├── popup.js
├── popup.css
├── content.js
├── content.css
├── inject.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Version 7.0.1

Version `7.0.1` promotes **Hold to 2× Speed** from the Experimental feature area into the main feature list and enables it by default.

The Experimental section remains available for future functionality.

---

## What's next?

The Experimental section is reserved for future features.

> More to come.
