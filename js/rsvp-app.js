import { FONT_MAP, FONT_MONO, THEME_COLORS, GENERAL_DEFAULTS, ALL_THEME_NAMES } from './core/constants.js';
import { openSettingsScreen, closeSettingsScreen } from './settings/settings-screen.js';
import { BookmarkManager } from './core/bookmarks.js';
import { initBookmarksPanel } from './bookmarks/panel.js';
import { PrefsManager } from './core/prefs.js';
import { EventBus } from './core/events.js';
import { BookSession, countWords } from './core/book-session.js';
import { RSVP_DEFAULTS } from './rsvp/constants.js';
import { RsvpState } from './rsvp/state.js';
import { tokenize } from './rsvp/tokenizer.js';
import { PlaybackEngine } from './rsvp/playback.js';
import { RsvpDisplay } from './rsvp/display.js';
import { RsvpInput } from './rsvp/input.js';
import { StatsTracker } from './rsvp/stats.js';
import { TrainingManager } from './rsvp/training.js';
import { createPicker } from './shared/picker.js';
import { buildPosition, resolvePosition } from './core/position.js';
import * as perf from './core/perf.js';

// Convert extractSections() output to the plain-text format the tokenizer expects.
// Using the same extractor as Reader guarantees identical word lists and exact position transfer.
function sectionsToText(sections) {
  const parts = [];
  const chapters = [];
  let wordOffset = 0;
  for (const sec of sections) {
    const blockTexts = sec.blocks.map(b => b.text).filter(t => t && t.trim());
    if (!blockTexts.length) continue;
    const heading = sec.blocks.find(b => /^h[1-6]$/.test(b.type));
    chapters.push({ title: heading ? heading.text : '', wordOffset, href: sec.href || '' });
    const secText = blockTexts.join('\n\n');
    wordOffset += countWords(secText);
    parts.push(secText);
  }
  return { text: parts.join('\n\n'), chapters };
}

