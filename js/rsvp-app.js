import { FONT_MAP, FONT_MONO, THEME_COLORS, GENERAL_DEFAULTS } from './core/constants.js';
import { openSettingsScreen, closeSettingsScreen } from './settings/settings-screen.js';
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
import { createPicker } from './shared/picker.js';

export function init(options = {}) {
  const signal = options.signal || new AbortController().signal;
  const onModeSwitch = options.onModeSwitch;
  const onBookLoaded = options.onBookLoaded;

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
    // Drawer panels
    panelBlue:    document.getElementById("panelBlue"),
    panelPurple:  document.getElementById("panelPurple"),
    drawerHandle: document.getElementById("drawerHandle"),
    // File
    fileInput: document.getElementById("fileInput"),
  };

  // ---------- State & Prefs ----------
  const prefs = new PrefsManager({
    storageKey: 'rsvp:prefs',
    defaults: RSVP_DEFAULTS,
    version: 1,
  });
  prefs.load();
  const generalPrefs = new PrefsManager({ storageKey: 'general:prefs', defaults: GENERAL_DEFAULTS });
  generalPrefs.load();

  const state = new RsvpState();
  const bus = new EventBus();

  // ---------- Modules ----------
  const display = new RsvpDisplay(state, prefs, els);
  const playback = new PlaybackEngine(state, prefs, bus);
  const stats = new StatsTracker(els);
  const training = new TrainingManager(prefs);
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
    const bg = getComputedStyle(document.body).getPropertyValue("--bg").trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = bg;
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

  // ---------- Controls drawer ----------
  const LEVEL_LABELS = ['Expand controls', 'Show transport', 'Collapse controls'];
  function applyControlsLevel(level) {
    const { panelBlue, panelPurple, drawerHandle } = els;
    if (panelBlue)   panelBlue.classList.toggle('is-collapsed',  level < 1);
    if (panelPurple) panelPurple.classList.toggle('is-collapsed', level < 2);
    if (drawerHandle) drawerHandle.setAttribute('aria-label', LEVEL_LABELS[level] ?? LEVEL_LABELS[0]);
    prefs.data.controlsLevel = level;
    prefs.save();
  }
  applyControlsLevel(prefs.data.controlsLevel ?? 2);
  if (els.drawerHandle) {
    els.drawerHandle.addEventListener('click', (e) => {
      e.stopPropagation();
      applyControlsLevel(((prefs.data.controlsLevel ?? 2) + 1) % 3);
    }, { signal });
  }

  // ---------- Unit cycle button ----------
  const UNIT_CYCLE = ['word', 'sentence', 'paragraph'];
  const UNIT_LABELS = { word: 'Word', sentence: 'Sent', paragraph: 'Para' };
  const unitCycleBtn = document.getElementById("unitCycleBtn");
  function applyGranularity(unit) {
    prefs.data.granularity = unit;
    prefs.save();
    if (unitCycleBtn) unitCycleBtn.textContent = UNIT_LABELS[unit] ?? unit;
    document.querySelectorAll('[data-unit]').forEach(b =>
      b.classList.toggle('is-active', b.dataset.unit === unit));
    display.updateSeek();
    display.resetContextCache();
    display.updateContext(state.currentIdx);
  }
  applyGranularity(prefs.data.granularity || 'word');
  if (unitCycleBtn) {
    unitCycleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = prefs.data.granularity || 'word';
      applyGranularity(UNIT_CYCLE[(UNIT_CYCLE.indexOf(cur) + 1) % UNIT_CYCLE.length]);
    }, { signal });
  }

  // ---------- Live settings apply callback (called from settings screen) ----------
  function onRsvpSettingChange(key, value) {
    if (key === '_resetStats') {
      stats.reset(state.playState === 'playing');
      training.reset();
      return;
    }
    prefs.data[key] = value;
    if (key === 'font') applyFont(value);
    else if (key === 'fontSize') document.documentElement.style.setProperty('--word-size', value + 'px');
    else if (key === 'chunkSize') {
      document.querySelectorAll('[data-chunk]').forEach(b =>
        b.classList.toggle('is-active', parseInt(b.dataset.chunk, 10) === value));
    }
    else if (key === 'contextEnabled') {
      if (els.contextLine) {
        els.contextLine.hidden = !value;
        if (value) display.updateContext(state.currentIdx);
      }
    }
    else if (key === 'trainingEnabled') {
      if (value) training.reset();
    }
  }

  // Open EPUB button
  const openBtn = document.getElementById("openEpubBtn");
  if (openBtn) {
    openBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      els.fileInput.click();
    }, { signal });
  }

  if (els.statusRetryBtn) {
    els.statusRetryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      els.fileInput.click();
    }, { signal });
  }

  if (els.fileInput) {
    els.fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (file) loadEpub(file);
    }, { signal });
  }

  // Mode toggle buttons
  const modeBtn = document.getElementById("modeBtn");
  if (modeBtn && onModeSwitch) {
    modeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeSettingsScreen();
      playback.pause();
      onModeSwitch("read", { fraction: getPositionFraction(), bookId: state.bookId });
    }, { signal });
  }
  const ttsModeBtn = document.getElementById("ttsModeBtn");
  if (ttsModeBtn && onModeSwitch) {
    ttsModeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeSettingsScreen();
      playback.pause();
      onModeSwitch("tts", { fraction: getPositionFraction(), bookId: state.bookId });
    }, { signal });
  }

  // Settings panel
  const settingsBtn = document.getElementById("settingsBtn");
  if (settingsBtn) {
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.body.classList.remove('show-toc');
      if (tocBtn) tocBtn.setAttribute('aria-expanded', 'false');
      openSettingsScreen({
        initialTab: 'rsvp',
        currentMode: 'rsvp',
        onGeneralChange(key, value) {
          generalPrefs.data[key] = value;
          if (key === 'theme') applyTheme(value);
        },
        onRsvpChange: onRsvpSettingChange,
      });
      settingsBtn.setAttribute('aria-expanded', 'true');
    }, { signal });
  }

  // TOC panel
  const tocBtn = document.getElementById("tocBtn");
  const tocList = document.getElementById("tocList");

  if (tocBtn) {
    tocBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const show = document.body.classList.toggle('show-toc');
      tocBtn.setAttribute('aria-expanded', show);
    }, { signal });
  }

  // Backdrop closes TOC
  const backdrop = document.getElementById("backdrop");
  if (backdrop) {
    backdrop.addEventListener('click', () => {
      document.body.classList.remove('show-toc');
      if (tocBtn) tocBtn.setAttribute('aria-expanded', 'false');
      closeSettingsScreen();
    }, { signal });
  }

  function populateTocList() {
    if (!tocList) return;
    tocList.innerHTML = '';
    if (!state.chapters.length) {
      const empty = document.createElement('div');
      empty.className = 'reader-toc-empty';
      empty.textContent = 'Load an EPUB to see chapters.';
      tocList.appendChild(empty);
      return;
    }
    state.chapters.forEach((ch) => {
      const btn = document.createElement('button');
      btn.className = 'reader-toc-item';
      btn.textContent = ch.title;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.playState === 'playing') playback.pause();
        else if (state.playState === 'countdown') playback.cancelCountdown();
        playback.seekTo(ch.tokenIdx);
        document.body.classList.remove('show-toc');
        if (tocBtn) tocBtn.setAttribute('aria-expanded', 'false');
      }, { signal });
      tocList.appendChild(btn);
    });
  }

  // ---------- Pickers ----------
  let wpmPicker;

  wpmPicker = createPicker({
    stripId: "wpmStrip", trackId: "wpmTrack", valueId: "wpmValue",
    min: 100, max: 800, step: 25, majorEvery: 100,
    initial: prefs.data.wpm,
    onChange: (v) => { prefs.data.wpm = v; prefs.save(); display.updateSeek(); },
  });

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
    populateTocList();

    state.currentIdx = 0;
    state.rampRemaining = 0;
    state.manuallySeeked = false;
    display.resetContextCache();
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

      const bookTitle = (book.packaging && book.packaging.metadata && book.packaging.metadata.title)
        || file.name.replace(/\.epub$/i, '');

      const { text, chapters: chapterMeta } = await extractPlainText(book, (i, total) => {
        els.statusMsg.textContent = "Parsing\u2026 " + i + " / " + total;
      });
      if (!text || text.length < 32) {
        throw new Error("No readable text found in this EPUB (it may be image-only or DRM-protected).");
      }
      loadText(text, chapterMeta);
      const bookTitleEl = document.getElementById("bookTitle");
      if (bookTitleEl) bookTitleEl.textContent = bookTitle;
      if (onBookLoaded) onBookLoaded({ buffer, fileName: file.name, bookId: state.bookId || file.name });
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
  applyTheme(generalPrefs.data.theme);
  applyFont(prefs.data.font);
  document.documentElement.style.setProperty("--word-size", prefs.data.fontSize + "px");

  // Context line visibility
  if (els.contextLine) els.contextLine.hidden = !prefs.data.contextEnabled;

  // OS preference fallback
  if (!localStorage.getItem("general:prefs")) {
    if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      generalPrefs.data.theme = "light";
      generalPrefs.save();
      applyTheme("light");
    }
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

  // ---------- Handle ----------
  function getPositionFraction() {
    if (!state.totalWords) return 0;
    return state.wordOrdinalAt(state.currentIdx) / state.totalWords;
  }

  return {
    teardown() {
      closeSettingsScreen();
      playback.clearPending();
      playback.cancelCountdown();
      stats.destroy();
    },
    getPositionFraction,
    getBookId() { return state.bookId; },
    isBookLoaded() { return state.isEpubLoaded; },
    seekFraction(f) {
      if (!state.totalWords) return;
      const ord = Math.round(f * (state.totalWords - 1));
      playback.seekTo(state.ordinalToIdx(ord));
    },
    loadFromBuffer(buffer, fileName) {
      const file = new File([buffer], fileName, { type: "application/epub+zip" });
      return loadEpub(file);
    },
  };
}
