import { FONT_MAP, FONT_MONO, THEME_COLORS } from './core/constants.js';
import { PrefsManager } from './core/prefs.js';
import { EventBus } from './core/events.js';
import { extractPlainText } from './epub/extractor.js';
import { RSVP_DEFAULTS } from './rsvp/constants.js';
import { RsvpState } from './rsvp/state.js';
import { tokenize } from './rsvp/tokenizer.js';
import { PlaybackEngine } from './rsvp/playback.js';
import { RsvpDisplay } from './rsvp/display.js';
import { RsvpInput } from './rsvp/input.js';
import { StatsTracker } from './rsvp/stats.js';
import { TrainingManager } from './rsvp/training.js';
import { RsvpChapters } from './rsvp/chapters.js';
import { createPicker } from './shared/picker.js';

// ---------- Abort signal ----------
const controller = new AbortController();
const { signal } = controller;

// ---------- DOM elements ----------
const els = {
  // Word display
  wordEl:      document.getElementById("word"),
  beforeEl:    document.getElementById("before"),
  orpEl:       document.getElementById("orp"),
  afterEl:     document.getElementById("after"),
  contextLine: document.getElementById("contextLine"),
  wpmToast:    document.getElementById("wpmToast"),
  readerWrap:  document.getElementById("readerWrap"),
  // Status
  statusMsg:      document.getElementById("statusMsg"),
  statusRetryBtn: document.getElementById("statusRetryBtn"),
  // Stats
  statWords: document.getElementById("statWords"),
  statTime:  document.getElementById("statTime"),
  statAvg:   document.getElementById("statAvg"),
  // Seek
  seekSlider:   document.getElementById("seekSlider"),
  seekReadout:  document.getElementById("seekReadout"),
  stepPrevBtn:  document.getElementById("stepPrev"),
  stepNextBtn:  document.getElementById("stepNext"),
  playPauseBtn: document.getElementById("playPause"),
  playLabel:    document.getElementById("playLabel"),
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  // Chapter nav
  chapterNav: document.getElementById("chapterNav"),
  chSelect:   document.getElementById("chSelect"),
  chPrevBtn:  document.getElementById("chPrev"),
  chNextBtn:  document.getElementById("chNext"),
  // File
  epubFileInput: document.getElementById("epubFileInput"),
};

// ---------- State & Prefs ----------
const prefs = new PrefsManager({
  storageKey: 'rsvp:prefs',
  defaults: RSVP_DEFAULTS,
  version: 1,
});
prefs.load();

const state = new RsvpState();
const bus = new EventBus();

// ---------- Modules ----------
const display = new RsvpDisplay(state, prefs, els);
const playback = new PlaybackEngine(state, prefs, bus);
const stats = new StatsTracker(els);
const training = new TrainingManager(prefs);
const chapters = new RsvpChapters(state, els);
const input = new RsvpInput(state, prefs, playback, display, bus, els, signal);

// ---------- Bus wiring ----------
bus.on('renderChunk', (chunk, pivotPos) => {
  if (prefs.data.chunkSize > 1) {
    display.renderChunk(chunk, pivotPos);
  } else {
    display.render(chunk[0].token);
  }
  const pivotIdx = chunk[Math.min(Math.floor(((prefs.data.chunkSize || 1) - 1) / 2), chunk.length - 1)].idx;
  display.updateContext(pivotIdx);
});

bus.on('renderWord', (idx) => display.renderWordAt(idx));
bus.on('renderCountdown', (num) => display.renderCountdown(num));
bus.on('updateSeek', () => display.updateSeek());
bus.on('playStart', () => stats.onPlayStart());
bus.on('playStop', () => stats.onPlayStop());
bus.on('wordsRead', (count) => {
  stats.addWords(count);
  training.onWordsRead(count, (inc) => {
    const newWpm = Math.min(prefs.data.wpm + inc, prefs.data.trainingCeiling);
    if (newWpm > prefs.data.wpm) {
      prefs.data.wpm = newWpm;
      prefs.save();
      bus.emit('wpmChanged', newWpm);
      display.showToast(newWpm + " WPM");
      if (wpmPicker) wpmPicker.scrollTo(newWpm);
    }
  });
});

