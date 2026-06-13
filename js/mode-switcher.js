import { readerTemplate } from './reader/template.js';
import { rsvpTemplate } from './rsvp/template.js';
import { ttsTemplate } from './tts/template.js';
import { closeSettingsScreen } from './settings/settings-screen.js';
import * as perf from './core/perf.js';
import { acceptString } from './formats/registry.js';
import './formats/index.js'; // ensure all adapters are registered

const READER_BODY_CLASSES = [
  'chrome-hidden', 'loading', 'error', 'welcome', 'show-toc', 'show-search', 'show-bookmarks',
  'images-off', 'selection-on', 'layout-scroll',
];
const RSVP_BODY_CLASSES = [
  'rsvp', 'paused', 'loading', 'error', 'fs-hide-controls', 'show-toc', 'show-bookmarks',
];
const TTS_BODY_CLASSES = [
  'tts', 'loading', 'error', 'show-toc', 'tts-show-voice', 'tts-playing', 'show-bookmarks',
];
const THEME_CLASSES = ['theme-dark', 'theme-light', 'theme-sepia', 'theme-oled'];

const appEl = document.getElementById('app');
const urlParams = new URLSearchParams(location.search);

let currentMode = null;
let currentHandle = null;
let currentController = null;
let cachedSession = null; // BookSession shared across modes (built once per book)

function clearBodyClasses() {
  document.body.classList.remove(
    ...READER_BODY_CLASSES,
    ...RSVP_BODY_CLASSES,
    ...TTS_BODY_CLASSES,
    ...THEME_CLASSES,
  );
}

// Cache the extracted, mode-agnostic session so a later mode switch reuses it
// instead of re-parsing. When a genuinely different book is opened, dispose the
// previous session's image blob URLs first.
function onBookLoaded({ session }) {
  if (!session || session === cachedSession) return;
  // A mode switch re-passes the SAME session object (no dispose). A genuinely
  // new load passes a different object — release the previous one's blob URLs.
  if (cachedSession) {
    try { cachedSession.dispose(); } catch (e) { console.warn('switcher:dispose', e); }
  }
  cachedSession = session;
}

async function switchMode(targetMode, posInfo) {
  const fromMode = currentMode;
  perf.mark("mode-switch");
  // Tear down current mode
  closeSettingsScreen();
  if (currentHandle) {
    try { currentHandle.teardown(); } catch (e) { console.warn('switcher:teardown', e); }
    currentHandle = null;
  }
  if (currentController) {
    currentController.abort();
    currentController = null;
  }
  clearBodyClasses();
  appEl.innerHTML = '';
  currentMode = null;

  // Update URL without reload
  const url = new URL(location.href);
  url.searchParams.set('mode', targetMode);
  history.replaceState(null, '', url);

  // Set up new mode
  currentController = new AbortController();
  const { signal } = currentController;

  if (targetMode === 'rsvp') {
    document.body.classList.add('rsvp', 'paused');
    appEl.innerHTML = rsvpTemplate();
    const mod = await import('./rsvp-app.js');
    currentHandle = mod.init({
      signal,
      onModeSwitch: (mode, info) => switchMode(mode, info),
      onBookLoaded,
    });
  } else if (targetMode === 'tts') {
    document.body.classList.add('tts');
    appEl.innerHTML = ttsTemplate();
    const mod = await import('./tts-app.js');
    currentHandle = mod.init({
      signal,
      onModeSwitch: (mode, info) => switchMode(mode, info),
      onBookLoaded,
    });
  } else {
    appEl.innerHTML = readerTemplate();
    const mod = await import('./reader-app.js');
    currentHandle = mod.init({
      signal,
      onModeSwitch: (mode, info) => switchMode(mode, info),
      onBookLoaded,
    });
  }

  currentMode = targetMode;

  // Transfer book and position. Both modes speak the same canonical position
  // object (section href + word ordinal), so the handoff is word-exact rather
  // than rounded through a whole-book fraction.
  //
  // The position is handed straight to loadFromSession, which reuses the cached
  // BookSession (no re-parse) and only resolves once the target mode has finished
  // laying out (Reader/TTS paginate/segment inside a rAF) AND applied the
  // position. This makes the seek deterministic: there is
  // no rAF + setTimeout(100ms) guess racing against pagination, and no second
  // restore from localStorage to disagree with — a single applier after layout.
  if (posInfo && cachedSession) {
    try {
      await currentHandle.loadFromSession(cachedSession, posInfo.pos || null);
    } catch (e) {
      console.warn('switcher:transfer', e);
    }
  }
  perf.measure("mode-switch", { from: fromMode, to: targetMode });
}

// ---------- Boot ----------
// Drive the file-input accept attribute from the registry so it stays in sync
// as new format adapters are registered (formats/index.js ran at import time).
const fileInput = document.getElementById('fileInput');
if (fileInput) fileInput.setAttribute('accept', acceptString());

const modeParam = urlParams.get('mode');
const initialMode = modeParam === 'rsvp' ? 'rsvp' : modeParam === 'tts' ? 'tts' : 'read';
switchMode(initialMode);
