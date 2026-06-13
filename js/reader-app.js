import { FONT_MAP, FONT_SERIF, RESIZE_DEBOUNCE_MS, GENERAL_DEFAULTS, WINDOW_MIN_WORDS, MIN_SIZE, MAX_SIZE } from './core/constants.js';
import { applyTheme, applyOsThemeFallback, applyBgSettings } from './base-reader-app.js';
import { openSettingsScreen, closeSettingsScreen, isSettingsScreenOpen } from './settings/settings-screen.js';
import { BookmarkManager } from './core/bookmarks.js';
import { initBookmarksPanel } from './bookmarks/panel.js';
import { PrefsManager } from './core/prefs.js';
import { ReaderState } from './core/state.js';
import { StorageManager } from './core/storage.js';
import { BookSession } from './core/book-session.js';
import { renderSections, annotateInlineText } from './shared/render.js';
import { buildTOC, resolveHref } from './formats/epub/toc.js';
import { toLocator, resolveLocator } from './model/locator.js';
import { currentLocator, pageOfElement, pageOfWord, wordAtPageStart, wordAtPageStartRange } from './model/geometry.js';
import { buildPosition, resolvePosition } from './core/position.js';
import { validateBookSrcUrl } from './core/src-url.js';
import { buildChapterIndex } from './reader/chapters.js';
import { PaginationEngine } from './reader/pagination.js';
import { PageCounter } from './reader/page-counter.js';
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
    contentClip:   document.getElementById("contentClip"),
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
    bmCloseBtn:    document.getElementById("bmCloseBtn"),
    bmList:        document.getElementById("bmList"),
    bmMarkersEl:   document.getElementById("bmMarkers"),
    bmColorPopoverEl: document.getElementById("bmColorPopover"),
    quickBmBtnEl:  document.getElementById("quickBmBtn"),
    fullscreenBtnEl: document.getElementById("fullscreenBtn"),
    bookBtn:       document.getElementById("bookBtn"),
    bookMenu:      document.getElementById("bookMenu"),
    topbar:        document.getElementById("topbar"),
    bottombar:     document.getElementById("bottombar"),
    readerQuickDrawer:  document.getElementById("readerQuickDrawer"),
    readerDrawerHandle: document.getElementById("readerDrawerHandle"),
    readerQuickPanel:   document.getElementById("readerQuickPanel"),
    qdSizeDown:    document.getElementById("qdSizeDown"),
    qdSizeUp:      document.getElementById("qdSizeUp"),
    qdSizeVal:     document.getElementById("qdSizeVal"),
    qdLhDown:      document.getElementById("qdLhDown"),
    qdLhUp:        document.getElementById("qdLhUp"),
    qdLhVal:       document.getElementById("qdLhVal"),
    qdParaSeg:     document.getElementById("qdParaSeg"),
    qdFontSeg:     document.getElementById("qdFontSeg"),
    qdMarginSeg:   document.getElementById("qdMarginSeg"),
    qdAlignSeg:    document.getElementById("qdAlignSeg"),
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
    { panelEl: els.bookmarksPanel, listEl: els.bmList, addBtnEl: els.bmAddBtn, closeBtnEl: els.bmCloseBtn },
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
    if (!state.doc.words.length) return;
    let pos = item.position;
    if (!pos) {
      // Legacy bookmark with only a fraction: resolve it through the canonical
      // pipeline (fraction → word ordinal → seekToToken) instead of scaling
      // pages/scrollTop, which drifted with word density. Then migrate the
      // resolved position onto the bookmark so the legacy path decays to zero.
      const ord = resolvePosition({ f: item.fraction || 0 }, readerSections(), totalWsWords(), wsWordText);
      pos = buildPosition(readerSections(), totalWsWords(), ord, wsWordText);
      bookmarkManager.updatePosition(item.id, pos);
    }
    applyCanonicalPosition(pos);
  }

  // ---------- Chrome ----------
  const chrome = new ChromeManager(state, els);

  bmPanel.setCallbacks({
    getContext: getBookmarkContext,
    onNavigate: navigateToBookmark,
    closePanel: () => { document.body.classList.remove('show-bookmarks'); updateAriaExpanded(); },
    onBookmarksChange: () => chrome.updateBookmarkMarkers(bookmarkManager.getAll(), navigateToBookmark, bookmarkManager.generation),
  });

  // ---------- Helpers ----------
  function currentLocatorFn() {
    // Span (?perf=1): this is the scroll-mode save path — the A3 anchor change
    // must stay provably cheap.
    return perf.time('reader:locator', () =>
      currentLocator(state, els.content, els.viewport, (wi) => toLocator(state, wi)));
  }
  function buildChapterIndexFn() { buildChapterIndex(state, els.content); }
  function savePosMain() {
    storage.savePos(() => {
      const pos = getCanonicalPosition();
      // Cache the anchor while the layout is intact. The debounced save only runs
      // once the reader pauses, so this records the first word on screen at a
      // stable moment — what relayout() restores after a viewport resize reflows
      // the DOM out from under a now-stale page number. See relayout().
      if (pos && !state.isScrollMode) state._lastPos = pos;
      return pos;
    });
  }
  function updateProgressFn() {
    // The resume highlight lives until the page changes away from where it was set.
    if (state._resumeHlActive && !state.isScrollMode && state.page !== state._resumeHlPage) {
      clearResumeHighlight();
    }
    if (state.windowed) updateWindowedProgress();
    else chrome.updateProgress();
    chrome.updateBookmarkMarkers(bookmarkManager.getAll(), navigateToBookmark, bookmarkManager.generation);
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
    // Whole-book page indicator in the subtitle (idle-measured, cached).
    pageCounter.recordCurrent();
    if (els.bookSubEl) {
      if (state.windowed && state.pageCounts.length > 0) {
        const ov = pageCounter.overall(state.curChap, state.page);
        const pfx = ov.approx ? "~" : "";
        els.bookSubEl.textContent = pfx + "Page " + ov.page + " of " + pfx + ov.total + " · " + pct + "%";
      } else {
        els.bookSubEl.textContent = pct + "% read";
      }
    }
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
      let attached = false;
      if (sec !== state.curChap) {
        pagination.attachChap(sec);
        pagination.paginateWindow(false);
        attached = true;
      }
      pagination.goTo(pageOfWord(state, els.content, tok), false);
      if (attached) {
        // pageOfWord (and thus getCanonicalPosition) may return the wrong page
        // before images in the newly-attached chapter have decoded — they occupy
        // no layout space until then, so words appear to be on page 0. Build the
        // reseek position from the target token's ws ordinal instead: it is
        // layout-independent and resolves to the correct page once images settle.
        const wsOrd = Math.max(0, Math.min(
          state.doc.tokenToWs[tok] ?? 0,
          state.doc.wsToToken.length - 1
        ));
        resyncAfterImages(buildPosition(readerSections(), totalWsWords(), wsOrd, wsWordText));
      }
      return;
    }
    if (state.isScrollMode) pagination.scrollToWord(tok);
    else pagination.goTo(pageOfWord(state, els.content, tok), false);
  }

  // Seek so that `el` is on screen, attaching its chapter first in windowed mode.
  function seekToElement(el) {
    let attached = false;
    let attachedSecIdx = -1;
    if (state.windowed) {
      const chap = el.closest && el.closest(".chap");
      const secIdx = chap ? state.doc.sections.findIndex(s => s.el === chap) : -1;
      if (secIdx >= 0 && secIdx !== state.curChap) {
        pagination.attachChap(secIdx);
        pagination.paginateWindow(false);
        attached = true;
        attachedSecIdx = secIdx;
      }
    }
    pagination.goTo(pageOfElement(state, els.content, el), false);
    if (state.windowed) {
      // Same image-decode hazard as seekToToken — applies to both the
      // newly-attached chapter AND the same-chapter case (e.g. within-file
      // chapter headings in a multi-chapter spine item where images at the
      // top of the file haven't decoded yet when pageOfElement runs).
      const secIdx = attached ? attachedSecIdx : state.curChap;
      const sec = state.doc.sections[secIdx];
      let wsOrd = sec ? sec.wsStart : 0;
      if (sec) {
        const { words, tokenToWs } = state.doc;
        for (let i = sec.wordStart; i < sec.wordEnd; i++) {
          if (el.contains(words[i].node)) { wsOrd = tokenToWs[i]; break; }
        }
      }
      resyncAfterImages(buildPosition(
        readerSections(), totalWsWords(),
        Math.max(0, Math.min(wsOrd, state.doc.wsToToken.length - 1)),
        wsWordText
      ));
    }
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

  // ---------- Paragraph-start glue ----------
  // Force `el` (a .blk block) to begin a fresh column so it lands at the top of
  // the page after the next pagination. At most one block carries the class; this
  // moves it. Pass null to clear (scroll layout, or no position to preserve).
  // Purely a class toggle — it never touches the doc-model's node references.
  function setGlueBlock(el) {
    if (state._glueBlockEl === el) return;
    if (state._glueBlockEl) state._glueBlockEl.classList.remove("glue-break");
    state._glueBlockEl = el || null;
    if (el) el.classList.add("glue-break");
  }
  // Glue the paragraph that holds the first word of `pos` (a canonical position).
  // Resolving pos → word → block is layout-independent, so this can run *before*
  // pagination, putting the forced column break in place when totals are computed.
  function setGlueBlockForPos(pos) {
    const { doc } = state;
    if (!pos || !doc.wsToToken.length) { setGlueBlock(null); return; }
    const ord = resolvePosition(pos, readerSections(), totalWsWords(), wsWordText);
    const startWs = Math.max(0, Math.min(ord, doc.wsToToken.length - 1));
    const tok = doc.wsToToken[startWs];
    const w = doc.words[tok];
    const blk = w ? doc.blocks[w.block] : null;
    setGlueBlock(blk ? blk.el : null);
  }

  // Images in the freshly-rendered book decode asynchronously; until they do
  // they occupy no space, so the column flow — and thus every word's page — is
  // wrong. Once any pending images settle, re-land on the same position. Guarded
  // so we never yank a reader who has already turned the page in the meantime.
  // Re-land after images in the currently-attached content decode. Works for the
  // initial load (full or windowed chapter 0) AND for a newly-entered windowed
  // chapter: images in a just-attached .chap occupy no space until decode, so its
  // column flow — and the landed page — is wrong until then. Captures page +
  // chapter so we never yank a reader who has turned away in the meantime.
  function resyncAfterImages(pos) {
    if (state.isScrollMode) return;
    const imgs = Array.from(els.content.querySelectorAll("img")).filter(im => !im.complete);
    if (!imgs.length) return;
    const landedPage = state.page;
    const landedChap = state.curChap;
    // On an explicit restore use the supplied position; otherwise keep the word
    // we're currently on so the relayout lands back exactly where the reader is.
    const reseek = pos || (state.windowed ? getCanonicalPosition() : null);
    let done = false;
    const settle = () => {
      if (done || imgs.some(im => !im.complete)) return;
      done = true;
      perf.mark("reader:image-settle");
      if (state.page !== landedPage || (state.windowed && state.curChap !== landedChap)) {
        // The reader turned away while images decoded — don't yank them back.
        // But the debounced save running since they turned was measured against
        // the provisional (images-collapsed) layout; re-save from the settled
        // one so the stored position matches what is actually on screen,
        // instead of persisting the provisional capture.
        storage.savePos(getCanonicalPosition);
        perf.measure("reader:image-settle", { aborted: true });
        return;
      }
      // refresh stride/total against the final layout (windowed = current chapter only)
      if (state.windowed) pagination.paginateWindow(false);
      else pagination.paginate(false);
      // The reseek target is a ws-ordinal position (layout-independent), so
      // seeking with it is safe; the post-seek save inside goTo re-captures
      // against the settled layout.
      if (reseek) applyCanonicalPosition(reseek);
      else storage.restorePos(applyCanonicalPosition);
      perf.measure("reader:image-settle", { imgs: imgs.length });
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

  // ---------- Page counter (whole-book page numbers in windowed mode) ----------
  const pageCounter = new PageCounter(state, els, prefs);

  // ---------- Pagination ----------
  const pagination = new PaginationEngine(state, els, currentLocatorFn, buildChapterIndexFn, updateProgressFn, savePosMain);
  // After a chapter-boundary page turn, re-land once the new chapter's images
  // decode (their flow shifts until then). No-op when the chapter has no images.
  pagination.onWindowTurn = () => resyncAfterImages();

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
    // Stored module state, not a live document.getElementById — book content
    // can carry an id="settingsScreen" element and shadow the lookup (B6).
    els.settingsBtn.setAttribute("aria-expanded", String(isSettingsScreenOpen()));
    els.searchBtn.setAttribute("aria-expanded", String(document.body.classList.contains("show-search")));
    if (els.bookmarksBtn) els.bookmarksBtn.setAttribute("aria-expanded", String(document.body.classList.contains("show-bookmarks")));
  }

  function closePanels() {
    document.body.classList.remove("show-toc", "show-search", "show-bookmarks");
    search.clearHighlights();
    updateAriaExpanded();
    if (prefs.data.quickDrawerOpen) applyQuickDrawerOpen(false);
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
        // Capture the reading position from the CURRENT (pre-change) layout before
        // we touch anything. Mutating `prefs.data.layout` instantly flips
        // state.isScrollMode, and applyPrefs() toggles the layout-scroll body
        // class which reflows the DOM — either makes a position read taken
        // afterwards garbage (it lands back at the start). See relayout().
        const pos = (needsRepaginate && state.docModelBuilt && state.doc.words.length)
          ? getCanonicalPosition() : null;
        prefs.data[key] = value;
        applyPrefs();
        if (needsRepaginate) relayout(pos);
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
    toggleChrome: () => {
      if (prefs.data.quickDrawerOpen) {
        applyQuickDrawerOpen(false);
      } else {
        chrome.toggle();
      }
    },
    dismissCoach,
    closePanels,
    dismissSelBar: () => selection.dismiss(),
    dismissNotePopover: () => footnotes.dismiss(),
    activePopoverRef: () => footnotes.activePopover,
  }, signal);

  // ---------- Overlay ----------
  function showLoading(msg) {
    document.body.classList.remove("error", "welcome");
    document.body.classList.add("loading");
    els.overlayBtn.hidden = true;
    els.overlayMsg.textContent = msg;
  }
  function showError(msg) {
    document.body.classList.remove("loading", "welcome");
    document.body.classList.add("error");
    els.overlayMsg.textContent = msg;
    els.overlayBtn.hidden = false;
  }
  function showWelcome() {
    document.body.classList.remove("loading", "error");
    document.body.classList.add("welcome");
    els.overlayMsg.textContent = "Open an EPUB or PDF to start reading.";
    els.overlayBtn.textContent = "Open a book";
    els.overlayBtn.hidden = false;
  }
  function clearOverlay() {
    document.body.classList.remove("loading", "error", "welcome");
  }

  // ---------- Prefs application (Phase 4: each concern subscribes) ----------
  function applyPrefs() {
    const p = prefs.data;
    // Theme (reads from app-wide general prefs) — body class + browser-chrome color.
    applyTheme(generalPrefs.data.theme);

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
    els.content.classList.toggle("para-both",   p.paraSpacing === "both");

    // Alignment
    els.content.style.textAlign = p.align === "left" ? "left" : "justify";

    // Images
    document.body.classList.toggle("images-off", !p.images);

    // Selection
    document.body.classList.toggle("selection-on", !!p.selection);

    // Layout mode
    document.body.classList.toggle("layout-scroll", p.layout === "scroll");

    // Comfort overlay
    if (els.comfortDim) els.comfortDim.style.opacity = String(1 - (p.brightness || 1));
    if (els.comfortWarm) els.comfortWarm.style.opacity = String(p.warmth || 0);

    // Background image and opacity
    applyBgSettings(generalPrefs);

    // Sync quick drawer display values
    if (els.qdSizeVal)    els.qdSizeVal.textContent = String(p.size);
    if (els.qdLhVal)      els.qdLhVal.textContent = Number(p.lineHeight).toFixed(1);
    if (els.qdParaSeg) {
      els.qdParaSeg.querySelectorAll('[data-para]').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.para === p.paraSpacing);
      });
    }
    if (els.qdFontSeg) {
      els.qdFontSeg.querySelectorAll('[data-font]').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.font === (p.font || 'serif'));
      });
    }
    if (els.qdMarginSeg) {
      els.qdMarginSeg.querySelectorAll('[data-margin]').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.margin === (p.margin || 'normal'));
      });
    }
    if (els.qdAlignSeg) {
      els.qdAlignSeg.querySelectorAll('[data-align]').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.align === (p.align || 'justify'));
      });
    }
  }

  // ---------- Rendering ----------
  function renderBook(sections) {
    perf.mark("reader:render");
    state.headingToc = [];
    state.docModelBuilt = false;
    // Drop references into the outgoing book's DOM before it's replaced, so we
    // don't pin a detached element or carry a stale anchor into the new book.
    state._glueBlockEl = null;
    state._lastPos = null;
    renderSections(els.content, sections, {
      sectionEls: state.sectionEls,
      onHeading: (h) => state.headingToc.push(h),
    });
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
    if (shouldWindow()) {
      state.windowed = true;
      // Clear stale counts from any previously-loaded book before paginateWindow
      // fires updateProgressFn. Without this the old book's pageCounts are live
      // during that first updateWindowedProgress call and the wrong total shows.
      state.pageCounts = [];
      state.pageCountsComplete = false;
      pagination.setupWindow(0);
      perf.time("reader:paginate", () => pagination.paginateWindow(false));
      pageCounter.begin(updateProgressFn);
    } else {
      state.windowed = false;
      perf.time("reader:paginate", () => pagination.paginate(false));
    }
    buildTOC(epubToc || [], state.headingToc, els.tocListEl, state.sectionEls,
      seekToElement, closePanels,
      (href) => resolveHref(href, els.content, state.sectionEls));
    if (pos) applyCanonicalPosition(pos);
    else storage.restorePos(applyCanonicalPosition);
    resyncAfterImages(pos);
  }

  // Window only when it pays off: paginated layout, more than one chapter, and a
  // book large enough that whole-book layout is paint-bound (scroll layout can't
  // be windowed — it needs the whole book in one flow). Small books render whole
  // and skip the per-chapter-boundary relayout cost.
  function shouldWindow() {
    return !state.isScrollMode
      && state.doc.sections.length > 1
      // forceWindow is a test-only override (selftest drives all three layout
      // modes on the small sample book, which never crosses WINDOW_MIN_WORDS).
      && (state.forceWindow === true || state.doc.wsToToken.length >= WINDOW_MIN_WORDS);
  }

  // Re-lay-out in place (resize, font/margin change, or a layout-mode toggle),
  // preserving the reading position via the canonical position. Handles entering
  // windowed mode (paginated) and exiting it (scroll) at runtime.
  // `savedPos` (optional): a canonical position captured by the caller *before*
  // it changed prefs/DOM. Pass it whenever the relayout is triggered by a
  // settings change — capturing here would read the already-half-changed layout
  // and lose the place. Omit it (resize) to capture from the current, intact
  // layout. `undefined` means "capture yourself"; an explicit value/null is used
  // as-is.
  function relayout(savedPos) {
    if (!state.docModelBuilt) return;
    // For a self-captured relayout (resize / fullscreen toggle, savedPos ===
    // undefined) in a paginated layout, restore the cached anchor rather than
    // reading the position now: a viewport resize has already reflowed the DOM
    // while state.page still describes the old layout, so re-deriving the anchor
    // here jumps several pages. Scroll mode reads its position from live scrollTop
    // (still correct after a reflow), so it keeps capturing fresh.
    const pos = savedPos !== undefined
      ? savedPos
      : (state.doc.words.length
          ? ((!state.isScrollMode && state._lastPos) ? state._lastPos : getCanonicalPosition())
          : null);
    // Paragraph-start glue: force the paragraph holding the first word on screen
    // to begin a fresh column, so after the reflow it lands at the TOP of the page
    // (the page fills below it) rather than partway down. Set before pagination so
    // the new column boundary is in place when totals are computed. Cleared in
    // scroll mode (no columns) and when there is no position to preserve.
    if (pos && !state.isScrollMode) setGlueBlockForPos(pos);
    else setGlueBlock(null);
    if (shouldWindow()) {
      if (!state.windowed) { pagination.setupWindow(state.curChap || 0); state.windowed = true; }
      pagination.paginateWindow(false);
      const newSig = pageCounter.computeSignature();
      if (newSig !== state.pageCountSig) pageCounter.invalidate(updateProgressFn);
    } else {
      if (state.windowed) {
        pagination.reattachAll();
        state.windowed = false;
        pageCounter.destroy();
      }
      pagination.paginate(false);
    }
    if (pos) applyCanonicalPosition(pos);
    // Pin the cached anchor to the word we just restored, so a follow-up relayout
    // (a second font tweak, a rotation right after another) preserves the SAME
    // first word instead of re-reading from a stale page number in the window
    // before the next debounced save refreshes it.
    if (pos && !state.isScrollMode) state._lastPos = pos;
    // Marker dots are positioned against the live layout; a relayout (resize,
    // font/spacing change, mode switch) moves them even when the bookmark set is
    // unchanged. Paginated turns refresh via goTo->updateProgressFn, but a scroll
    // seek doesn't, so refresh here to cover every mode. The layout-signature
    // gate inside makes this a no-op when nothing actually moved.
    chrome.updateBookmarkMarkers(bookmarkManager.getAll(), navigateToBookmark, bookmarkManager.generation);
  }

  // Live-apply a re-paginating pref change (quick drawer) while preserving the
  // reading position. Capture must happen before applyPrefs() reflows the DOM,
  // so we snapshot the position here and hand it to relayout(). See relayout().
  function applyPrefAndRelayout() {
    const pos = (state.docModelBuilt && state.doc.words.length) ? getCanonicalPosition() : null;
    applyPrefs();
    relayout(pos);
  }


  // ---------- EPUB loading ----------
  // Build the mode-agnostic session (parse + extract + resolve images) once,
  // then render it. Switching modes later reuses the session via loadFromSession.
  async function loadEpub(file, pos) {
    showLoading("Loading " + file.name + "\u2026");
    closePanels();
    try {
      const buffer = await file.arrayBuffer();
      const session = await perf.timeAsync("reader:extract", () =>
        BookSession.fromBuffer(buffer, file.name, urlParams.get("id"), (msg) => {
          els.overlayMsg.textContent = msg;
        }));
      await loadFromSession(session, pos);
    } catch (err) {
      console.error("EPUB load failed:", err);
      showError(err && err.message ? err.message : "Couldn't read that file.");
    }
  }

  // Render an already-extracted session (a fresh load, or a hand-off from
  // another mode). Skips ePub()/extractSections entirely \u2014 that work is done.
  let _suppressSampleLayout = false;
  async function loadFromSession(session, pos) {
    // Prevent the sample-book rAF (scheduled unconditionally in init) from
    // calling finalizeLayout after we've already replaced the DOM with the real
    // book. Without this guard the second setupWindow() call sees only the one
    // attached chapter and overwrites chapWindows with a 1-entry array, breaking
    // page counting for every chapter beyond the first.
    _suppressSampleLayout = true;
    closePanels();
    try {
      state.bookId = session.bookId;
      els.bookTitleEl.textContent = session.title || session.bookId;
      bookmarkManager.setBook(state.bookId);

      // Stage the heavy steps with a real paint between them. Each step below
      // runs synchronously and can take a while on a large book (a 100k-word PDF
      // builds thousands of blocks); updating the overlay then yielding a frame
      // means the user sees which step is running instead of a single frozen
      // "Parsing\u2026" message, and the browser stays responsive between steps.
      const yieldFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

      els.overlayMsg.textContent = "Rendering\u2026";
      await yieldFrame();
      renderBook(session.sections);

      if (onBookLoaded) onBookLoaded({ session });
      // Web fonts (e.g. OpenDyslexic, declared font-display:swap) reflow the
      // text when they finish loading. If we paginate against the fallback font's
      // metrics, every word->page mapping is measured too wide/narrow and the
      // handed-off position lands a page off. Wait for fonts so the first
      // pagination is already accurate.
      if (typeof document !== "undefined" && document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch (_) {}
      }

      // Paginate and restore after a paint so layout (stride/total) is final
      // before we map a word ordinal to a page. The overlay stays up through this
      // step (no black screen) and is cleared once the position is applied.
      els.overlayMsg.textContent = "Formatting\u2026";
      await yieldFrame();
      try {
        finalizeLayout(session.toc, pos);
      } catch (e) { console.warn("reader:layout", e); }
      clearOverlay();
      if (urlParams.get("selftest") === "1") {
        requestAnimationFrame(() => runSelftest(state, selftestHooks));
      }
    } catch (err) {
      console.error("book render failed:", err);
      showError(err && err.message ? err.message : "Couldn't read that file.");
    }
  }

  async function loadFromUrl(url) {
    const safeUrl = validateBookSrcUrl(url);
    if (!safeUrl) { showError("That book URL isn't allowed."); return; }
    showLoading("Fetching book\u2026");
    closePanels();
    try {
      const resp = await fetch(safeUrl);
      if (!resp.ok) throw new Error("Fetch failed: " + resp.status);
      const blob = await resp.blob();
      const filename = safeUrl.split("/").pop() || "book.epub";
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
  if (els.quickBmBtnEl) {
    let _longPressTimer = null;
    let _longPressFired = false;

    function _openColorPopover() {
      const popover = els.bmColorPopoverEl;
      if (!popover) return;
      const pageBookmarks = chrome.getPageBookmarks(bookmarkManager.getAll());
      const currentColor = pageBookmarks.length > 0 ? (pageBookmarks[0].color || '') : '';
      popover.querySelectorAll('.bm-cp-swatch').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.color === currentColor);
      });
      popover.removeAttribute('hidden');
    }

    function _closeColorPopover() {
      if (els.bmColorPopoverEl) els.bmColorPopoverEl.setAttribute('hidden', '');
    }

    els.quickBmBtnEl.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });

    els.quickBmBtnEl.addEventListener('pointerdown', () => {
      _longPressFired = false;
      _longPressTimer = setTimeout(() => {
        _longPressTimer = null;
        _longPressFired = true;
        _openColorPopover();
      }, 500);
    }, { signal });

    els.quickBmBtnEl.addEventListener('pointerup', () => {
      if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
    }, { signal });

    els.quickBmBtnEl.addEventListener('pointercancel', () => {
      if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
    }, { signal });

    els.quickBmBtnEl.addEventListener("click", () => {
      if (_longPressFired) { _longPressFired = false; return; }
      if (els.quickBmBtnEl.classList.contains("bookmarked")) {
        _lastPanelTrigger = els.bookmarksBtn;
        closePanels();
        closeSettingsScreen();
        document.body.classList.add("show-bookmarks");
        document.body.classList.remove("chrome-hidden");
        bmPanel.render();
        updateAriaExpanded();
      } else {
        const ctx = getBookmarkContext();
        if (!ctx) return;
        bookmarkManager.add(ctx);
        bmPanel.render();
        chrome.updateBookmarkMarkers(bookmarkManager.getAll(), navigateToBookmark, bookmarkManager.generation);
        els.quickBmBtnEl.classList.add("bm-flash");
        setTimeout(() => els.quickBmBtnEl.classList.remove("bm-flash"), 600);
      }
    }, { signal });

    if (els.bmColorPopoverEl) {
      els.bmColorPopoverEl.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.bm-cp-delete');
        if (deleteBtn) {
          chrome.getPageBookmarks(bookmarkManager.getAll()).forEach(bm => bookmarkManager.remove(bm.id));
          bmPanel.render();
          chrome.updateBookmarkMarkers(bookmarkManager.getAll(), navigateToBookmark, bookmarkManager.generation);
          _closeColorPopover();
          return;
        }
        const btn = e.target.closest('.bm-cp-swatch, .bm-cp-clear');
        if (!btn) return;
        const color = btn.dataset.color || '';
        const allBm = bookmarkManager.getAll();
        const pageBookmarks = chrome.getPageBookmarks(allBm);
        if (pageBookmarks.length > 0) {
          pageBookmarks.forEach(bm => bookmarkManager.updateColor(bm.id, color));
        } else {
          const ctx = getBookmarkContext();
          if (ctx) bookmarkManager.add({ ...ctx, color });
        }
        bmPanel.render();
        chrome.updateBookmarkMarkers(bookmarkManager.getAll(), navigateToBookmark, bookmarkManager.generation);
        _closeColorPopover();
      }, { signal });

      document.addEventListener('pointerdown', (e) => {
        if (!els.bmColorPopoverEl.hasAttribute('hidden') &&
            !els.bmColorPopoverEl.contains(e.target) &&
            e.target !== els.quickBmBtnEl) {
          _closeColorPopover();
        }
      }, { signal });
    }
  }
  if (els.fullscreenBtnEl) {
    if (!document.fullscreenEnabled) {
      els.fullscreenBtnEl.hidden = true;
    } else {
      // Position captured BEFORE the fullscreen toggle reflows the viewport —
      // the same pre-capture pattern as applyPrefAndRelayout. A capture taken
      // after the change reads the new geometry with stale stride/page state
      // and loses the place.
      let fsPos = null;
      els.fullscreenBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        fsPos = (state.docModelBuilt && state.doc.words.length) ? getCanonicalPosition() : null;
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
      }, { signal });
      document.addEventListener('fullscreenchange', () => {
        const isFs = !!document.fullscreenElement;
        document.body.classList.toggle('fs-active', isFs);
        els.fullscreenBtnEl.setAttribute('aria-label', isFs ? 'Exit fullscreen' : 'Toggle fullscreen');
        // Desktop browsers fire a resize here (debounced relayout); some mobile
        // browsers do not, leaving the column flow — and the position — stale
        // until the next explicit resize. Relayout now, restoring the position
        // captured at the click (Esc-exit has no capture; fall back to a fresh
        // capture, same as the resize path).
        if (state.docModelBuilt) relayout(fsPos || undefined);
        fsPos = null;
      }, { signal });
    }
  }
  els.backdrop.addEventListener("click", () => { closePanels(); closeSettingsScreen(); }, { signal });

  // ---------- Reader quick drawer ----------
  let _floatingDrawerH = null; // remembers user-set height within session

  function applyQuickDrawerOpen(open) {
    if (els.readerQuickPanel) {
      els.readerQuickPanel.classList.toggle('is-collapsed', !open);
    }
    if (els.readerDrawerHandle) {
      els.readerDrawerHandle.setAttribute('aria-label', open ? 'Close quick settings' : 'Show quick settings');
    }
    const drawer = els.readerQuickDrawer;
    if (open) {
      // Detach from the footer so the drawer isn't hidden by chrome-hidden's
      // translateY(100%) transform. Append to #app (no transform ancestor)
      // so position:fixed keeps it pinned at the bottom of the viewport.
      if (drawer && !drawer.classList.contains('is-floating')) {
        drawer.classList.add('is-floating');
        document.getElementById('app').appendChild(drawer);
      }
      // Restore or set a default height for the resizable floating drawer.
      const initH = _floatingDrawerH || Math.round(window.innerHeight * 0.55);
      drawer.style.setProperty('--drawer-height', initH + 'px');
      document.body.classList.add('chrome-hidden');
      chrome.updateViewportScale();
    } else {
      // Save the current height so the next open restores it.
      if (drawer && drawer.classList.contains('is-floating')) {
        const h = parseInt(drawer.style.getPropertyValue('--drawer-height'), 10);
        if (h > 0) _floatingDrawerH = h;
        drawer.classList.remove('is-floating');
        drawer.style.removeProperty('--drawer-height');
        els.bottombar.insertAdjacentElement('afterbegin', drawer);
      }
      // Leave chrome-hidden intentionally: user is now in full-screen
      // reading mode and can tap the content to bring chrome back.
    }
    prefs.data.quickDrawerOpen = open;
    prefs.save();
  }
  applyQuickDrawerOpen(false); // always start closed; open state after close is chrome-hidden

  if (els.readerDrawerHandle) {
    let _dragStartY = null, _dragStartH = null, _didDrag = false;

    els.readerDrawerHandle.addEventListener('pointerdown', (e) => {
      if (!els.readerQuickDrawer?.classList.contains('is-floating')) return;
      _dragStartY = e.clientY;
      _dragStartH = parseInt(els.readerQuickDrawer.style.getPropertyValue('--drawer-height'), 10)
                    || Math.round(window.innerHeight * 0.55);
      _didDrag = false;
      els.readerDrawerHandle.setPointerCapture(e.pointerId);
    }, { signal });

    els.readerDrawerHandle.addEventListener('pointermove', (e) => {
      if (_dragStartY === null) return;
      const dy = _dragStartY - e.clientY; // up = positive = taller
      if (!_didDrag && Math.abs(dy) < 6) return;
      _didDrag = true;
      const minH = 64;
      const maxH = Math.round(window.innerHeight * 0.92);
      const newH = Math.min(Math.max(_dragStartH + dy, minH), maxH);
      els.readerQuickDrawer.style.setProperty('--drawer-height', newH + 'px');
    }, { signal });

    els.readerDrawerHandle.addEventListener('pointerup', () => {
      if (_didDrag) {
        const h = parseInt(els.readerQuickDrawer.style.getPropertyValue('--drawer-height'), 10);
        if (h > 0) _floatingDrawerH = h;
      }
      _dragStartY = null;
      _dragStartH = null;
    }, { signal });

    els.readerDrawerHandle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_didDrag) { _didDrag = false; return; }
      applyQuickDrawerOpen(!(prefs.data.quickDrawerOpen ?? false));
    }, { signal });
  }
  if (els.qdSizeDown) {
    els.qdSizeDown.addEventListener('click', () => {
      const next = Math.max(MIN_SIZE, (prefs.data.size || 19) - 1);
      prefs.data.size = next; prefs.save();
      applyPrefAndRelayout();
    }, { signal });
  }
  if (els.qdSizeUp) {
    els.qdSizeUp.addEventListener('click', () => {
      const next = Math.min(MAX_SIZE, (prefs.data.size || 19) + 1);
      prefs.data.size = next; prefs.save();
      applyPrefAndRelayout();
    }, { signal });
  }
  if (els.qdLhDown) {
    els.qdLhDown.addEventListener('click', () => {
      const next = Math.max(1.0, Math.round(((prefs.data.lineHeight || 1.62) - 0.1) * 10) / 10);
      prefs.data.lineHeight = next; prefs.save();
      applyPrefAndRelayout();
    }, { signal });
  }
  if (els.qdLhUp) {
    els.qdLhUp.addEventListener('click', () => {
      const next = Math.min(2.4, Math.round(((prefs.data.lineHeight || 1.62) + 0.1) * 10) / 10);
      prefs.data.lineHeight = next; prefs.save();
      applyPrefAndRelayout();
    }, { signal });
  }
  if (els.qdParaSeg) {
    els.qdParaSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-para]');
      if (!btn) return;
      prefs.data.paraSpacing = btn.dataset.para; prefs.save();
      applyPrefAndRelayout();
    }, { signal });
  }
  if (els.qdFontSeg) {
    els.qdFontSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-font]');
      if (!btn) return;
      prefs.data.font = btn.dataset.font; prefs.save();
      applyPrefAndRelayout();
    }, { signal });
  }
  if (els.qdMarginSeg) {
    els.qdMarginSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-margin]');
      if (!btn) return;
      prefs.data.margin = btn.dataset.margin; prefs.save();
      applyPrefAndRelayout();
    }, { signal });
  }
  if (els.qdAlignSeg) {
    els.qdAlignSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-align]');
      if (!btn) return;
      prefs.data.align = btn.dataset.align; prefs.save();
      applyPrefAndRelayout();
    }, { signal });
  }
  // Book submenu
  if (els.bookBtn && els.bookMenu) {
    function closeBookMenu() {
      els.bookMenu.hidden = true;
      els.bookBtn.setAttribute("aria-expanded", "false");
    }
    els.bookBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = !els.bookMenu.hidden;
      if (isOpen) { closeBookMenu(); return; }
      els.bookMenu.hidden = false;
      els.bookBtn.setAttribute("aria-expanded", "true");
    }, { signal });
    els.bookMenu.addEventListener("click", closeBookMenu, { signal });
    document.addEventListener("click", (e) => {
      if (!els.bookMenu.hidden && !els.bookBtn.contains(e.target) && !els.bookMenu.contains(e.target)) {
        closeBookMenu();
      }
    }, { signal });
  }

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
  let _bmStateRaf = false;
  els.viewport.addEventListener("scroll", () => {
    if (!state.isScrollMode) return;
    // Clear the resume highlight once the user scrolls away from where it landed
    // (ignore the programmatic scroll that placed it).
    if (state._resumeHlActive && Math.abs(els.viewport.scrollTop - (state._resumeHlScrollTop || 0)) > 8) {
      clearResumeHighlight();
    }
    chrome.updateProgress();
    // Re-evaluate the quick-bookmark button as bookmarks scroll on/off screen.
    // Paginated mode gets this via goTo->updateProgressFn; scroll mode has no
    // page turns, so without this the button froze in whatever state the last
    // add/remove left it. rAF-coalesced: one measured check per frame at most.
    if (!_bmStateRaf) {
      _bmStateRaf = true;
      requestAnimationFrame(() => {
        _bmStateRaf = false;
        if (state.isScrollMode) chrome.refreshQuickBmState(bookmarkManager.getAll());
      });
    }
    savePosMain();
  }, { passive: true, signal });

  // Resize
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { relayout(); chrome.updateViewportScale(); }, RESIZE_DEBOUNCE_MS);
  }, { signal });

  chrome.updateViewportScale();

  // Mode submenu
  const modeMenuBtn = document.getElementById("modeMenuBtn");
  const modeMenu = document.getElementById("modeMenu");
  if (modeMenuBtn && modeMenu) {
    function closeModeMenu() {
      modeMenu.hidden = true;
      modeMenuBtn.setAttribute("aria-expanded", "false");
    }
    modeMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = !modeMenu.hidden;
      if (isOpen) { closeModeMenu(); return; }
      modeMenu.hidden = false;
      modeMenuBtn.setAttribute("aria-expanded", "true");
    }, { signal });
    modeMenu.addEventListener("click", closeModeMenu, { signal });
    document.addEventListener("click", (e) => {
      if (!modeMenu.hidden && !modeMenuBtn.contains(e.target) && !modeMenu.contains(e.target)) {
        closeModeMenu();
      }
    }, { signal });
  }

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
  applyOsThemeFallback(generalPrefs, () => { generalPrefs.save(); applyPrefs(); });

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

  // Live-app hooks handed to the selftest suite (?selftest=1 only). They let
  // the suite drive the real layout/bookmark/navigation paths — the bookmark
  // anchor/check/navigate symmetry invariant can only be tested against the
  // live closures, not pure functions.
  const selftestHooks = {
    els, prefs, chrome, bookmarkManager, pagination,
    getBookmarkContext, navigateToBookmark,
    getCanonicalPosition, applyCanonicalPosition, seekToToken,
    relayout, applyPrefs,
    readerSections, totalWsWords, wsWordText,
  };

  const srcUrl = urlParams.get("src");
  if (srcUrl) {
    loadFromUrl(srcUrl);
  } else if (urlParams.get("selftest") === "1") {
    state.bookId = "Pride and Prejudice (sample)";
    bookmarkManager.setBook(state.bookId);
    els.bookTitleEl.textContent = "Pride and Prejudice";
    renderBook(buildSample());
    requestAnimationFrame(() => {
      if (_suppressSampleLayout) return;
      finalizeLayout([], null);
      requestAnimationFrame(() => runSelftest(state, selftestHooks));
    });
  } else {
    showWelcome();
  }

  // ---------- Handle object ----------
  return {
    teardown() {
      closeSettingsScreen();
      storage.flushPos(getCanonicalPosition);
      pageCounter.destroy();
      // Image blob URLs are owned by the BookSession (shared across modes), not
      // by the mode — the mode-switcher disposes them when a new book loads.
      if (resizeTimer) clearTimeout(resizeTimer);
    },
    getPosition: getCanonicalPosition,
    getBookId() { return state.bookId; },
    isBookLoaded() { return !!state.bookId; },
    applyPosition(pos) { applyCanonicalPosition(pos); },
    loadFromSession(session, pos) { return loadFromSession(session, pos); },
  };
}