bus.on('wpmChanged', (val) => {
  document.getElementById("wpmValue").textContent = val;
  if (wpmPicker) wpmPicker.scrollTo(val);
  display.updateSeek();
});

// ---------- Theme ----------
function applyTheme(name) {
  document.body.classList.remove("theme-dark", "theme-light", "theme-sepia", "theme-oled");
  if (name !== "dark") document.body.classList.add("theme-" + name);
  prefs.data.theme = name;
  prefs.save();
  const bg = getComputedStyle(document.body).getPropertyValue("--bg").trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = bg;
  document.querySelectorAll("[data-theme]").forEach(b =>
    b.classList.toggle("is-active", b.dataset.theme === name));
}
bus.on('themeChange', applyTheme);

// ---------- Font ----------
const FONT_STACKS = {
  sans: FONT_MAP.sans,
  serif: FONT_MAP.serif,
  mono: FONT_MONO,
  dyslexic: FONT_MAP.dyslexic,
};

function applyFont(name) {
  document.documentElement.style.setProperty("--word-font", FONT_STACKS[name] || FONT_STACKS.mono);
  prefs.data.font = name;
  prefs.save();
  document.querySelectorAll("[data-font]").forEach(b =>
    b.classList.toggle("is-active", b.dataset.font === name));
}
bus.on('fontChange', applyFont);

// ---------- Settings toggles ----------
function bindToggle(id, prefKey) {
  const el = document.getElementById(id);
  if (!el) return;
  el.checked = !!prefs.data[prefKey];
  el.addEventListener('change', (e) => {
    prefs.data[prefKey] = e.target.checked;
    prefs.save();
    if (prefKey === 'contextEnabled') {
      const ctx = els.contextLine;
      if (ctx) {
        ctx.hidden = !e.target.checked;
        if (e.target.checked) display.updateContext(state.currentIdx);
      }
    }
    if (prefKey === 'trainingEnabled') {
      const opts = document.getElementById("trainingOpts");
      if (opts) opts.hidden = !e.target.checked;
      if (e.target.checked) {
        training.reset();
        requestAnimationFrame(() => {
          if (trainIncPicker) trainIncPicker.relayout();
          if (trainIntPicker) trainIntPicker.relayout();
          if (trainCeilPicker) trainCeilPicker.relayout();
        });
      }
    }
  }, { signal });
}

bindToggle("startPausedToggle", "startPaused");
bindToggle("countdownToggle", "countdownEnabled");
bindToggle("contextToggle", "contextEnabled");
bindToggle("autoPauseToggle", "autoPauseEnabled");
bindToggle("trainingToggle", "trainingEnabled");

// Reset stats button
const resetBtn = document.getElementById("resetStatsBtn");
if (resetBtn) {
  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    stats.reset(state.playState === 'playing');
    training.reset();
  }, { signal });
}

// Open EPUB button
const openBtn = document.getElementById("openEpubBtn");
if (openBtn) {
  openBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    els.epubFileInput.click();
  }, { signal });
}

if (els.statusRetryBtn) {
  els.statusRetryBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    els.epubFileInput.click();
  }, { signal });
}

if (els.epubFileInput) {
  els.epubFileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (file) loadEpub(file);
  }, { signal });
}

// ---------- Pickers ----------
let wpmPicker, fontSizePicker, lenPicker, commaPicker, periodPicker, paraPicker;
let trainIncPicker, trainIntPicker, trainCeilPicker;

