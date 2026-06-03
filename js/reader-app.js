import { FONT_MAP, FONT_SERIF, THEME_COLORS, RESIZE_DEBOUNCE_MS, SAVE_DEBOUNCE_MS, GENERAL_DEFAULTS, ALL_THEME_NAMES } from './core/constants.js';
import { openSettingsScreen, closeSettingsScreen } from './settings/settings-screen.js';
import { BookmarkManager } from './core/bookmarks.js';
import { initBookmarksPanel } from './bookmarks/panel.js';
import { PrefsManager } from './core/prefs.js';
import { ReaderState } from './core/state.js';
import { StorageManager } from './core/storage.js';
import { extractSections } from './epub/extractor.js';
import { resolveImageUrls } from './epub/images.js';
import { flattenToc, buildTOC, resolveHref } from './epub/toc.js';
import { toLocator, resolveLocator } from './model/locator.js';
import { currentLocator, pageOfElement, pageOfWord, wordAtPageStart } from './model/geometry.js';
import { deriveBookId, buildPosition, resolvePosition } from './core/position.js';
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
    bmMarkersEl:   document.getElementById("bmMarkers"),
    bmPageIndicatorEl: document.getElementById("bmPageIndicator"),
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
    const pos = getCanonicalPosition();
    const chapterLabel = chrome ? chrome.currentChapterLabel() : '';
    let text = '';
    const wi = currentWordIndex();
    if (wi >= 0) {
      const charStart = state.doc.wordCharStart[wi] || 0;
      text = state.doc.text.slice(charStart, charStart + 150).slice(0, 120).trimEnd();
    }
    return { fraction: pos ? pos.f : 0, chapterLabel, text, position: pos };
  }

  function navigateToBookmark(item) {
    if (item.position && state.doc.words.length) {
      applyCanonicalPosition(item.position);
      return;
    }
    if (state.isScrollMode) {
      const sh = els.viewport.scrollHeight - els.viewport.clientHeight;
      els.viewport.scrollTop = Math.round((item.fraction || 0) * sh);
    } else {
      pagination.goTo(Math.round((item.fraction || 0) * (state.total - 1)), false);
    }
  }

  // ---------- Chrome ----------
  const chrome = new ChromeManager(state, els);

  bmPanel.setCallbacks({
    getContext: getBookmarkContext,
    onNavigate: navigateToBookmark,
    closePanel: () => { document.body.classList.remove('show-bookmarks'); updateAriaExpanded(); },
    onBookmarksChange: () => chrome.updateBookmarkMarkers(bookmarkManager.getAll(), navigateToBookmark),
  });

  // ---------- Helpers ----------
  function currentLocatorFn() {
    return currentLocator(state, els.content, els.viewport, (wi) => toLocator(state, wi));
  }
  function buildChapterIndexFn() { buildChapterIndex(state, els.content); }
  function savePosMain() { storage.savePos(getCanonicalPosition); }
  function updateProgressFn() {
    chrome.updateProgress();
    chrome.updateBookmarkMarkers(bookmarkManager.getAll(), navigateToBookmark);
  }

  // ---------- Canonical position ----------
  // Section table keyed by stable spine href — the shared anchor across modes.
  function readerSections() {
    return state.doc.sections.map(s => ({
      href: s.href,
      wordStart: s.wordStart,
      wordCount: s.wordEnd - s.wordStart,
    }));
  }
  // Global word index of the first word currently on screen.
  function currentWordIndex() {
    if (!state.doc.words.length) return 0;
    if (state.isScrollMode) {
      const loc = currentLocatorFn();
      const wi = loc ? resolveLocator(state, loc) : 0;
      return wi >= 0 ? wi : 0;
    }
    return wordAtPageStart(state, els.content, state.page);
  }
  function getCanonicalPosition() {
    if (!state.doc.words.length) return null;
    return buildPosition(readerSections(), state.doc.words.length, currentWordIndex());
  }
  function applyCanonicalPosition(pos) {
    if (!state.doc.words.length) return;
    const wi = resolvePosition(pos, readerSections(), state.doc.words.length);
    if (state.isScrollMode) pagination.scrollToWord(wi);
    else pagination.goTo(pageOfWord(state, els.content, wi), false);
  }

  // ---------- Pagination ----------
  const pagination = new PaginationEngine(state, els, currentLocatorFn, buildChapterIndexFn, updateProgressFn, savePosMain);

  // ---------- Storage ----------
  const storage = new StorageManager(state);

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

  // ---------- Panels ----------
  let _lastPanelTrigger = null;

  function updateAriaExpanded() {
    els.tocBtn.setAttribute("aria-expanded", String(document.body.classList.contains("show-toc")));
    els.settingsBtn.setAttribute("aria-expanded", String(!!document.getElementById("settingsScreen")));
    els.searchBtn.setAttribute("aria-expanded", String(document.body.classList.contains("show-search")));
    if (els.bookmarksBtn) els.bookmarksBtn.setAttribute("aria-expanded", String(document.body.classList.contains("show-bookmarks")));
  }

  function closePanels() {
    document.body.classList.remove("show-toc", "show-search", "show-bookmarks");
    search.clearHighlights();
    updateAriaExpanded();
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

  // ---------- Prefs application (Phase 4: each concern subscribes) ----------
  function applyPrefs() {
    const p = prefs.data;
    // Theme (reads from app-wide general prefs)
    const theme = generalPrefs.data.theme;
    document.body.classList.remove(...ALL_THEME_NAMES.map(t => `theme-${t}`));
    if (theme !== "dark") document.body.classList.add("theme-" + theme);

    // Font
    els.content.style.fontFamily = FONT_MAP[p.font] || FONT_SERIF;
    els.content.style.fontSize = p.size + "px";

    // Line height
    els.content.style.setProperty("--reading-line-height", String(p.lineHeight));

    // Margins via CSS class
    els.viewport.classList.remove("margin-narrow", "margin-normal", "margin-wide");
    els.viewport.classList.add("margin-" + (p.margin || "normal"));

    // Paragraph spacing
    els.content.classList.toggle("para-spaced", p.paraSpacing === "spaced");

    // Alignment
    els.content.style.textAlign = p.align === "left" ? "left" : "justify";

    // Images
    document.body.classList.toggle("images-off", !p.images);

    // Selection
    document.body.classList.toggle("selection-on", !!p.selection);

    // Layout mode
    document.body.classList.toggle("layout-scroll", p.layout === "scroll");

    // Meta theme color
    const tc = THEME_COLORS[theme];
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && tc) meta.setAttribute("content", tc);

    // Comfort overlay
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
    annotateInlineText(els.content);
  }

  // Wrap quoted speech and punctuation in spans for per-theme coloring.
  // Block-level so quote state can span inline elements like emphasis tags.
  function annotateInlineText(root) {
    root.querySelectorAll(".blk").forEach(annotateBlock);
  }

  function annotateBlock(blk) {
    const SPLIT = /(["\u201C\u201D])|([.,:;!?\u2014\u2013\u2026()\[\]])/g;
    const walker = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let nd;
    while ((nd = walker.nextNode())) nodes.push(nd);

    let inSpeech = false;
    for (const node of nodes) {
      const parent = node.parentNode;
      if (!parent) continue;
      if (parent.closest && parent.closest("code, pre")) continue;
      const text = node.nodeValue;
      let last = 0, m, hasMatch = false;
      const parts = [];

      const pushText = (t) => {
        if (!t) return;
        if (inSpeech) {
          const sp = document.createElement("span");
          sp.className = "inline-speech";
          sp.textContent = t;
          parts.push(sp);
        } else {
          parts.push(document.createTextNode(t));
        }
      };

      SPLIT.lastIndex = 0;
      while ((m = SPLIT.exec(text)) !== null) {
        hasMatch = true;
        pushText(text.slice(last, m.index));
        const ch = m[0];
        if (m[1]) {
          const sp = document.createElement("span");
          sp.className = "inline-speech";
          sp.textContent = ch;
          parts.push(sp);
          if (ch === "\u201C") inSpeech = true;
          else if (ch === "\u201D") inSpeech = false;
          else inSpeech = !inSpeech;
        } else {
          const sp = document.createElement("span");
          sp.className = inSpeech ? "inline-punct inline-punct-speech" : "inline-punct";
          sp.textContent = ch;
          parts.push(sp);
        }
        last = m.index + ch.length;
      }

      if (!hasMatch) {
        if (inSpeech) {
          const sp = document.createElement("span");
          sp.className = "inline-speech";
          sp.textContent = text;
          parent.replaceChild(sp, node);
        }
        continue;
      }

      pushText(text.slice(last));
      const frag2 = document.createDocumentFragment();
      for (const p of parts) frag2.appendChild(p);
      parent.replaceChild(frag2, node);
    }
  }

  // ---------- EPUB loading ----------
  async function loadEpub(file) {
    showLoading("Loading " + file.name + "\u2026");
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

      const meta = (book.packaging && book.packaging.metadata) || {};
      const title = (meta.title || file.name).trim();
      state.bookId = deriveBookId(urlParams.get("id"), meta.title, file.name);
      els.bookTitleEl.textContent = title;
      bookmarkManager.setBook(state.bookId);

      // Resolve images before renderBook so img.src is set when DOM is built.
      // Don't add to state.blobUrls yet — renderBook revokes everything in there
      // first (cleaning up the previous book). Track them after.
      const newBlobUrls = allImgUrls.length ? await resolveImageUrls(allImgUrls, book) : [];
      renderBook(sections);
      newBlobUrls.forEach(u => state.blobUrls.push(u));
      clearOverlay();
      if (onBookLoaded) onBookLoaded({ buffer, fileName: file.name, bookId: state.bookId });
      requestAnimationFrame(() => {
        pagination.paginate(false);
        buildTOC(epubToc, state.headingToc, els.tocListEl, state.sectionEls,
          (el) => pagination.goTo(pageOfElement(state, els.content, el), false),
          closePanels,
          (href) => resolveHref(href, els.content, state.sectionEls));
        storage.restorePos(applyCanonicalPosition);
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
    showLoading("Fetching book\u2026");
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
  if (els.bmPageIndicatorEl) {
    els.bmPageIndicatorEl.addEventListener("click", () => {
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

  // Scroll mode progress tracking (storage.savePos has its own debounce)
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

  // Mode switch buttons
  const modeBtn = document.getElementById("modeBtn");
  if (modeBtn && onModeSwitch) {
    modeBtn.addEventListener("click", () => {
      closeSettingsScreen();
      onModeSwitch("rsvp", { pos: getCanonicalPosition(), bookId: state.bookId });
    }, { signal });
  }
  const ttsModeBtn = document.getElementById("ttsModeBtn");
  if (ttsModeBtn && onModeSwitch) {
    ttsModeBtn.addEventListener("click", () => {
      closeSettingsScreen();
      onModeSwitch("tts", { pos: getCanonicalPosition(), bookId: state.bookId });
    }, { signal });
  }

  // ---------- Init ----------
  prefs.load();
  generalPrefs.load();
  applyPrefs();

  // Respect prefers-color-scheme on first load (no stored general prefs)
  if (!localStorage.getItem("general:prefs")) {
    const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    if (prefersLight) {
      generalPrefs.data.theme = "light";
      generalPrefs.save();
      applyPrefs();
    }
  }

  // Respect prefers-reduced-motion
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
    state.bookId = "Pride and Prejudice (sample)";
    bookmarkManager.setBook(state.bookId);
    els.bookTitleEl.textContent = "Pride and Prejudice";
    renderBook(buildSample());
    requestAnimationFrame(() => {
      pagination.paginate(false);
      buildTOC([], state.headingToc, els.tocListEl, state.sectionEls,
        (el) => pagination.goTo(pageOfElement(state, els.content, el), false),
        closePanels,
        (href) => resolveHref(href, els.content, state.sectionEls));
      storage.restorePos(applyCanonicalPosition);
      if (urlParams.get("selftest") === "1") {
        requestAnimationFrame(() => runSelftest(state));
      }
    });
  }

  // ---------- Handle object ----------
  return {
    teardown() {
      closeSettingsScreen();
      storage.flushPos(getCanonicalPosition);
      state.blobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (_) {} });
      state.blobUrls = [];
      if (resizeTimer) clearTimeout(resizeTimer);
    },
    getPosition: getCanonicalPosition,
    getBookId() { return state.bookId; },
    isBookLoaded() { return state.bookId && state.bookId !== "Pride and Prejudice (sample)"; },
    applyPosition(pos) { applyCanonicalPosition(pos); },
    loadFromBuffer(buffer, fileName) {
      const file = new File([buffer], fileName, { type: "application/epub+zip" });
      return loadEpub(file);
    },
  };
}