export function init(options = {}) {
  const signal = options.signal || new AbortController().signal;
  const onModeSwitch = options.onModeSwitch;
  const onBookLoaded = options.onBookLoaded;
  const urlParams = new URLSearchParams(location.search);

  // ---------- DOM elements ----------
  const els = {
    // Word display
    wordEl:      document.getElementById("word"),
    beforeEl:    document.getElementById("before"),
    orpEl:       document.getElementById("orp"),
    afterEl:     document.getElementById("after"),
    contextAbove: document.getElementById("contextAbove"),
    contextBelow: document.getElementById("contextBelow"),
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

  // ---------- Bookmarks ----------
  const bookmarkManager = new BookmarkManager();
  const bmPanel = initBookmarksPanel(
    { panelEl: document.getElementById('bookmarksPanel'), listEl: document.getElementById('bmList'), addBtnEl: document.getElementById('bmAddBtn') },
    signal
  );
  bmPanel.setBook(bookmarkManager);

  function getRsvpBookmarkContext() {
    if (!state.tokens.length) return null;
    const pos = getCanonicalPosition();
    const fraction = pos ? pos.f : 0;
    let chapterLabel = '';
    if (state.chapters.length) {
      for (let i = state.chapters.length - 1; i >= 0; i--) {
        if (state.chapters[i].tokenIdx <= state.currentIdx) { chapterLabel = state.chapters[i].title; break; }
      }
    }
    const words = [];
    for (let i = state.currentIdx; i < state.tokens.length && words.length < 15; i++) {
      const tok = state.tokens[i];
      if (tok && tok !== '\n') words.push(tok);
    }
    return { fraction, chapterLabel, text: words.join(' ').slice(0, 120), position: pos };
  }

  function navigateRsvpToBookmark(item) {
    if (state.playState === 'playing') playback.pause();
    else if (state.playState === 'countdown') playback.cancelCountdown();
    if (!state.totalWords) return;
    if (item.position) applyCanonicalPosition(item.position);
    else playback.seekTo(state.ordinalToIdx(Math.round((item.fraction || 0) * (state.totalWords - 1))));
  }

  bmPanel.setCallbacks({
    getContext: getRsvpBookmarkContext,
    onNavigate: navigateRsvpToBookmark,
    closePanel: () => { document.body.classList.remove('show-bookmarks'); const b = document.getElementById('bookmarksBtn'); if (b) b.setAttribute('aria-expanded', 'false'); },
  });

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
    document.body.classList.remove(...ALL_THEME_NAMES.map(t => `theme-${t}`));
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
      document.body.classList.toggle('context-page', !!value);
      display.resetContextCache();
      display.updateContext(state.currentIdx);
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
      savePosition();
      onModeSwitch("read", { pos: getCanonicalPosition(), bookId: state.bookId });
    }, { signal });
  }
  const ttsModeBtn = document.getElementById("ttsModeBtn");
  if (ttsModeBtn && onModeSwitch) {
    ttsModeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeSettingsScreen();
      playback.pause();
      savePosition();
      onModeSwitch("tts", { pos: getCanonicalPosition(), bookId: state.bookId });
    }, { signal });
  }

  // Search panel
  const searchBtn = document.getElementById("searchBtn");
  const searchInput = document.getElementById("searchInput");
  const searchResults = document.getElementById("searchResults");
  let _rsvpSearchCache = null;

  function buildRsvpSearchCache() {
    if (_rsvpSearchCache) return _rsvpSearchCache;
    let text = "";
    const wordCharStart = [];
    for (let i = 0; i < state.wordTokenIndices.length; i++) {
      wordCharStart.push(text.length);
      text += state.tokens[state.wordTokenIndices[i]] + " ";
    }
    _rsvpSearchCache = { text, wordCharStart };
    return _rsvpSearchCache;
  }

  function runRsvpSearch(query) {
    if (!searchResults) return;
    searchResults.innerHTML = "";
    if (!query || query.length < 2 || !state.wordTokenIndices.length) {
      if (query && query.length >= 2)
        searchResults.innerHTML = '<div class="reader-search-empty">No results</div>';
      return;
    }
    const { text, wordCharStart } = buildRsvpSearchCache();
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    const hits = [];
    let pos = 0;
    while ((pos = lower.indexOf(q, pos)) !== -1 && hits.length < 200) {
      hits.push(pos);
      pos += q.length;
    }
    if (!hits.length) {
      searchResults.innerHTML = '<div class="reader-search-empty">No results</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    hits.forEach((charOff) => {
      let wi = 0;
      for (let j = 0; j < wordCharStart.length; j++) {
        if (wordCharStart[j] <= charOff) wi = j;
        else break;
      }
      const snippetStart = Math.max(0, charOff - 40);
      const snippetEnd = Math.min(text.length, charOff + query.length + 40);
      const before = (snippetStart > 0 ? "…" : "") + text.slice(snippetStart, charOff);
      const match = text.slice(charOff, charOff + query.length);
      const after = text.slice(charOff + query.length, snippetEnd) + (snippetEnd < text.length ? "…" : "");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "reader-search-result";
      btn.appendChild(document.createTextNode(before));
      const mark = document.createElement("mark");
      mark.textContent = match;
      btn.appendChild(mark);
      btn.appendChild(document.createTextNode(after));
      btn.addEventListener("click", () => {
        if (state.playState === 'playing') playback.pause();
        else if (state.playState === 'countdown') playback.cancelCountdown();
        playback.seekTo(state.ordinalToIdx(wi));
        document.body.classList.remove('show-search');
        if (searchBtn) searchBtn.setAttribute('aria-expanded', 'false');
      });
      frag.appendChild(btn);
    });
    searchResults.appendChild(frag);
  }

  if (searchBtn) {
    searchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = document.body.classList.contains('show-search');
      document.body.classList.remove('show-toc', 'show-search');
      if (tocBtn) tocBtn.setAttribute('aria-expanded', 'false');
      closeSettingsScreen();
      if (!isOpen) {
        document.body.classList.add('show-search');
        searchBtn.setAttribute('aria-expanded', 'true');
        if (searchInput) { searchInput.value = ''; searchInput.focus(); }
        if (searchResults) searchResults.innerHTML = '';
      } else {
        searchBtn.setAttribute('aria-expanded', 'false');
      }
    }, { signal });
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => runRsvpSearch(e.target.value.trim()), { signal });
  }

  // Settings panel
  const settingsBtn = document.getElementById("settingsBtn");
  if (settingsBtn) {
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.body.classList.remove('show-toc', 'show-search');
      if (tocBtn) tocBtn.setAttribute('aria-expanded', 'false');
      if (searchBtn) searchBtn.setAttribute('aria-expanded', 'false');
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
      document.body.classList.remove('show-search', 'show-bookmarks');
      if (searchBtn) searchBtn.setAttribute('aria-expanded', 'false');
      const bBtn = document.getElementById('bookmarksBtn');
      if (bBtn) bBtn.setAttribute('aria-expanded', 'false');
    }, { signal });
  }

  // Bookmarks panel
  const bookmarksBtn = document.getElementById('bookmarksBtn');
  if (bookmarksBtn) {
    bookmarksBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = document.body.classList.contains('show-bookmarks');
      document.body.classList.remove('show-toc', 'show-search', 'show-bookmarks');
      if (tocBtn) tocBtn.setAttribute('aria-expanded', 'false');
      if (searchBtn) searchBtn.setAttribute('aria-expanded', 'false');
      closeSettingsScreen();
      if (!isOpen) {
        document.body.classList.add('show-bookmarks');
        bookmarksBtn.setAttribute('aria-expanded', 'true');
        bmPanel.render();
      } else {
        bookmarksBtn.setAttribute('aria-expanded', 'false');
      }
    }, { signal });
  }

  // Backdrop closes all panels
  const backdrop = document.getElementById("backdrop");
  if (backdrop) {
    backdrop.addEventListener('click', () => {
      document.body.classList.remove('show-toc', 'show-search', 'show-bookmarks');
      if (tocBtn) tocBtn.setAttribute('aria-expanded', 'false');
      if (searchBtn) searchBtn.setAttribute('aria-expanded', 'false');
      if (bookmarksBtn) bookmarksBtn.setAttribute('aria-expanded', 'false');
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
    const result = perf.time("rsvp:tokenize", () => tokenize(text));
    state.loadTokens(result);
    _rsvpSearchCache = null;

    state.chapters = (chapterMeta || []).map(ch => ({
      title: ch.title,
      href: ch.href || '',
      wordOffset: ch.wordOffset,
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

  // Build the mode-agnostic session once, then derive RSVP's plain-text stream
  // from its sections. A mode switch reuses the session (loadFromSession).
  async function loadEpub(file, pos) {
    playback.clearPending();
    state.rampRemaining = 0;
    state.setPlayState('loading');
    els.statusMsg.classList.remove("error");
    els.statusRetryBtn.hidden = true;
    els.statusMsg.textContent = "Loading " + file.name + "\u2026";

    try {
      const buffer = await file.arrayBuffer();
      const session = await perf.timeAsync("rsvp:extract", () =>
        BookSession.fromBuffer(buffer, file.name, urlParams.get('id'), (msg) => {
          els.statusMsg.textContent = msg;
        }));
      await loadFromSession(session, pos);
    } catch (err) {
      showLoadError(err);
    }
  }

  async function loadFromSession(session, pos) {
    try {
      const { text, chapters: chapterMeta } = perf.time("rsvp:sectionsToText", () => sectionsToText(session.sections));
      if (!text || text.length < 32) {
        throw new Error("No readable text found in this EPUB (it may be image-only or DRM-protected).");
      }
      state.bookId = session.bookId;
      bookmarkManager.setBook(state.bookId);
      loadText(text, chapterMeta);
      // A handed-off position is the single source of truth; otherwise fall back
      // to the persisted position. Never both (that was a race).
      if (pos) applyCanonicalPosition(pos);
      else restorePosition();
      const bookTitleEl = document.getElementById("bookTitle");
      if (bookTitleEl) bookTitleEl.textContent = session.title || session.bookId;
      if (onBookLoaded) onBookLoaded({ session });
    } catch (err) {
      showLoadError(err);
    }
  }

  function showLoadError(err) {
    console.error("EPUB load failed:", err);
    state.setPlayState('error');
    els.statusMsg.classList.add("error");
    els.statusMsg.textContent = err && err.message ? err.message : "Couldn't read that file.";
    els.statusRetryBtn.hidden = false;
  }

  // ---------- Apply saved prefs ----------
  applyTheme(generalPrefs.data.theme);
  applyFont(prefs.data.font);
  document.documentElement.style.setProperty("--word-size", prefs.data.fontSize + "px");

  document.body.classList.toggle('context-page', !!prefs.data.contextEnabled);

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
  state.bookId = 'Pride and Prejudice (sample)';
  bookmarkManager.setBook(state.bookId);
  loadText(sampleText, []);
  restorePosition();

  // ---------- Canonical position ----------
  // Section table keyed by stable spine href — shared anchor across modes.
  function rsvpSections() {
    const chs = state.chapters;
    const total = state.totalWords;
    return chs.map((c, i) => {
      const start = c.wordOffset || 0;
      const end = i + 1 < chs.length ? (chs[i + 1].wordOffset || 0) : total;
      return { href: c.href || '', wordStart: start, wordCount: Math.max(0, end - start) };
    });
  }
  function currentOrdinal() {
    // Scan backward so a paragraph-break token maps to the last word read,
    // not the first word of the next paragraph (which could be on the next page).
    let i = Math.max(0, Math.min(state.currentIdx, state.tokens.length - 1));
    while (i > 0 && state.tokenToWordOrdinal[i] < 0) i--;
    return state.tokenToWordOrdinal[i] >= 0 ? state.tokenToWordOrdinal[i] : 0;
  }
  // Raw word string at word ordinal `o`, for the text-anchored exact snap.
  function wordAt(o) {
    const ti = state.wordTokenIndices[o];
    return ti == null ? '' : (state.tokens[ti] || '');
  }
  function getCanonicalPosition() {
    if (state.totalWords < 1) return null;
    const pos = buildPosition(rsvpSections(), state.totalWords, currentOrdinal(), wordAt);
    if (pos) pos.hl = 1; // highlight the single word we were on when entering the Reader
    return pos;
  }
  function applyCanonicalPosition(pos) {
    if (!state.totalWords) return;
    const ord = resolvePosition(pos, rsvpSections(), state.totalWords, wordAt);
    playback.seekTo(state.ordinalToIdx(ord));
  }

  // ---------- Handle ----------
  function savePosition() {
    if (!state.bookId || !state.totalWords) return;
    const pos = getCanonicalPosition();
    if (pos) try { localStorage.setItem('book:pos:' + state.bookId, JSON.stringify(pos)); } catch (_) {}
  }

  function restorePosition() {
    if (!state.bookId) return;
    try {
      const raw = localStorage.getItem('book:pos:' + state.bookId);
      if (!raw) return;
      applyCanonicalPosition(JSON.parse(raw));
    } catch (_) {}
  }

  return {
    teardown() {
      closeSettingsScreen();
      playback.clearPending();
      playback.cancelCountdown();
      stats.destroy();
      savePosition();
    },
    getPosition: getCanonicalPosition,
    getBookId() { return state.bookId; },
    isBookLoaded() { return state.isEpubLoaded; },
    applyPosition(pos) { applyCanonicalPosition(pos); },
    loadFromSession(session, pos) { return loadFromSession(session, pos); },
  };
}