wpmPicker = createPicker({
  stripId: "wpmStrip", trackId: "wpmTrack", valueId: "wpmValue",
  min: 100, max: 800, step: 25, majorEvery: 100,
  initial: prefs.data.wpm,
  onChange: (v) => { prefs.data.wpm = v; prefs.save(); display.updateSeek(); },
});

fontSizePicker = createPicker({
  stripId: "fontSizeStrip", trackId: "fontSizeTrack", valueId: "fontSizeValue",
  min: 24, max: 96, step: 4, majorEvery: 16,
  initial: prefs.data.fontSize,
  onChange: (v) => {
    prefs.data.fontSize = v;
    prefs.save();
    document.documentElement.style.setProperty("--word-size", v + "px");
  },
});

lenPicker = createPicker({
  stripId: "lenStrip", trackId: "lenTrack", valueId: "lenValue",
  min: 0, max: 100, step: 5, majorEvery: 25,
  initial: prefs.data.lengthStrength,
  onChange: (v) => { prefs.data.lengthStrength = v; prefs.save(); },
});

commaPicker = createPicker({
  stripId: "commaStrip", trackId: "commaTrack", valueId: "commaValue",
  min: 0, max: 200, step: 10, majorEvery: 50,
  initial: prefs.data.commaPause,
  onChange: (v) => { prefs.data.commaPause = v; prefs.save(); },
});

periodPicker = createPicker({
  stripId: "periodStrip", trackId: "periodTrack", valueId: "periodValue",
  min: 0, max: 300, step: 10, majorEvery: 100,
  initial: prefs.data.periodPause,
  onChange: (v) => { prefs.data.periodPause = v; prefs.save(); },
});

paraPicker = createPicker({
  stripId: "paraStrip", trackId: "paraTrack", valueId: "paraValue",
  min: 0, max: 400, step: 10, majorEvery: 100,
  initial: prefs.data.paraPause,
  onChange: (v) => { prefs.data.paraPause = v; prefs.save(); },
});

trainIncPicker = createPicker({
  stripId: "trainIncStrip", trackId: "trainIncTrack", valueId: "trainIncValue",
  min: 5, max: 50, step: 5, majorEvery: 10,
  initial: prefs.data.trainingIncrement,
  onChange: (v) => { prefs.data.trainingIncrement = v; prefs.save(); },
});

trainIntPicker = createPicker({
  stripId: "trainIntStrip", trackId: "trainIntTrack", valueId: "trainIntValue",
  min: 100, max: 2000, step: 100, majorEvery: 500,
  initial: prefs.data.trainingInterval,
  onChange: (v) => { prefs.data.trainingInterval = v; prefs.save(); },
});

trainCeilPicker = createPicker({
  stripId: "trainCeilStrip", trackId: "trainCeilTrack", valueId: "trainCeilValue",
  min: 200, max: 800, step: 25, majorEvery: 100,
  initial: prefs.data.trainingCeiling,
  onChange: (v) => { prefs.data.trainingCeiling = v; prefs.save(); },
});

// Relayout pickers inside <details> on first open
const settingsEl = document.getElementById("settings");
if (settingsEl) {
  settingsEl.addEventListener("toggle", () => {
    if (settingsEl.open) requestAnimationFrame(() => {
      lenPicker.relayout();
      commaPicker.relayout();
      periodPicker.relayout();
      paraPicker.relayout();
      fontSizePicker.relayout();
      if (prefs.data.trainingEnabled) {
        trainIncPicker.relayout();
        trainIntPicker.relayout();
        trainCeilPicker.relayout();
      }
    });
  }, { signal });
}

