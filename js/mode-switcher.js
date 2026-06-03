import { readerTemplate } from './reader/template.js';
import { rsvpTemplate } from './rsvp/template.js';
import { ttsTemplate } from './tts/template.js';
import { closeSettingsScreen } from './settings/settings-screen.js';

const READER_BODY_CLASSES = [
  'chrome-hidden', 'loading', 'error', 'show-toc', 'show-search', 'show-bookmarks',
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
let cachedBook = null; // { buffer: ArrayBuffer, fileName: string }

function clearBodyClasses() {
  document.body.classList.remove(
    ...READER_BODY_CLASSES,
    ...RSVP_BODY_CLASSES,
    ...TTS_BODY_CLASSES,
    ...THEME_CLASSES,
  );
}

function onBookLoaded({ buffer, fileName, bookId }) {
  cachedBook = { buffer: buffer.slice(0), fileName };
}

async function switchMode(targetMode, posInfo) {
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
    document.body.classList.add('chrome-hidden');
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
  // The position is handed straight to loadFromBuffer, which only resolves once
  // the target mode has finished laying out (Reader/TTS paginate/segment inside
  // a rAF) AND applied the position. This makes the seek deterministic: there is
  // no rAF + setTimeout(100ms) guess racing against pagination, and no second
  // restore from localStorage to disagree with — a single applier after layout.
  if (posInfo && cachedBook) {
    try {
      await currentHandle.loadFromBuffer(
        cachedBook.buffer.slice(0), cachedBook.fileName, posInfo.pos || null);
    } catch (e) {
      console.warn('switcher:transfer', e);
    }
  }
}

// ---------- Boot ----------
const modeParam = urlParams.get('mode');
const initialMode = modeParam === 'rsvp' ? 'rsvp' : modeParam === 'tts' ? 'tts' : 'read';
switchMode(initialMode);
