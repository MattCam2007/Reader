import { FONT_MAP, FONT_SERIF, THEME_COLORS, RESIZE_DEBOUNCE_MS, SAVE_DEBOUNCE_MS, GENERAL_DEFAULTS, ALL_THEME_NAMES } from './core/constants.js';
import { openSettingsScreen, closeSettingsScreen } from './settings/settings-screen.js';
import { BookmarkManager } from './core/bookmarks.js';
import { initBookmarksPanel } from './bookmarks/panel.js';
import { PrefsManager } from './core/prefs.js';
import { ReaderState } from './core/state.js';
import { StorageManager } from './core/storage.js';
import { extractSections } from './epub/extractor.js';
import { resolveImageUrls, findCoverImage } from './epub/images.js';
import { flattenToc, buildTOC, resolveHref } from './epub/toc.js';
import { toLocator, resolveLocator } from './model/locator.js';
import { currentLocator, pageOfElement, pageOfWord } from './model/geometry.js';
import { buildChapterIndex } from './reader/chapters.js';
import { PaginationEngine } from './reader/pagination.js';
import { ChromeManager } from './reader/chrome.js';
import { InputHandler } from './reader/input.js';
import { SearchManager } from './reader/search.js';
import { SelectionManager } from './reader/selection.js';
import { FootnoteManager } from './reader/footnotes.js';
import { buildSample } from '../fixtures/sample.js';
import { runSelftest } from './test/selftest.js';
import { trapFocus } from './reader/focus-trap.js';
import { TtsEngine } from './tts/engine.js';
import { TtsHighlighter } from './tts/highlighter.js';

const LISTEN_DEFAULTS = { rate: 1.0, pitch: 1.0, voiceName: '', autoScroll: true, highlightMode: 'sentence' };