// ---------- EPUB loading ----------
function loadText(text, chapterMeta) {
  const result = tokenize(text);
  state.loadTokens(result);

  state.chapters = (chapterMeta || []).map(ch => ({
    title: ch.title,
    tokenIdx: ch.wordOffset < state.wordTokenIndices.length
      ? state.wordTokenIndices[ch.wordOffset]
      : state.tokens.length - 1,
  }));
  state.isEpubLoaded = state.chapters.length > 0;
  chapters.update();

  state.currentIdx = 0;
  state.rampRemaining = 0;
  state.manuallySeeked = false;
  display.resetSentenceCache();
  playback.clearPending();
  stats.reset(false);
  training.reset();

  if (prefs.data.startPaused) {
    state.setPlayState('paused');
    if (state.tokens.length) display.render(state.tokens[0]);
    display.updateContext(0);
    display.updateSeek();
  } else {
    state.setPlayState('playing');
    stats.onPlayStart();
    playback.play();
  }
}

async function loadEpub(file) {
  playback.clearPending();
  state.rampRemaining = 0;
  state.setPlayState('loading');
  els.statusMsg.classList.remove("error");
  els.statusRetryBtn.hidden = true;
  els.statusMsg.textContent = "Loading " + file.name + "\u2026";

  let book = null;
  try {
    if (typeof ePub !== "function") {
      throw new Error("EPUB library failed to load. Check your connection.");
    }
    const buffer = await file.arrayBuffer();
    book = ePub(buffer);
    await book.ready;

    const { text, chapters: chapterMeta } = await extractPlainText(book, (i, total) => {
      els.statusMsg.textContent = "Parsing\u2026 " + i + " / " + total;
    });
    if (!text || text.length < 32) {
      throw new Error("No readable text found in this EPUB (it may be image-only or DRM-protected).");
    }
    loadText(text, chapterMeta);
  } catch (err) {
    console.error("EPUB load failed:", err);
    state.setPlayState('error');
    els.statusMsg.classList.add("error");
    els.statusMsg.textContent = err && err.message ? err.message : "Couldn't read that file.";
    els.statusRetryBtn.hidden = false;
  } finally {
    if (book && typeof book.destroy === "function") {
      try { book.destroy(); } catch (_) {}
    }
  }
}

// ---------- Apply saved prefs ----------
applyTheme(prefs.data.theme);
applyFont(prefs.data.font);
document.documentElement.style.setProperty("--word-size", prefs.data.fontSize + "px");

// Sync chunk/granularity buttons
document.querySelectorAll("[data-chunk]").forEach(b =>
  b.classList.toggle("is-active", parseInt(b.dataset.chunk, 10) === prefs.data.chunkSize));
document.querySelectorAll("[data-unit]").forEach(b =>
  b.classList.toggle("is-active", b.dataset.unit === prefs.data.granularity));

// Context line visibility
if (els.contextLine) els.contextLine.hidden = !prefs.data.contextEnabled;

// Training opts visibility
const trainingOpts = document.getElementById("trainingOpts");
if (trainingOpts) trainingOpts.hidden = !prefs.data.trainingEnabled;

// OS preference fallback
if (!localStorage.getItem("rsvp:prefs")) {
  if (window.matchMedia("(prefers-color-scheme: light)").matches) applyTheme("light");
}

// ---------- Sample text ----------
const sampleText = `It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.

However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.

"My dear Mr. Bennet," said his lady to him one day, "have you heard that Netherfield Park is let at last?"

Mr. Bennet replied that he had not.

"But it is," returned she; "for Mrs. Long has just been here, and she told me all about it."

Mr. Bennet made no answer.

"Do you not want to know who has taken it?" cried his wife impatiently.

"You want to tell me, and I have no objection to hearing it."

This was invitation enough.

"Why, my dear, you must know, Mrs. Long says that Netherfield is taken by a young man of large fortune from the north of England; that he came down on Monday in a chaise and four to see the place, and was so much delighted with it that he agreed with Mr. Morris immediately; that he is to take possession before Michaelmas, and some of his servants are to be in the house by the end of next week."

"What is his name?"

"Bingley."

"Is he married or single?"

"Oh! Single, my dear, to be sure! A single man of large fortune; four or five thousand a year. What a fine thing for our girls!"`;

// ---------- Init ----------
loadText(sampleText, []);
