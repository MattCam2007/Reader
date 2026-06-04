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
import { currentLocator, pageOfElement, pageOfWord, wordAtPageStart, wordAtPageStartRange } from './model/geometry.js';
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
import * as perf from './core/perf.js';

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
    const chapterLabel = state.windowed
      ? ((state.sectionLabels && state.sectionLabels[state.curChap]) || '')
      : (chrome ? chrome.currentChapterLabel() : '');
    let text = '';
    const wi = currentRenderToken();
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
    // Legacy bookmark without a canonical position — fall back to a fraction.
    if (state.windowed) {
      const n = state.chapWindows.length || 1;
      const sec = Math.max(0, Math.min(n - 1, Math.floor((item.fraction || 0) * n)));
      pagination.attachChap(sec);
      pagination.paginateWindow(false);
      const within = (item.fraction || 0) * n - sec;
      pagination.goTo(Math.round(within * (state.total - 1)), false);
    } else if (state.isScrollMode) {
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
    // The resume highlight lives until the page changes away from where it was set.
    if (state._resumeHlActive && !state.isScrollMode && state.page !== state._resumeHlPage) {
      clearResumeHighlight();
    }
    if (state.windowed) updateWindowedProgress();
    else chrome.updateProgress();
    chrome.updateBookmarkMarkers(bookmarkManager.getAll(), navigateToBookmark);
  }

  // Cheap global progress for windowed mode: chapter index + page-within-chapter,
  // no getBoundingClientRect so it stays off the page-turn hot path. The precise
  // word ordinal is only computed on (debounced) save / bookmark, not every turn.
  function updateWindowedProgress() {
    // Word-based global fraction (matches how bookmarks store position.f), derived
    // cheaply from the current chapter's word range + page-within-chapter — no
    // getBoundingClientRect, so it stays off the turn hot path.
    const totalWs = state.doc.wsToToken.length || 1;
    const sec = state.doc.sections[state.curChap];
    const within = state.total > 1 ? state.page / (state.total - 1) : 0;
    const wsHere = sec ? sec.wsStart + within * (sec.wsEnd - sec.wsStart) : 0;
    const frac = Math.max(0, Math.min(1, wsHere / totalWs));
    const pct = Math.round(frac * 100);
    els.progressEl.max = "1000";
    els.progressEl.value = String(Math.round(frac * 1000));
    // Page numbers are per-chapter while windowed; show chapter + page-in-chapter.
    const ch = (state.sectionLabels && state.sectionLabels[state.curChap]) || ("Chapter " + (state.curChap + 1));
    els.progressLabel.textContent = ch + " · p" + (state.page + 1) + (state.total > 1 ? " of " + state.total : "");
    if (els.bookSubEl) els.bookSubEl.textContent = pct + "% read";
  }

  // ---------- Canonical position ----------
  // Section table keyed by stable spine href — the shared anchor across modes.
  // Section table in WHITESPACE-word units (not render tokens), so the counts
  // match what RSVP/TTS report and cross-mode hand-off needs no lossy scaling.
  function readerSections() {
    return state.doc.sections.map(s => ({
      href: s.href,
      wordStart: s.wsStart,
      wordCount: s.wsEnd - s.wsStart,
    }));
  }
  function totalWsWords() { return state.doc.wsToToken.length; }
  // Raw text of whitespace word `o`, rebuilt from its render tokens (which the
  // annotator split at punctuation). Used for the text-anchored exact snap.
  function wsWordText(o) {
    const { doc } = state;
    if (o < 0 || o >= doc.wsToToken.length) return '';
    const startTok = doc.wsToToken[o];
    const endTok = o + 1 < doc.wsToToken.length ? doc.wsToToken[o + 1] : doc.words.length;
    let s = '';
    for (let t = startTok; t < endTok; t++) {
      const w = doc.words[t];
      s += w.node.nodeValue.slice(w.start, w.end);
    }
    return s;
  }
  // First render token currently on screen.
  function currentRenderToken() {
    if (state.windowed) {
      // Only the current chapter is laid out — scope the page→word search to it.
      const sec = state.doc.sections[state.curChap];
      if (!sec) return 0;
      return wordAtPageStartRange(state, els.content, state.page, sec.wordStart, sec.wordEnd);
    }
    if (state.isScrollMode) {
      const loc = currentLocatorFn();
      const wi = loc ? resolveLocator(state, loc) : 0;
      return wi >= 0 ? wi : 0;
    }
    return wordAtPageStart(state, els.content, state.page);
  }

  // Seek to a global render token. In windowed mode this attaches the token's
  // chapter (laying it out) before mapping the word to a page; otherwise it's the
  // normal page/scroll seek. The single funnel every navigation path goes through
  // (position restore, search hit, bookmark, cross-mode handoff).
  function seekToToken(tok) {
    if (!state.doc.words.length) return;
    tok = Math.max(0, Math.min(tok, state.doc.words.length - 1));
    if (state.windowed) {
      const sec = state.doc.words[tok].section;
      if (sec !== state.curChap) {
        pagination.attachChap(sec);
        pagination.paginateWindow(false);
      }
      pagination.goTo(pageOfWord(state, els.content, tok), false);
      return;
    }
    if (state.isScrollMode) pagination.scrollToWord(tok);
    else pagination.goTo(pageOfWord(state, els.content, tok), false);
  }

  // Seek so that `el` is on screen, attaching its chapter first in windowed mode.
  function seekToElement(el) {
    if (state.windowed) {
      const chap = el.closest && el.closest(".chap");
      const sec = chap ? state.doc.sections.findIndex(s => s.el === chap) : -1;
      if (sec >= 0 && sec !== state.curChap) {
        pagination.attachChap(sec);
        pagination.paginateWindow(false);
      }
    }
    pagination.goTo(pageOfElement(state, els.content, el), false);
  }

  // Per-section heading labels, captured while all chapters are attached (before
  // windowing detaches them). Used for the chapter label in windowed progress.
  function captureSectionLabels() {
    state.sectionLabels = state.doc.sections.map(s => {
      const h = s.el && s.el.querySelector(".blk-h1, .blk-h2, .blk-h3");
      return h ? h.textContent.trim() : (s.href || "");
    });
  }
  // Whitespace-word ordinal of the first WHOLE word on screen. If the first
  // render token is a continuation (its word began on the previous page, e.g. a
  // trailing punctuation span), advance to the next word that actually starts
  // here so save/restore round-trips to the same page.
  function currentWsOrdinal() {
    const { doc } = state;
    if (!doc.tokenToWs.length) return 0;
    const tok = Math.max(0, Math.min(currentRenderToken(), doc.tokenToWs.length - 1));
    let o = doc.tokenToWs[tok];
    if (doc.wsToToken[o] < tok && o + 1 < doc.wsToToken.length) o++;
    return o;
  }
  function getCanonicalPosition() {
    if (!state.doc.words.length) return null;
    return buildPosition(readerSections(), totalWsWords(), currentWsOrdinal(), wsWordText);
  }
  function applyCanonicalPosition(pos) {
    if (!state.doc.words.length) return;
    const ord = resolvePosition(pos, readerSections(), totalWsWords(), wsWordText);
    const { wsToToken } = state.doc;
    const startWs = wsToToken.length ? Math.max(0, Math.min(ord, wsToToken.length - 1)) : 0;
    const tok = wsToToken.length ? wsToToken[startWs] : 0;
    seekToToken(tok);
    // Highlight where we came from (1 word from RSVP, the whole sentence from
    // TTS). It persists until the next page turn / scroll — see updateProgressFn.
    if (pos && pos.hl) setResumeHighlight(startWs, pos.hl);
    else clearResumeHighlight();
  }

  // Images in the freshly-rendered book decode asynchronously; until they do
  // they occupy no space, so the column flow — and thus every word's page — is
  // wrong. Once any pending images settle, re-land on the same position. Guarded
  // so we never yank a reader who has already turned the page in the meantime.
  function resyncAfterImages(pos) {
    if (state.isScrollMode) return;
    const imgs = Array.from(els.content.querySelectorAll("img")).filter(im => !im.complete);
    if (!imgs.length) return;
    const landedPage = state.page;
    let done = false;
    const settle = () => {
      if (done || imgs.some(im => !im.complete)) return;
      done = true;
      if (state.page !== landedPage) return; // reader moved on — leave them be
      // refresh stride/total against the final layout (windowed = current chapter only)
      if (state.windowed) pagination.paginateWindow(false);
      else pagination.paginate(false);
      if (pos) applyCanonicalPosition(pos);
      else storage.restorePos(applyCanonicalPosition);
    };
    imgs.forEach(im => {
      im.addEventListener("load", settle, { once: true, signal });
      im.addEventListener("error", settle, { once: true, signal });
    });
  }

  // ---------- Resume highlight ----------
  function setResumeHighlight(startWs, hlWords) {
    clearResumeHighlight();
    if (typeof CSS === "undefined" || !CSS.highlights || typeof Highlight === "undefined") return;
    const { doc } = state;
    if (!doc.wsToToken.length || !(hlWords >= 1)) return;
    const endWs = Math.min(doc.wsToToken.length - 1, startWs + hlWords - 1);
    const startTok = doc.wsToToken[startWs];
    const endExcl = endWs + 1 < doc.wsToToken.length ? doc.wsToToken[endWs + 1] : doc.words.length;
    const a = doc.words[startTok];
    const b = doc.words[Math.max(startTok, endExcl - 1)];
    if (!a || !b) return;
    try {
      const range = document.createRange();
      range.setStart(a.node, a.start);
      range.setEnd(b.node, b.end);
      CSS.highlights.set("reader-resume", new Highlight(range));
      state._resumeHlActive = true;
      state._resumeHlPage = state.page;
      state._resumeHlScrollTop = state.isScrollMode ? els.viewport.scrollTop : 0;
    } catch (e) { console.warn("resume:highlight", e); }
  }
  function clearResumeHighlight() {
    if (!state._resumeHlActive) return;
    state._resumeHlActive = false;
    if (typeof CSS !== "undefined" && CSS.highlights) {
      try { CSS.highlights.delete("reader-resume"); } catch (_) {}
    }
  }

  // ---------- Pagination ----------
  const pagination = new PaginationEngine(state, els, currentLocatorFn, buildChapterIndexFn, updateProgressFn, savePosMain);

  // ---------- Storage ----------
  const storage = new StorageManager(state);

  // ---------- Footnotes ----------
  const footnotes = new FootnoteManager(state, els, (targetEl) => {
    if (state.windowed) { seekToElement(targetEl); return; }
    pagination.goTo(pageOfElement(state, els.content, targetEl), true);
  });

  // ---------- Search ----------
  function goToLocator(loc) {
    const wi = resolveLocator(state, loc);
    if (wi < 0) return;
    seekToToken(wi);
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
        if (needsRepaginate) relayout();
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
    perf.mark("reader:render");
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
    perf.measure("reader:render", { sections: sections.length });
    perf.time("reader:annotate", () => annotateInlineText(els.content));
  }

  // Lay out a freshly-rendered book and land the reader on `pos` (or the saved
  // position). Builds the global doc-model once while every chapter is attached,
  // then either windows down to one chapter (paginated — the default) or lays out
  // the whole book (scroll mode, which can't be windowed).
  function finalizeLayout(epubToc, pos) {
    pagination.ensureDocModel();      // global model; word→node refs survive windowing
    captureSectionLabels();
    if (state.isScrollMode) {
      state.windowed = false;
      perf.time("reader:paginate", () => pagination.paginate(false));
    } else {
      state.windowed = true;
      pagination.setupWindow(0);
      perf.time("reader:paginate", () => pagination.paginateWindow(false));
    }
    buildTOC(epubToc || [], state.headingToc, els.tocListEl, state.sectionEls,
      seekToElement, closePanels,
      (href) => resolveHref(href, els.content, state.sectionEls));
    if (pos) applyCanonicalPosition(pos);
    else storage.restorePos(applyCanonicalPosition);
    if (!state.windowed) resyncAfterImages(pos);
  }

  // Re-lay-out in place (resize, font/margin change, or a layout-mode toggle),
  // preserving the reading position via the canonical position. Handles entering
  // windowed mode (paginated) and exiting it (scroll) at runtime.
  function relayout() {
    if (!state.docModelBuilt) return;
    const pos = state.doc.words.length ? getCanonicalPosition() : null;
    if (state.isScrollMode) {
      if (state.windowed) { pagination.reattachAll(); state.windowed = false; }
      pagination.paginate(false);
    } else {
      if (!state.windowed) { pagination.setupWindow(state.curChap || 0); state.windowed = true; }
      pagination.paginateWindow(false);
    }
    if (pos) applyCanonicalPosition(pos);
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
  async function loadEpub(file, pos) {
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

      const { sections, allImgUrls } = await perf.timeAsync("reader:extract", () =>
        extractSections(book, (msg) => {
          els.overlayMsg.textContent = msg;
        }));
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
      // Web fonts (e.g. OpenDyslexic, declared font-display:swap) reflow the
      // text when they finish loading. If we paginate against the fallback font's
      // metrics, every word→page mapping is measured too wide/narrow and the
      // handed-off position lands a page off — visible as a one-page overshoot on
      // the very first switch into the Reader, then "stable" once the font is
      // cached. Wait for fonts so the first pagination is already accurate.
      if (typeof document !== "undefined" && document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch (_) {}
      }
      // Paginate and restore inside a rAF so layout (stride/total) is final
      // before we map a word ordinal to a page. Await it so loadFromBuffer only
      // resolves once the position is applied — see mode-switcher handoff.
      await new Promise((resolve) => {
        requestAnimationFrame(() => {
          try {
            finalizeLayout(epubToc, pos);
            if (urlParams.get("selftest") === "1") {
              requestAnimationFrame(() => runSelftest(state));
            }
          } catch (e) { console.warn("reader:layout", e); }
          finally { resolve(); }
        });
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
  els.progressEl.addEventListener("input", () => {
    if (state.windowed) {
      // The bar is a 0–1000 word-fraction scrubber; map to a word and seek.
      const totalWs = state.doc.wsToToken.length;
      if (!totalWs) return;
      const frac = (parseInt(els.progressEl.value, 10) || 0) / 1000;
      const ws = Math.max(0, Math.min(totalWs - 1, Math.round(frac * (totalWs - 1))));
      seekToToken(state.doc.wsToToken[ws]);
      return;
    }
    pagination.goTo(parseInt(els.progressEl.value, 10) || 0, false);
  }, { signal });
  els.content.addEventListener("click", (e) => footnotes.handleContentClick(e), { signal });

  // Scroll mode progress tracking (storage.savePos has its own debounce)
  els.viewport.addEventListener("scroll", () => {
    if (!state.isScrollMode) return;
    // Clear the resume highlight once the user scrolls away from where it landed
    // (ignore the programmatic scroll that placed it).
    if (state._resumeHlActive && Math.abs(els.viewport.scrollTop - (state._resumeHlScrollTop || 0)) > 8) {
      clearResumeHighlight();
    }
    chrome.updateProgress();
    savePosMain();
  }, { passive: true, signal });

  // Resize
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => relayout(), RESIZE_DEBOUNCE_MS);
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
      finalizeLayout([], null);
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
    loadFromBuffer(buffer, fileName, pos) {
      const file = new File([buffer], fileName, { type: "application/epub+zip" });
      return loadEpub(file, pos);
    },
  };
}