export function init(options = {}) {
  const signal = options.signal || new AbortController().signal;
  const onModeSwitch = options.onModeSwitch;
  const onBookLoaded = options.onBookLoaded;

  // ---------- DOM elements ----------
  const els = {
    viewport:      document.getElementById("viewport"),
    content:       document.getElementById("content"),
    bookTitleEl:   document.getElementById("bookTitle"),
    progressEl:    document.getElementById("progress"),
    progressLabel: document.getElementById("progressLabel"),
    tocBtn:        document.getElementById("tocBtn"),
    settingsBtn:   document.getElementById("settingsBtn"),
    searchBtn:     document.getElementById("searchBtn"),
    openBtn:       document.getElementById("openBtn"),
    backdrop:      document.getElementById("backdrop"),
    tocListEl:     document.getElementById("tocList"),
    overlay:       document.getElementById("overlay"),
    overlayMsg:    document.getElementById("overlayMsg"),
    overlayBtn:    document.getElementById("overlayBtn"),
    fileInput:     document.getElementById("fileInput"),
    bookSubEl:     document.getElementById("bookSub"),
    coachEl:       document.getElementById("coach"),
    searchInput:   document.getElementById("searchInput"),
    searchResults: document.getElementById("searchResults"),
    comfortDim:    document.getElementById("comfortDim"),
    comfortWarm:   document.getElementById("comfortWarm"),
    toc:           document.getElementById("toc"),
    searchPanel:   document.getElementById("searchPanel"),
    bookmarksBtn:  document.getElementById("bookmarksBtn"),
    bookmarksPanel: document.getElementById("bookmarksPanel"),
    bmAddBtn:      document.getElementById("bmAddBtn"),
    bmList:        document.getElementById("bmList"),
    // Listen mode
    listenBtn:     document.getElementById("listenBtn"),
    ttsPlayBtn:    document.getElementById("ttsPlayBtn"),
    ttsPrevBtn:    document.getElementById("ttsPrevBtn"),
    ttsNextBtn:    document.getElementById("ttsNextBtn"),
    ttsRateSeg:    document.getElementById("ttsRateSeg"),
    ttsVoiceBtn:   document.getElementById("ttsVoiceBtn"),
    ttsVoiceList:  document.getElementById("ttsVoiceList"),
    ttsStopBtn:    document.getElementById("ttsStopBtn"),
  };

  // ---------- State & Prefs ----------
  const prefs = new PrefsManager();
  const generalPrefs = new PrefsManager({ storageKey: 'general:prefs', defaults: GENERAL_DEFAULTS });
  const state = new ReaderState();
  state.setPrefs(prefs);
  const urlParams = new URLSearchParams(location.search);

  // ---------- Bookmarks ----------
  const bookmarkManager = new BookmarkManager();
  const bmPanel = initBookmarksPanel(
    { panelEl: els.bookmarksPanel, listEl: els.bmList, addBtnEl: els.bmAddBtn },
    signal
  );
  bmPanel.setBook(bookmarkManager);

  function getBookmarkContext() {
    if (!state.bookId || !state.doc.words.length) return null;
    const loc = currentLocatorFn ? currentLocatorFn() : null;
    const fraction = getPositionFraction();
    const chapterLabel = chrome ? chrome.currentChapterLabel() : '';
    let text = '';
    if (loc) {
      const wi = resolveLocator(state, loc);
      if (wi >= 0) {
        const charStart = state.doc.wordCharStart[wi] || 0;
        text = state.doc.text.slice(charStart, charStart + 150).slice(0, 120).trimEnd();
      }
    }
    return { fraction, chapterLabel, text, position: loc };
  }

  function navigateToBookmark(item) {
    if (item.position && state.doc.words.length) {
      const wi = resolveLocator(state, item.position);
      if (wi >= 0) {
        if (state.isScrollMode) pagination.scrollToWord(wi);
        else pagination.goTo(pageOfWord(state, els.content, wi), false);
        return;
      }
    }
    if (state.isScrollMode) {
      const sh = els.viewport.scrollHeight - els.viewport.clientHeight;
      els.viewport.scrollTop = Math.round(item.fraction * sh);
    } else {
      pagination.goTo(Math.round(item.fraction * (state.total - 1)), false);
    }
  }

  // ---------- Chrome ----------
  const chrome = new ChromeManager(state, els);

  bmPanel.setCallbacks({
    getContext: getBookmarkContext,
    onNavigate: navigateToBookmark,
    closePanel: () => { document.body.classList.remove('show-bookmarks'); updateAriaExpanded(); },
  });

  // ---------- Helpers ----------
  function currentLocatorFn() {
    return currentLocator(state, els.content, els.viewport, (wi) => toLocator(state, wi));
  }
  function buildChapterIndexFn() { buildChapterIndex(state, els.content); }
  function savePosMain() { storage.savePos(currentLocatorFn); }
  function updateProgressFn() { chrome.updateProgress(); }

  // ---------- Pagination ----------
  const pagination = new PaginationEngine(state, els, currentLocatorFn, buildChapterIndexFn, updateProgressFn, savePosMain);

  // ---------- Storage ----------
  const storage = new StorageManager(state, els);

  // ---------- Footnotes ----------
  const footnotes = new FootnoteManager(state, els, (targetEl) => {
    pagination.goTo(pageOfElement(state, els.content, targetEl), true);
  });

  // ---------- Search ----------
  function goToLocator(loc) {
    const wi = resolveLocator(state, loc);
    if (wi < 0) return;
    if (state.isScrollMode) pagination.scrollToWord(wi);
    else pagination.goTo(pageOfWord(state, els.content, wi), false);
  }

  const search = new SearchManager(state, els, goToLocator, closePanels);

  // ---------- Selection ----------
  const selection = new SelectionManager(state, signal);

  // ---------- Focus traps ----------
  trapFocus(els.toc, signal);
  trapFocus(els.searchPanel, signal);

  // ---------- Listen mode (TTS) ----------
  let listenActive = false;
  let listenWasScrollMode = false;
  let listenSentences = [];
  let listenSentenceIdx = 0;
  let listenPlaying = false;
  let listenVoices = [];
  let listenRate = LISTEN_DEFAULTS.rate;
  let listenPitch = LISTEN_DEFAULTS.pitch;
  let listenVoiceName = LISTEN_DEFAULTS.voiceName;
  let listenHighlightMode = LISTEN_DEFAULTS.highlightMode;
  let listenAutoScroll = LISTEN_DEFAULTS.autoScroll;

  // Load persisted listen prefs
  try {
    const saved = JSON.parse(localStorage.getItem('reader:listen:prefs') || '{}');
    if (saved.rate) listenRate = saved.rate;
    if (saved.pitch) listenPitch = saved.pitch;
    if (saved.voiceName) listenVoiceName = saved.voiceName;
    if (saved.highlightMode) listenHighlightMode = saved.highlightMode;
    if (saved.autoScroll !== undefined) listenAutoScroll = saved.autoScroll;
  } catch (_) {}

  function saveListenPrefs() {
    try {
      localStorage.setItem('reader:listen:prefs', JSON.stringify({
        rate: listenRate, pitch: listenPitch, voiceName: listenVoiceName,
        highlightMode: listenHighlightMode, autoScroll: listenAutoScroll,
      }));
    } catch (_) {}
  }

  const ttsEngine = new TtsEngine({
    onSentenceStart(index) {
      listenSentenceIdx = index;
      ttsHighlighter.clearWordHighlight();
      if (listenHighlightMode === 'off') return;
      if (listenHighlightMode === 'paragraph') ttsHighlighter.highlightParagraph(index);
      else ttsHighlighter.highlightSentence(index);
    },
    onSentenceEnd(index) {
      listenSentenceIdx = index + 1;
    },
    onBoundary({ sentenceIndex, charIndex, charLength }) {
      if (listenHighlightMode === 'word') {
        ttsHighlighter.highlightWord(sentenceIndex, charIndex, charLength);
      }
    },
    onEnd() {
      setListenPlaying(false);
      ttsHighlighter.clearHighlight();
    },
    onError(e) {
      console.warn('reader:tts-error', e);
      setListenPlaying(false);
    },
  });

  const ttsHighlighter = new TtsHighlighter(els.content, els.viewport);

  function setListenPlaying(val) {
    listenPlaying = val;
    document.body.classList.toggle('tts-playing', val);
    if (els.ttsPlayBtn) {
      els.ttsPlayBtn.setAttribute('aria-label', val ? 'Pause' : 'Play');
    }
  }

  // ---- Sentence segmentation ----

  function splitSentences(text) {
    const marked = text.replace(/([.!?…])\s+/g, '$1\x00');
    return marked.split('\x00').map(s => s.trim()).filter(Boolean);
  }

  function segmentContent() {
    const blockSel = '.blk-p, .blk-h1, .blk-h2, .blk-h3, .blk-h4, .blk-h5, .blk-h6, .blk-blockquote, .blk-li';
    const blocks = Array.from(els.content.querySelectorAll(blockSel));
    const result = [];
    let wordOffset = 0;
    for (const blockEl of blocks) {
      const text = blockEl.textContent.trim();
      if (!text) continue;
      const parts = splitSentences(text);
      for (let i = 0; i < parts.length; i++) {
        const wc = parts[i].split(/\s+/).filter(Boolean).length;
        result.push({ text: parts[i], blockEl, highlightEl: blockEl, wordOffset });
        wordOffset += wc;
      }
    }
    return result;
  }

  function findSentenceForWord(wordIndex) {
    let best = 0;
    for (let i = 0; i < listenSentences.length; i++) {
      if (listenSentences[i].wordOffset <= wordIndex) best = i;
      else break;
    }
    return best;
  }

  // ---- Listen mode control ----

  function ttsPlay() {
    if (!listenSentences.length) return;
    if (ttsEngine.paused) {
      ttsEngine.resume();
      setListenPlaying(true);
      return;
    }
    const texts = listenSentences.map(s => s.text);
    ttsEngine.speakSentences(texts, listenSentenceIdx);
    setListenPlaying(true);
  }

  function ttsPause() {
    ttsEngine.pause();
    setListenPlaying(false);
  }

  function ttsPlayPause() {
    if (listenPlaying) ttsPause();
    else ttsPlay();
  }

  function ttsPrevSentence() {
    const wasPlaying = listenPlaying;
    ttsEngine.cancel();
    setListenPlaying(false);
    ttsHighlighter.clearHighlight();
    listenSentenceIdx = Math.max(0, listenSentenceIdx - 1);
    scrollToListenSentence(listenSentenceIdx);
    if (wasPlaying) ttsPlay();
  }

  function ttsNextSentence() {
    const wasPlaying = listenPlaying;
    ttsEngine.cancel();
    setListenPlaying(false);
    ttsHighlighter.clearHighlight();
    listenSentenceIdx = Math.min(listenSentences.length - 1, listenSentenceIdx + 1);
    scrollToListenSentence(listenSentenceIdx);
    if (wasPlaying) ttsPlay();
  }

  function scrollToListenSentence(index) {
    const sent = listenSentences[index];
    if (sent) {
      const el = sent.highlightEl || sent.blockEl;
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      catch (_) { el.scrollIntoView(false); }
    }
  }

  function applyListenRateButtons() {
    if (!els.ttsRateSeg) return;
    els.ttsRateSeg.querySelectorAll('.tts-rate-btn').forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.rate) === listenRate);
    });
  }

  function renderVoiceList() {
    if (!els.ttsVoiceList) return;
    els.ttsVoiceList.innerHTML = '';
    if (!listenVoices.length) {
      const msg = document.createElement('div');
      msg.className = 'tts-voice-empty';
      msg.textContent = 'No voices available.';
      els.ttsVoiceList.appendChild(msg);
      return;
    }
    const sorted = [...listenVoices].sort((a, b) => {
      if (a.localService && !b.localService) return -1;
      if (!a.localService && b.localService) return 1;
      return a.name.localeCompare(b.name);
    });
    sorted.forEach(voice => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tts-voice-item' + (voice.name === listenVoiceName ? ' active' : '');
      btn.textContent = voice.name + ' (' + voice.lang + ')';
      if (voice.localService) {
        const badge = document.createElement('span');
        badge.className = 'tts-voice-local';
        badge.textContent = 'local';
        btn.appendChild(badge);
      }
      btn.addEventListener('click', () => {
        listenVoiceName = voice.name;
        ttsEngine.setVoice(voice);
        saveListenPrefs();
        els.ttsVoiceList.querySelectorAll('.tts-voice-item').forEach(b => {
          b.classList.toggle('active', b === btn);
        });
        document.body.classList.remove('tts-show-voice');
        if (els.ttsVoiceBtn) els.ttsVoiceBtn.setAttribute('aria-expanded', 'false');
      });
      els.ttsVoiceList.appendChild(btn);
    });
  }

  function restoreVoice() {
    if (!listenVoiceName || !listenVoices.length) return;
    const v = listenVoices.find(v => v.name === listenVoiceName);
    if (v) ttsEngine.setVoice(v);
  }

  function activateListen() {
    listenActive = true;
    document.body.classList.add('reader-tts-active');

    // Force scroll mode if needed, remember so we can restore
    listenWasScrollMode = prefs.data.layout === 'scroll';
    if (!listenWasScrollMode) {
      document.body.classList.add('layout-scroll');
    }

    // Capture position before segmentation mutates the DOM
    const loc = currentLocatorFn();
    const wi = loc ? resolveLocator(state, loc) : 0;

    listenSentences = segmentContent();
    ttsHighlighter.setSentences(listenSentences);
    ttsHighlighter.setAutoScroll(listenAutoScroll);
    listenSentenceIdx = findSentenceForWord(wi);
    scrollToListenSentence(listenSentenceIdx);

    ttsEngine.setRate(listenRate);
    ttsEngine.setPitch(listenPitch);
    applyListenRateButtons();

    if (els.listenBtn) els.listenBtn.setAttribute('aria-pressed', 'true');

    // Load voices, then auto-play
    ttsEngine.loadVoices().then(vs => {
      listenVoices = vs;
      restoreVoice();
      renderVoiceList();
      ttsPlay();
    });
  }

  function deactivateListen() {
    ttsEngine.cancel();
    setListenPlaying(false);
    ttsHighlighter.clearHighlight();
    listenActive = false;
    document.body.classList.remove('reader-tts-active', 'tts-show-voice');

    if (els.listenBtn) els.listenBtn.setAttribute('aria-pressed', 'false');
    if (els.ttsVoiceBtn) els.ttsVoiceBtn.setAttribute('aria-expanded', 'false');

    if (!listenWasScrollMode) {
      const currentSent = listenSentences[listenSentenceIdx];
      const targetEl = currentSent ? currentSent.blockEl : null;
      document.body.classList.remove('layout-scroll');
      requestAnimationFrame(() => {
        pagination.paginateQuick();
        if (targetEl) {
          pagination.goTo(pageOfElement(state, els.content, targetEl), false);
        }
      });
    }
  }

  function toggleListen() {
    if (listenActive) deactivateListen();
    else activateListen();
  }

  // ---------- Panels ----------
  let _lastPanelTrigger = null;

  function updateAriaExpanded() {
    els.tocBtn.setAttribute("aria-expanded", String(document.body.classList.contains("show-toc")));
    els.settingsBtn.setAttribute("aria-expanded", String(!!document.getElementById("settingsScreen")));
    els.searchBtn.setAttribute("aria-expanded", String(document.body.classList.contains("show-search")));
    if (els.bookmarksBtn) els.bookmarksBtn.setAttribute("aria-expanded", String(document.body.classList.contains("show-bookmarks")));
  }

  function closePanels() {
    document.body.classList.remove("show-toc", "show-search", "show-bookmarks", "tts-show-voice");
    search.clearHighlights();
    updateAriaExpanded();
    if (els.ttsVoiceBtn) els.ttsVoiceBtn.setAttribute('aria-expanded', 'false');
    if (_lastPanelTrigger) {
      _lastPanelTrigger.focus();
      _lastPanelTrigger = null;
    }
  }

  function openTOC() {
    _lastPanelTrigger = els.tocBtn;
    closePanels();
    _lastPanelTrigger = els.tocBtn;
    document.body.classList.add("show-toc");
    document.body.classList.remove("chrome-hidden");
    updateAriaExpanded();
    const firstItem = els.tocListEl.querySelector("button");
    if (firstItem) firstItem.focus();
  }

  function openSettings() {
    closePanels();
    openSettingsScreen({
      initialTab: 'read',
      currentMode: 'read',
      onGeneralChange(key, value) {
        generalPrefs.data[key] = value;
        applyPrefs();
      },
      onReaderChange(key, value, needsRepaginate) {
        prefs.data[key] = value;
        applyPrefs();
        if (needsRepaginate) pagination.paginateQuick();
      },
    });
    updateAriaExpanded();
  }

  function dismissCoach() {
    if (els.coachEl && !els.coachEl.classList.contains("hide")) {
      els.coachEl.classList.add("hide");
      els.coachEl.setAttribute("aria-hidden", "true");
      try { localStorage.setItem("reader:hinted", "1"); } catch (e) { console.warn("coach:dismiss", e); }
    }
  }

  // ---------- Input ----------
  const input = new InputHandler(state, els, pagination, {
    toggleChrome: () => chrome.toggle(),
    dismissCoach,
    closePanels,
    dismissSelBar: () => selection.dismiss(),
    dismissNotePopover: () => footnotes.dismiss(),
    activePopoverRef: () => footnotes.activePopover,
  }, signal);

  // ---------- Overlay ----------
  function showLoading(msg) {
    document.body.classList.remove("error");
    document.body.classList.add("loading");
    els.overlayBtn.hidden = true;
    els.overlayMsg.textContent = msg;
  }
  function showError(msg) {
    document.body.classList.remove("loading");
    document.body.classList.add("error");
    els.overlayMsg.textContent = msg;
    els.overlayBtn.hidden = false;
  }
  function clearOverlay() {
    document.body.classList.remove("loading", "error");
  }

  // ---------- Prefs application ----------
  function applyPrefs() {
    const p = prefs.data;
    const theme = generalPrefs.data.theme;
    document.body.classList.remove(...ALL_THEME_NAMES.map(t => `theme-${t}`));
    if (theme !== "dark") document.body.classList.add("theme-" + theme);

    els.content.style.fontFamily = FONT_MAP[p.font] || FONT_SERIF;
    els.content.style.fontSize = p.size + "px";
    els.content.style.setProperty("--reading-line-height", String(p.lineHeight));

    els.viewport.classList.remove("margin-narrow", "margin-normal", "margin-wide");
    els.viewport.classList.add("margin-" + (p.margin || "normal"));

    els.content.classList.toggle("para-spaced", p.paraSpacing === "spaced");
    els.content.style.textAlign = p.align === "left" ? "left" : "justify";

    document.body.classList.toggle("images-off", !p.images);
    document.body.classList.toggle("selection-on", !!p.selection);

    // Only apply layout-scroll when not in listen mode (listen mode manages it separately)
    if (!listenActive) {
      document.body.classList.toggle("layout-scroll", p.layout === "scroll");
    }

    const tc = THEME_COLORS[theme];
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && tc) meta.setAttribute("content", tc);

    if (els.comfortDim) els.comfortDim.style.opacity = String(1 - (p.brightness || 1));
    if (els.comfortWarm) els.comfortWarm.style.opacity = String(p.warmth || 0);
  }

  // ---------- Rendering ----------
  function renderBook(sections) {
    state.blobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) { console.warn("render:revokeBlob", e); } });
    state.blobUrls = [];
    els.content.innerHTML = "";
    state.sectionEls.clear();
    state.headingToc = [];
    state.docModelBuilt = false;
    // Reset listen state when new book loads
    if (listenActive) {
      ttsEngine.cancel();
      setListenPlaying(false);
      ttsHighlighter.clearHighlight();
      listenSentences = [];
    }
    const frag = document.createDocumentFragment();
    sections.forEach((sec) => {
      const wrap = document.createElement("div");
      wrap.className = "chap";
      if (sec.href) { wrap.dataset.href = sec.href; state.sectionEls.set(sec.href, wrap); }
      sec.blocks.forEach((b) => {
        const el = document.createElement((b.type === "figure" || b.type === "table-wrap") ? "div" : b.type);
        if (b.frag) el.appendChild(b.frag);
        else el.textContent = b.text;
        if (b.id) el.id = b.id;
        el.className = "blk blk-" + b.type;
        if (b.type === "figure") {
          el.querySelectorAll("figcaption").forEach(fc => fc.className = "blk-figcaption");
        }
        wrap.appendChild(el);
        if (b.type === "h1" || b.type === "h2") {
          state.headingToc.push({ label: b.text, el, depth: b.type === "h1" ? 0 : 1 });
        }
      });
      frag.appendChild(wrap);
    });
    els.content.appendChild(frag);
  }

  // ---------- EPUB loading ----------
  async function loadEpub(file) {
    showLoading("Loading " + file.name + "…");
    closePanels();
    let book = null;
    try {
      if (typeof ePub !== "function") {
        throw new Error("EPUB library failed to load. Check your connection.");
      }
      const buffer = await file.arrayBuffer();
      book = ePub(buffer);
      await book.ready;

      let epubToc = [];
      try {
        const nav = await book.loaded.navigation;
        epubToc = flattenToc(nav && nav.toc, 0, []);
      } catch (e) { console.warn("epub:toc", e); }

      const { sections, allImgUrls } = await extractSections(book, (msg) => {
        els.overlayMsg.textContent = msg;
      });
      const chars = sections.reduce((n, s) => n + s.blocks.reduce((m, b) => m + b.text.length, 0), 0);
      if (chars < 32) {
        throw new Error("No readable text found (this EPUB may be image-only or DRM-protected).");
      }

      if (allImgUrls.length && book.archive) {
        await resolveImageUrls(allImgUrls, book, state.blobUrls);
      }

      const coverUrl = await findCoverImage(book);
      if (coverUrl) {
        const img = document.createElement("img");
        img.src = coverUrl;
        const frag = document.createDocumentFragment();
        frag.appendChild(img);
        sections.unshift({ href: "__cover__", blocks: [{ type: "figure", text: "", id: "cover", frag }] });
      }

      const meta = (book.packaging && book.packaging.metadata) || {};
      const title = (meta.title || file.name).trim();
      state.bookId = urlParams.get("id") || title || file.name;
      els.bookTitleEl.textContent = title;
      bookmarkManager.setBook(state.bookId);

      renderBook(sections);
      if (coverUrl) state.blobUrls.push(coverUrl);
      clearOverlay();
      if (onBookLoaded) onBookLoaded({ buffer, fileName: file.name, bookId: state.bookId });
      requestAnimationFrame(() => {
        pagination.paginate(false);
        buildTOC(epubToc, state.headingToc, els.tocListEl, state.sectionEls,
          (el) => pagination.goTo(pageOfElement(state, els.content, el), false),
          closePanels,
          (href) => resolveHref(href, els.content, state.sectionEls));
        storage.restorePos(
          (wi) => pagination.goTo(pageOfWord(state, els.content, wi), false),
          (wi) => pagination.scrollToWord(wi),
          (p) => pagination.goTo(p, false),
          (loc) => resolveLocator(state, loc)
        );
        if (listenActive) {
          listenSentences = segmentContent();
          ttsHighlighter.setSentences(listenSentences);
          listenSentenceIdx = 0;
        }
        if (urlParams.get("selftest") === "1") {
          requestAnimationFrame(() => runSelftest(state));
        }
      });
    } catch (err) {
      console.error("EPUB load failed:", err);
      showError(err && err.message ? err.message : "Couldn't read that file.");
    } finally {
      if (book && typeof book.destroy === "function") {
        try { book.destroy(); } catch (e) { console.warn("epub:destroy", e); }
      }
    }
  }

  async function loadFromUrl(url) {
    showLoading("Fetching book…");
    closePanels();
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("Fetch failed: " + resp.status);
      const blob = await resp.blob();
      const filename = url.split("/").pop() || "book.epub";
      const file = new File([blob], filename, { type: "application/epub+zip" });
      await loadEpub(file);
    } catch (err) {
      console.error("URL load failed:", err);
      showError(err && err.message ? err.message : "Couldn't fetch that book.");
    }
  }

  // ---------- Wiring ----------
  els.searchBtn.addEventListener("click", () => { _lastPanelTrigger = els.searchBtn; search.open(); updateAriaExpanded(); }, { signal });
  els.searchInput.addEventListener("input", (e) => search.run(e.target.value.trim()), { signal });
  els.tocBtn.addEventListener("click", openTOC, { signal });
  els.settingsBtn.addEventListener("click", openSettings, { signal });
  if (els.bookmarksBtn) {
    els.bookmarksBtn.addEventListener("click", () => {
      _lastPanelTrigger = els.bookmarksBtn;
      const isOpen = document.body.classList.contains("show-bookmarks");
      closePanels();
      closeSettingsScreen();
      if (!isOpen) {
        _lastPanelTrigger = els.bookmarksBtn;
        document.body.classList.add("show-bookmarks");
        document.body.classList.remove("chrome-hidden");
        bmPanel.render();
        updateAriaExpanded();
      }
    }, { signal });
  }
  els.backdrop.addEventListener("click", () => { closePanels(); closeSettingsScreen(); }, { signal });
  els.openBtn.addEventListener("click", () => els.fileInput.click(), { signal });
  els.overlayBtn.addEventListener("click", () => els.fileInput.click(), { signal });
  els.fileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (file) loadEpub(file);
  }, { signal });
  els.progressEl.addEventListener("input", () => pagination.goTo(parseInt(els.progressEl.value, 10) || 0, false), { signal });
  els.content.addEventListener("click", (e) => footnotes.handleContentClick(e), { signal });

  // Scroll mode progress tracking
  els.viewport.addEventListener("scroll", () => {
    if (!state.isScrollMode) return;
    chrome.updateProgress();
    savePosMain();
  }, { passive: true, signal });

  // Resize
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => pagination.paginateQuick(), RESIZE_DEBOUNCE_MS);
  }, { signal });

  // Mode switch to RSVP
  const modeBtn = document.getElementById("modeBtn");
  if (modeBtn && onModeSwitch) {
    modeBtn.addEventListener("click", () => {
      closeSettingsScreen();
      if (listenActive) deactivateListen();
      onModeSwitch("rsvp", { fraction: getPositionFraction(), bookId: state.bookId });
    }, { signal });
  }

  // Listen mode toggle
  if (els.listenBtn) {
    els.listenBtn.addEventListener("click", () => {
      closeSettingsScreen();
      toggleListen();
    }, { signal });
  }

  // TTS transport controls
  if (els.ttsStopBtn) els.ttsStopBtn.addEventListener("click", deactivateListen, { signal });
  if (els.ttsPlayBtn) els.ttsPlayBtn.addEventListener("click", ttsPlayPause, { signal });
  if (els.ttsPrevBtn) els.ttsPrevBtn.addEventListener("click", ttsPrevSentence, { signal });
  if (els.ttsNextBtn) els.ttsNextBtn.addEventListener("click", ttsNextSentence, { signal });

  if (els.ttsRateSeg) {
    els.ttsRateSeg.addEventListener("click", (e) => {
      const btn = e.target.closest('[data-rate]');
      if (!btn) return;
      listenRate = parseFloat(btn.dataset.rate);
      ttsEngine.setRate(listenRate);
      saveListenPrefs();
      applyListenRateButtons();
    }, { signal });
  }

  if (els.ttsVoiceBtn) {
    els.ttsVoiceBtn.addEventListener("click", () => {
      const isOpen = document.body.classList.contains('tts-show-voice');
      closePanels();
      if (!isOpen) {
        document.body.classList.add('tts-show-voice');
        els.ttsVoiceBtn.setAttribute('aria-expanded', 'true');
        renderVoiceList();
      }
    }, { signal });
  }

  // Keyboard shortcuts for listen mode
  window.addEventListener("keydown", (e) => {
    if (!listenActive) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); ttsPlayPause(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); ttsNextSentence(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); ttsPrevSentence(); }
  }, { signal });

  // ---------- Init ----------
  prefs.load();
  generalPrefs.load();
  applyPrefs();

  if (!localStorage.getItem("general:prefs")) {
    const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    if (prefersLight) {
      generalPrefs.data.theme = "light";
      generalPrefs.save();
      applyPrefs();
    }
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduceMotion.matches && !localStorage.getItem("reader:prefs")) {
    prefs.data.pageAnim = "none";
  }
  reduceMotion.addEventListener("change", (e) => {
    if (e.matches && prefs.data.pageAnim === "slide") {
      prefs.data.pageAnim = "none";
      applyPrefs();
      prefs.save();
    }
  }, { signal });

  let hinted = false;
  try { hinted = localStorage.getItem("reader:hinted") === "1"; } catch (e) { console.warn("init:hinted", e); }
  if (hinted) {
    els.coachEl.classList.add("hide");
  } else {
    els.coachEl.setAttribute("aria-hidden", "false");
    setTimeout(dismissCoach, 6000);
  }

  const srcUrl = urlParams.get("src");
  if (srcUrl) {
    loadFromUrl(srcUrl);
  } else {
    state.bookId = urlParams.get("id") || "Pride and Prejudice (sample)";
    bookmarkManager.setBook(state.bookId);
    els.bookTitleEl.textContent = "Pride and Prejudice";
    renderBook(buildSample());
    requestAnimationFrame(() => {
      pagination.paginate(false);
      buildTOC([], state.headingToc, els.tocListEl, state.sectionEls,
        (el) => pagination.goTo(pageOfElement(state, els.content, el), false),
        closePanels,
        (href) => resolveHref(href, els.content, state.sectionEls));
      storage.restorePos(
        (wi) => pagination.goTo(pageOfWord(state, els.content, wi), false),
        (wi) => pagination.scrollToWord(wi),
        (p) => pagination.goTo(p, false),
        (loc) => resolveLocator(state, loc)
      );
      if (urlParams.get("selftest") === "1") {
        requestAnimationFrame(() => runSelftest(state));
      }
    });
  }

  // ---------- Handle object ----------
  function getPositionFraction() {
    if (!state.doc.words.length) return 0;
    const loc = currentLocatorFn();
    if (!loc) return 0;
    const wi = resolveLocator(state, loc);
    return wi >= 0 ? wi / state.doc.words.length : 0;
  }

  return {
    teardown() {
      closeSettingsScreen();
      ttsEngine.cancel();
      setListenPlaying(false);
      document.body.classList.remove('reader-tts-active', 'tts-playing', 'tts-show-voice');
      state.blobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (_) {} });
      state.blobUrls = [];
      if (resizeTimer) clearTimeout(resizeTimer);
    },
    getPositionFraction,
    getBookId() { return state.bookId; },
    isBookLoaded() { return state.bookId && state.bookId !== "Pride and Prejudice (sample)"; },
    seekFraction(f) {
      if (!state.doc.words.length) return;
      const wi = Math.round(f * (state.doc.words.length - 1));
      if (state.isScrollMode) pagination.scrollToWord(wi);
      else pagination.goTo(pageOfWord(state, els.content, wi), false);
    },
    loadFromBuffer(buffer, fileName) {
      const file = new File([buffer], fileName, { type: "application/epub+zip" });
      return loadEpub(file);
    },
  };
}
