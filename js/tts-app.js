import { FONT_MAP, FONT_SERIF, GENERAL_DEFAULTS } from './core/constants.js';
import { PrefsManager } from './core/prefs.js';
import { BookmarkManager } from './core/bookmarks.js';
import { initBookmarksPanel } from './bookmarks/panel.js';
import { BookSession, splitWords } from './core/book-session.js';
import { renderSections, annotateInlineText } from './shared/render.js';
import { renderSearchResults } from './shared/search.js';
import { applyTheme, applyOsThemeFallback, savePosition as shellSavePosition, loadPosition } from './base-reader-app.js';
import { buildTOC, resolveHref } from './formats/epub/toc.js';
import { TtsEngine } from './tts/engine.js';
import { TtsHighlighter } from './tts/highlighter.js';
import { TTS_DEFAULTS } from './tts/constants.js';
import { openSettingsScreen, closeSettingsScreen } from './settings/settings-screen.js';
import { buildPosition, resolvePosition } from './core/position.js';
import * as perf from './core/perf.js';

export function init(options = {}) {
  const signal = options.signal || new AbortController().signal;
  const onModeSwitch = options.onModeSwitch;
  const onBookLoaded = options.onBookLoaded;

  // ---------- DOM elements ----------
  const els = {
    viewport:       document.getElementById('ttsViewport'),
    content:        document.getElementById('ttsContent'),
    bookTitleEl:    document.getElementById('bookTitle'),
    bookSubEl:      document.getElementById('bookSub'),
    overlay:        document.getElementById('overlay'),
    overlayMsg:     document.getElementById('overlayMsg'),
    overlayBtn:     document.getElementById('overlayBtn'),
    fileInput:      document.getElementById('fileInput'),
    backdrop:       document.getElementById('backdrop'),
    toc:            document.getElementById('toc'),
    tocListEl:      document.getElementById('tocList'),
    ttsTocBtn:      document.getElementById('ttsTocBtn'),
    ttsSettingsBtn: document.getElementById('ttsSettingsBtn'),
    ttsSearchBtn:    document.getElementById('ttsSearchBtn'),
    ttsSearchInput:  document.getElementById('ttsSearchInput'),
    ttsSearchResults: document.getElementById('ttsSearchResults'),
    ttsVoiceBtn:    document.getElementById('ttsVoiceBtn'),
    ttsReadBtn:     document.getElementById('ttsReadBtn'),
    ttsSpeedBtn:    document.getElementById('ttsSpeedBtn'),
    ttsOpenBtn:     document.getElementById('ttsOpenBtn'),
    ttsBookmarksBtn: document.getElementById('ttsBookmarksBtn'),
    ttsPlayBtn:     document.getElementById('ttsPlayBtn'),
    ttsPrevBtn:     document.getElementById('ttsPrevBtn'),
    ttsNextBtn:     document.getElementById('ttsNextBtn'),
    ttsRateSeg:     document.getElementById('ttsRateSeg'),
    ttsVoicePanel:  document.getElementById('ttsVoicePanel'),
    ttsVoiceList:   document.getElementById('ttsVoiceList'),
    comfortDim:     document.getElementById('comfortDim'),
    comfortWarm:    document.getElementById('comfortWarm'),
    coach:          document.getElementById('ttsCoach'),
  };

  // ---------- State ----------
  const prefs = new PrefsManager({ storageKey: 'tts:prefs', defaults: TTS_DEFAULTS, version: 1 });
  prefs.load();
  const generalPrefs = new PrefsManager({ storageKey: 'general:prefs', defaults: GENERAL_DEFAULTS });
  generalPrefs.load();

  const urlParams = new URLSearchParams(location.search);
  const sectionEls = new Map();
  let headingToc = [];
  let bookId = '';
  let bookLoaded = false;

  let sentences = [];       // [{ text, blockEl, wordOffset, secHref }]
  let ttsSections = [];     // [{ href, wordStart, wordCount }]
  let ttsWords = [];        // flat word strings, aligned with word ordinals
  let _ttsSearchCache = null;
  let totalWords = 0;
  let currentSentenceIdx = 0;
  let isPlaying = false;
  let voices = [];
  let selectedVoice = null;

  // ---------- Engine ----------
  const engine = new TtsEngine({
    onSentenceStart(index) {
      currentSentenceIdx = index;
      highlighter.clearWordHighlight();
      const mode = prefs.data.highlightMode;
      if (mode === 'off') return;
      if (mode === 'paragraph') highlighter.highlightParagraph(index);
      else highlighter.highlightSentence(index); // 'sentence' or 'word'
    },
    onSentenceEnd(index) {
      currentSentenceIdx = index + 1;
    },
    onBoundary({ sentenceIndex, charIndex, charLength }) {
      if (prefs.data.highlightMode === 'word') {
        highlighter.highlightWord(sentenceIndex, charIndex, charLength);
      }
    },
    onEnd() {
      setPlaying(false);
      highlighter.clearHighlight();
    },
    onError(e) {
      console.warn('tts:speech-error', e);
      setPlaying(false);
    },
  });

  // ---------- Highlighter ----------
  const highlighter = new TtsHighlighter(els.content, els.viewport);

  // ---------- Bookmarks ----------
  const bookmarkManager = new BookmarkManager();
  const bmPanel = initBookmarksPanel(
    { panelEl: document.getElementById('ttsBookmarksPanel'), listEl: document.getElementById('ttsBmList'), addBtnEl: document.getElementById('ttsBmAddBtn'), closeBtnEl: document.getElementById('ttsBmCloseBtn') },
    signal
  );
  bmPanel.setBook(bookmarkManager);

  function getTtsBookmarkContext() {
    if (!sentences.length) return null;
    const pos = getCanonicalPosition();
    const fraction = pos ? pos.f : 0;
    const sentence = sentences[currentSentenceIdx] || sentences[0];
    const text = sentence ? (sentence.text || '').slice(0, 120) : '';
    let chapterLabel = '';
    if (headingToc.length && sentence && sentence.blockEl) {
      for (let i = headingToc.length - 1; i >= 0; i--) {
        const hEl = headingToc[i].el;
        const rel = hEl.compareDocumentPosition(sentence.blockEl);
        if (rel & Node.DOCUMENT_POSITION_FOLLOWING) { chapterLabel = headingToc[i].label; break; }
      }
    }
    return { fraction, chapterLabel, text, position: pos };
  }

  function navigateTtsToBookmark(item) {
    engine.cancel();
    setPlaying(false);
    if (item.position) applyCanonicalPosition(item.position);
    else seekToSentence(Math.round((item.fraction || 0) * Math.max(sentences.length - 1, 0)));
  }

  bmPanel.setCallbacks({
    getContext: getTtsBookmarkContext,
    onNavigate: navigateTtsToBookmark,
    closePanel: () => {
      document.body.classList.remove('show-bookmarks');
      const b = document.getElementById('ttsBookmarksBtn');
      if (b) b.setAttribute('aria-expanded', 'false');
    },
  });

  // ---------- Panels ----------
  let _panelTrigger = null;

  function closePanels() {
    document.body.classList.remove('show-toc', 'tts-show-voice', 'show-search', 'show-bookmarks');
    if (els.ttsTocBtn) els.ttsTocBtn.setAttribute('aria-expanded', 'false');
    if (els.ttsSettingsBtn) els.ttsSettingsBtn.setAttribute('aria-expanded', 'false');
    if (els.ttsSearchBtn) els.ttsSearchBtn.setAttribute('aria-expanded', 'false');
    if (els.ttsVoiceBtn) els.ttsVoiceBtn.setAttribute('aria-expanded', 'false');
    const bBtn = document.getElementById('ttsBookmarksBtn');
    if (bBtn) bBtn.setAttribute('aria-expanded', 'false');
    if (_panelTrigger) { _panelTrigger.focus(); _panelTrigger = null; }
  }

  function openTOC() {
    _panelTrigger = els.ttsTocBtn;
    closePanels();
    _panelTrigger = els.ttsTocBtn;
    document.body.classList.add('show-toc');
    els.ttsTocBtn.setAttribute('aria-expanded', 'true');
    const first = els.tocListEl.querySelector('button');
    if (first) first.focus();
  }

  function openSettings() {
    closePanels();
    openSettingsScreen({
      initialTab: 'tts',
      currentMode: 'tts',
      onGeneralChange(key, value) {
        generalPrefs.data[key] = value;
        applyPrefs();
      },
      onTtsChange(key, value) {
        prefs.data[key] = value;
        applyPrefs();
        if (key === 'highlightMode' && value === 'off') highlighter.clearHighlight();
        if (key === 'autoScroll') highlighter.setAutoScroll(value);
      },
    });
    if (els.ttsSettingsBtn) els.ttsSettingsBtn.setAttribute('aria-expanded', 'true');
  }

  function openVoicePanel() {
    _panelTrigger = els.ttsVoiceBtn;
    closePanels();
    _panelTrigger = els.ttsVoiceBtn;
    document.body.classList.add('tts-show-voice');
    els.ttsVoiceBtn.setAttribute('aria-expanded', 'true');
  }

  // ---------- Overlay ----------
  function showLoading(msg) {
    document.body.classList.remove('error', 'welcome');
    document.body.classList.add('loading');
    els.overlayBtn.hidden = true;
    els.overlayMsg.textContent = msg;
  }
  function showError(msg) {
    document.body.classList.remove('loading', 'welcome');
    document.body.classList.add('error');
    els.overlayMsg.textContent = msg;
    els.overlayBtn.hidden = false;
  }
  function showWelcome() {
    document.body.classList.remove('loading', 'error');
    document.body.classList.add('welcome');
    els.overlayMsg.textContent = 'Open an EPUB or PDF to start reading.';
    els.overlayBtn.textContent = 'Open a book';
    els.overlayBtn.hidden = false;
  }
  function clearOverlay() {
    document.body.classList.remove('loading', 'error', 'welcome');
  }

  // ---------- Playing state ----------
  function setPlaying(val) {
    isPlaying = val;
    document.body.classList.toggle('tts-playing', val);
    if (els.ttsPlayBtn) {
      els.ttsPlayBtn.setAttribute('aria-label', val ? 'Pause' : 'Play');
    }
  }

  // ---------- Sentence segmentation ----------
  function splitSentences(text) {
    const marked = text.replace(/([.!?…])\s+/g, '$1\x00');
    const parts = marked.split('\x00');
    return parts.map(s => s.trim()).filter(Boolean);
  }

  // Split text nodes within el at the given sorted character offsets (in el.textContent coords)
  function splitTextNodesAt(el, sortedPositions) {
    if (!sortedPositions.length) return;
    let charCount = 0;
    const nodeSplits = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    let posIdx = 0;
    while ((node = walker.nextNode()) && posIdx < sortedPositions.length) {
      const len = node.textContent.length;
      const local = [];
      while (posIdx < sortedPositions.length && sortedPositions[posIdx] <= charCount + len) {
        const off = sortedPositions[posIdx] - charCount;
        if (off > 0 && off < len) local.push(off);
        posIdx++;
      }
      if (local.length) nodeSplits.push([node, local]);
      charCount += len;
    }
    // Apply splits largest-offset-first so earlier offsets stay valid on the original node
    for (const [textNode, offsets] of nodeSplits) {
      for (let i = offsets.length - 1; i >= 0; i--) {
        textNode.splitText(offsets[i]);
      }
    }
  }

  // Return a Range spanning [startChar, endChar) within el.textContent
  function charOffsetToRange(el, startChar, endChar) {
    const range = document.createRange();
    let charCount = 0;
    let startSet = false, endSet = false;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const len = node.textContent.length;
      if (!startSet && charCount + len > startChar) {
        range.setStart(node, startChar - charCount);
        startSet = true;
      }
      if (startSet && !endSet && charCount + len >= endChar) {
        range.setEnd(node, endChar - charCount);
        endSet = true;
        break;
      }
      charCount += len;
    }
    return (startSet && endSet) ? range : null;
  }

  // Wrap each sentence's text in blockEl in a <span class="tts-sent">.
  // Returns an array of highlight elements (spans, or blockEl as fallback).
  function wrapBlockSentences(blockEl, sentenceTexts) {
    const fullText = blockEl.textContent;
    // Find character boundaries of each sentence in the block's raw textContent
    const boundaries = [];
    let searchFrom = 0;
    for (const s of sentenceTexts) {
      const idx = fullText.indexOf(s, searchFrom);
      if (idx < 0) return sentenceTexts.map(() => blockEl); // fallback: can't locate
      boundaries.push([idx, idx + s.length]);
      searchFrom = idx + s.length;
    }
    // Pre-split text nodes at all sentence boundaries so ranges don't cross partial nodes
    const allPositions = [...new Set(boundaries.flat())].sort((a, b) => a - b);
    splitTextNodesAt(blockEl, allPositions);

    // Wrap each sentence in a span
    const spans = [];
    for (const [start, end] of boundaries) {
      const range = charOffsetToRange(blockEl, start, end);
      if (!range) return sentenceTexts.map(() => blockEl);
      try {
        const span = document.createElement('span');
        span.className = 'tts-sent';
        range.surroundContents(span);
        spans.push(span);
      } catch (_) {
        // Range crossed an element boundary (e.g. sentence ends inside <em>): fall back
        return sentenceTexts.map(() => blockEl);
      }
    }
    return spans;
  }

  function segmentContent() {
    // Must cover EVERY block type the extractor emits, so TTS counts words the
    // same way the Reader (doc-model walks all .blk) and RSVP (all sec.blocks)
    // do. Omitting pre/table/figure here made TTS's word ordinals drift behind
    // the other modes cumulatively, throwing cross-mode restores off by a page.
    const blockSel = '.blk-p, .blk-h1, .blk-h2, .blk-h3, .blk-h4, .blk-h5, .blk-h6, .blk-blockquote, .blk-li, .blk-pre, .blk-table-wrap, .blk-figure';
    const blocks = Array.from(els.content.querySelectorAll(blockSel));
    const result = [];
    const sectionsMeta = [];
    ttsWords = [];
    let wordOffset = 0;
    let curHref = null;
    for (const blockEl of blocks) {
      const text = blockEl.textContent.trim();
      if (!text) continue;
      const chap = blockEl.closest('.chap');
      const href = (chap && chap.dataset.href) || '';
      if (href !== curHref) {
        sectionsMeta.push({ href, wordStart: wordOffset, wordCount: 0 });
        curHref = href;
      }
      const parts = splitSentences(text);
      const highlightEls = parts.length > 1
        ? wrapBlockSentences(blockEl, parts)
        : [blockEl];
      for (let i = 0; i < parts.length; i++) {
        const words = splitWords(parts[i]);
        result.push({ text: parts[i], blockEl, highlightEl: highlightEls[i] || blockEl, wordOffset, secHref: href });
        for (const w of words) ttsWords.push(w);
        wordOffset += words.length;
      }
    }
    // Section table keyed by stable spine href — the shared anchor across modes.
    for (let i = 0; i < sectionsMeta.length; i++) {
      const end = i + 1 < sectionsMeta.length ? sectionsMeta[i + 1].wordStart : wordOffset;
      sectionsMeta[i].wordCount = end - sectionsMeta[i].wordStart;
    }
    ttsSections = sectionsMeta;
    totalWords = wordOffset;
    return result;
  }

  // ---------- Speech control ----------
  function play() {
    if (!sentences.length) return;
    if (engine.paused) {
      engine.resume();
      setPlaying(true);
      return;
    }
    const texts = sentences.map(s => s.text);
    engine.speakSentences(texts, currentSentenceIdx);
    setPlaying(true);
  }

  function pause() {
    engine.pause();
    setPlaying(false);
  }

  function playPause() {
    if (isPlaying) pause();
    else play();
  }

  function prevSentence() {
    const wasPlaying = isPlaying;
    engine.cancel();
    setPlaying(false);
    highlighter.clearHighlight();
    currentSentenceIdx = Math.max(0, currentSentenceIdx - 1);
    scrollToSentence(currentSentenceIdx);
    if (wasPlaying) play();
  }

  function nextSentence() {
    const wasPlaying = isPlaying;
    engine.cancel();
    setPlaying(false);
    highlighter.clearHighlight();
    currentSentenceIdx = Math.min(sentences.length - 1, currentSentenceIdx + 1);
    scrollToSentence(currentSentenceIdx);
    if (wasPlaying) play();
  }

  function scrollToSentence(index) {
    const sent = sentences[index];
    if (sent) {
      const el = sent.highlightEl || sent.blockEl;
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (_) {
        el.scrollIntoView(false);
      }
    }
  }

  function seekToSentence(index) {
    engine.cancel();
    setPlaying(false);
    highlighter.clearHighlight();
    currentSentenceIdx = Math.max(0, Math.min(sentences.length - 1, index));
    scrollToSentence(currentSentenceIdx);
  }

  // ---------- Rendering ----------
  function renderBook(sections) {
    perf.mark("tts:render");
    headingToc = [];
    renderSections(els.content, sections, {
      sectionEls,
      onHeading: (h) => headingToc.push(h),
    });
    perf.measure("tts:render", { sections: sections.length });
    perf.time("tts:annotate", () => annotateInlineText(els.content));
  }


  // ---------- Prefs application ----------
  function applyPrefs() {
    const p = prefs.data;

    // Theme (reads from app-wide general prefs)
    applyTheme(generalPrefs.data.theme);

    // Font & size
    els.content.style.fontFamily = FONT_MAP[p.font] || FONT_SERIF;
    els.content.style.fontSize = p.size + 'px';

    // Line height
    els.content.style.setProperty('--reading-line-height', String(p.lineHeight));

    // Margin
    els.viewport.classList.remove('margin-narrow', 'margin-normal', 'margin-wide');
    els.viewport.classList.add('margin-' + (p.margin || 'normal'));

    // Comfort overlay
    if (els.comfortDim) els.comfortDim.style.opacity = String(1 - (p.brightness || 1));
    if (els.comfortWarm) els.comfortWarm.style.opacity = String(p.warmth || 0);

    // Auto scroll
    highlighter.setAutoScroll(p.autoScroll !== false);

    // Rate buttons
    const rateBtns = els.ttsRateSeg ? els.ttsRateSeg.querySelectorAll('.tts-rate-btn') : [];
    rateBtns.forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.rate) === p.rate);
    });
  }

  // ---------- Voice panel ----------
  async function loadAndDisplayVoices() {
    voices = await engine.loadVoices();
    renderVoiceList();
  }

  function renderVoiceList() {
    if (!els.ttsVoiceList) return;
    els.ttsVoiceList.innerHTML = '';
    if (!voices.length) {
      const msg = document.createElement('div');
      msg.className = 'tts-voice-empty';
      msg.textContent = 'No voices available.';
      els.ttsVoiceList.appendChild(msg);
      return;
    }
    // Sort: local voices first
    const sorted = [...voices].sort((a, b) => {
      if (a.localService && !b.localService) return -1;
      if (!a.localService && b.localService) return 1;
      return a.name.localeCompare(b.name);
    });
    sorted.forEach(voice => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tts-voice-item' + (voice.name === prefs.data.voiceName ? ' active' : '');
      btn.textContent = voice.name + ' (' + voice.lang + ')';
      if (voice.localService) {
        const badge = document.createElement('span');
        badge.className = 'tts-voice-local';
        badge.textContent = 'local';
        btn.appendChild(badge);
      }
      btn.addEventListener('click', () => {
        selectedVoice = voice;
        prefs.data.voiceName = voice.name;
        prefs.save();
        engine.setVoice(voice);
        // Update active states
        els.ttsVoiceList.querySelectorAll('.tts-voice-item').forEach(b => {
          b.classList.toggle('active', b === btn);
        });
        closePanels();
      });
      els.ttsVoiceList.appendChild(btn);
    });
  }

  function restoreVoice() {
    if (!prefs.data.voiceName || !voices.length) return;
    const v = voices.find(v => v.name === prefs.data.voiceName);
    if (v) { selectedVoice = v; engine.setVoice(v); }
  }

  // ---------- EPUB loading ----------
  // Build the mode-agnostic session once, then render + segment it. A mode
  // switch reuses the session (loadFromSession) without re-parsing.
  async function loadEpub(file, pos) {
    engine.cancel();
    setPlaying(false);
    highlighter.clearHighlight();
    sentences = [];
    currentSentenceIdx = 0;

    showLoading('Loading ' + file.name + '…');
    closePanels();
    try {
      const buffer = await file.arrayBuffer();
      const session = await perf.timeAsync("tts:extract", () =>
        BookSession.fromBuffer(buffer, file.name, urlParams.get('id'), (msg) => {
          els.overlayMsg.textContent = msg;
        }));
      await loadFromSession(session, pos);
    } catch (err) {
      console.error('TTS EPUB load failed:', err);
      showError(err && err.message ? err.message : "Couldn't read that file.");
    }
  }

  let _suppressSampleLayout = false;
  async function loadFromSession(session, pos) {
    // Cancel the sample-book rAF so it doesn't overwrite the real TOC that this
    // function builds, and so segmentContent() isn't called twice on stale DOM.
    _suppressSampleLayout = true;
    engine.cancel();
    setPlaying(false);
    highlighter.clearHighlight();
    sentences = [];
    currentSentenceIdx = 0;
    closePanels();
    try {
      bookId = session.bookId;
      bookmarkManager.setBook(bookId);
      els.bookTitleEl.textContent = session.title || session.bookId;
      bookLoaded = true;

      renderBook(session.sections);
      clearOverlay();
      if (onBookLoaded) onBookLoaded({ session });

      // Segment, restore and build TOC inside a rAF so the rendered DOM exists
      // before we address sentences. Await it so loadFromSession only resolves
      // once the position is applied — see mode-switcher handoff.
      await new Promise((resolve) => {
        requestAnimationFrame(() => {
          try {
            sentences = perf.time("tts:segment", () => segmentContent());
            _ttsSearchCache = null;
            highlighter.setSentences(sentences);
            // A handed-off position is the single source of truth; otherwise
            // fall back to the persisted position. Never both (that was a race).
            if (pos) applyCanonicalPosition(pos);
            else currentSentenceIdx = restorePosition();

            buildTOC(session.toc, headingToc, els.tocListEl, sectionEls,
              (el) => seekToElementBlock(el),
              closePanels,
              (href) => resolveHref(href, els.content, sectionEls));
          } catch (e) { console.warn("tts:layout", e); }
          finally { resolve(); }
        });
      });
    } catch (err) {
      console.error('TTS render failed:', err);
      showError(err && err.message ? err.message : "Couldn't read that file.");
    }
  }

  function seekToElementBlock(el) {
    // Walk up to find a .blk element
    let target = el;
    while (target && !target.classList.contains('blk') && target !== els.content) {
      target = target.parentElement;
    }
    if (target && target !== els.content) {
      const idx = sentences.findIndex(s => s.blockEl === target);
      if (idx >= 0) { seekToSentence(idx); return; }
    }
    // el might be a .chap section — find first sentence it contains
    const idx = sentences.findIndex(s => el === s.blockEl || el.contains(s.blockEl));
    if (idx >= 0) seekToSentence(idx);
    else try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
  }

  // ---------- Position persistence ----------
  function savePosition() {
    if (!sentences.length) return;
    shellSavePosition(bookId, getCanonicalPosition);
  }

  function restorePosition() {
    const pos = loadPosition(bookId);
    if (!pos) return 0;
    return sentenceIndexForOrdinal(resolvePosition(pos, ttsSections, totalWords, wordAt));
  }

  // ---------- Canonical position ----------
  function sentenceIndexForOrdinal(ord) {
    let idx = 0;
    for (let i = 0; i < sentences.length; i++) {
      if (sentences[i].wordOffset <= ord) idx = i; else break;
    }
    return idx;
  }
  // Raw word string at word ordinal `o`, for the text-anchored exact snap.
  function wordAt(o) { return ttsWords[o] || ''; }
  function getCanonicalPosition() {
    if (!sentences.length || totalWords < 1) return null;
    const sent = sentences[currentSentenceIdx] || sentences[0];
    const start = sent ? sent.wordOffset : 0;
    const pos = buildPosition(ttsSections, totalWords, start, wordAt);
    if (pos) {
      // Highlight the whole sentence we were on when entering the Reader.
      const next = sentences[currentSentenceIdx + 1];
      const end = next ? next.wordOffset : totalWords;
      pos.hl = Math.max(1, end - start);
    }
    return pos;
  }
  function applyCanonicalPosition(pos) {
    if (!sentences.length) return;
    seekToSentence(sentenceIndexForOrdinal(resolvePosition(pos, ttsSections, totalWords, wordAt)));
  }


  // ---------- Wiring ----------
  if (els.ttsPlayBtn) els.ttsPlayBtn.addEventListener('click', playPause, { signal });
  if (els.ttsPrevBtn) els.ttsPrevBtn.addEventListener('click', prevSentence, { signal });
  if (els.ttsNextBtn) els.ttsNextBtn.addEventListener('click', nextSentence, { signal });

  // Rate buttons
  if (els.ttsRateSeg) {
    els.ttsRateSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-rate]');
      if (!btn) return;
      const rate = parseFloat(btn.dataset.rate);
      prefs.data.rate = rate;
      prefs.save();
      engine.setRate(rate);
      els.ttsRateSeg.querySelectorAll('.tts-rate-btn').forEach(b => {
        b.classList.toggle('active', parseFloat(b.dataset.rate) === rate);
      });
    }, { signal });
  }

  // Panel buttons
  if (els.ttsTocBtn) els.ttsTocBtn.addEventListener('click', openTOC, { signal });
  if (els.ttsSettingsBtn) els.ttsSettingsBtn.addEventListener('click', openSettings, { signal });
  function buildTtsSearchCache() {
    if (_ttsSearchCache) return _ttsSearchCache;
    let text = "";
    const sentenceCharStart = [];
    for (let i = 0; i < sentences.length; i++) {
      sentenceCharStart.push(text.length);
      text += sentences[i].text + " ";
    }
    _ttsSearchCache = { text, sentenceCharStart };
    return _ttsSearchCache;
  }

  function runTtsSearch(query) {
    const resultsEl = els.ttsSearchResults;
    if (!resultsEl) return;
    if (!sentences.length) { resultsEl.innerHTML = ""; return; }
    const { text, sentenceCharStart } = buildTtsSearchCache();
    renderSearchResults(resultsEl, {
      text, charStart: sentenceCharStart, query,
      onPick: (si) => { seekToSentence(si); closePanels(); },
    });
  }

  if (els.ttsSearchBtn) {
    els.ttsSearchBtn.addEventListener('click', () => {
      const isOpen = document.body.classList.contains('show-search');
      closePanels();
      closeSettingsScreen();
      if (!isOpen) {
        document.body.classList.add('show-search');
        els.ttsSearchBtn.setAttribute('aria-expanded', 'true');
        if (els.ttsSearchInput) { els.ttsSearchInput.value = ''; els.ttsSearchInput.focus(); }
        if (els.ttsSearchResults) els.ttsSearchResults.innerHTML = '';
      }
    }, { signal });
  }

  if (els.ttsSearchInput) {
    els.ttsSearchInput.addEventListener('input', (e) => runTtsSearch(e.target.value.trim()), { signal });
  }
  if (els.ttsVoiceBtn) els.ttsVoiceBtn.addEventListener('click', () => {
    openVoicePanel();
    renderVoiceList();
  }, { signal });
  if (els.backdrop) els.backdrop.addEventListener('click', () => { closePanels(); closeSettingsScreen(); }, { signal });

  // Bookmarks
  const ttsBookmarksBtn = document.getElementById('ttsBookmarksBtn');
  if (ttsBookmarksBtn) {
    ttsBookmarksBtn.addEventListener('click', () => {
      const isOpen = document.body.classList.contains('show-bookmarks');
      closePanels();
      closeSettingsScreen();
      if (!isOpen) {
        document.body.classList.add('show-bookmarks');
        ttsBookmarksBtn.setAttribute('aria-expanded', 'true');
        bmPanel.render();
      } else {
        ttsBookmarksBtn.setAttribute('aria-expanded', 'false');
      }
    }, { signal });
  }

  // Book submenu
  const ttsBookBtn = document.getElementById("ttsBookBtn");
  const ttsBookMenu = document.getElementById("ttsBookMenu");
  if (ttsBookBtn && ttsBookMenu) {
    function closeBookMenu() {
      ttsBookMenu.hidden = true;
      ttsBookBtn.setAttribute("aria-expanded", "false");
    }
    ttsBookBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = !ttsBookMenu.hidden;
      if (isOpen) { closeBookMenu(); return; }
      ttsBookMenu.hidden = false;
      ttsBookBtn.setAttribute("aria-expanded", "true");
    }, { signal });
    ttsBookMenu.addEventListener("click", closeBookMenu, { signal });
    document.addEventListener("click", (e) => {
      if (!ttsBookMenu.hidden && !ttsBookBtn.contains(e.target) && !ttsBookMenu.contains(e.target)) {
        closeBookMenu();
      }
    }, { signal });
  }

  // File open
  if (els.ttsOpenBtn) els.ttsOpenBtn.addEventListener('click', () => els.fileInput.click(), { signal });
  if (els.overlayBtn) els.overlayBtn.addEventListener('click', () => els.fileInput.click(), { signal });
  if (els.fileInput) {
    els.fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (file) loadEpub(file);
    }, { signal });
  }

  // Mode submenu
  const ttsModeMenuBtn = document.getElementById("ttsModeMenuBtn");
  const ttsModeMenu = document.getElementById("ttsModeMenu");
  if (ttsModeMenuBtn && ttsModeMenu) {
    function closeModeMenu() {
      ttsModeMenu.hidden = true;
      ttsModeMenuBtn.setAttribute("aria-expanded", "false");
    }
    ttsModeMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = !ttsModeMenu.hidden;
      if (isOpen) { closeModeMenu(); return; }
      ttsModeMenu.hidden = false;
      ttsModeMenuBtn.setAttribute("aria-expanded", "true");
    }, { signal });
    ttsModeMenu.addEventListener("click", closeModeMenu, { signal });
    document.addEventListener("click", (e) => {
      if (!ttsModeMenu.hidden && !ttsModeMenuBtn.contains(e.target) && !ttsModeMenu.contains(e.target)) {
        closeModeMenu();
      }
    }, { signal });
  }

  // Mode switch
  if (els.ttsReadBtn && onModeSwitch) {
    els.ttsReadBtn.addEventListener('click', () => {
      closeSettingsScreen();
      engine.cancel();
      setPlaying(false);
      savePosition();
      onModeSwitch('read', { pos: getCanonicalPosition(), bookId });
    }, { signal });
  }
  if (els.ttsSpeedBtn && onModeSwitch) {
    els.ttsSpeedBtn.addEventListener('click', () => {
      closeSettingsScreen();
      engine.cancel();
      setPlaying(false);
      savePosition();
      onModeSwitch('rsvp', { pos: getCanonicalPosition(), bookId });
    }, { signal });
  }

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); playPause(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); nextSentence(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prevSentence(); }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const rates = [0.75, 1, 1.25, 1.5, 2];
      const idx = rates.indexOf(prefs.data.rate);
      if (idx < rates.length - 1) {
        prefs.data.rate = rates[idx + 1];
        engine.setRate(prefs.data.rate);
        prefs.save();
        applyPrefs();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const rates = [0.75, 1, 1.25, 1.5, 2];
      const idx = rates.indexOf(prefs.data.rate);
      if (idx > 0) {
        prefs.data.rate = rates[idx - 1];
        engine.setRate(prefs.data.rate);
        prefs.save();
        applyPrefs();
      }
    } else if (e.key === 'Escape') {
      closePanels();
    }
  }, { signal });

  // Save position periodically during speech
  els.viewport.addEventListener('scroll', () => {
    savePosition();
  }, { passive: true, signal });

  // ---------- Init ----------
  applyPrefs();
  engine.setRate(prefs.data.rate);
  engine.setPitch(prefs.data.pitch);

  // Respect prefers-color-scheme on first load (theme lives in general prefs).
  applyOsThemeFallback(generalPrefs, () => { generalPrefs.save(); applyPrefs(); });

  // Load voices asynchronously
  loadAndDisplayVoices().then(() => restoreVoice());

  // Load sample or URL book
  const srcUrl = urlParams.get('src');
  if (srcUrl) {
    showLoading('Fetching book\u2026');
    fetch(srcUrl)
      .then(r => { if (!r.ok) throw new Error('Fetch failed: ' + r.status); return r.blob(); })
      .then(blob => {
        const fn = srcUrl.split('/').pop() || 'book.epub';
        return loadEpub(new File([blob], fn, { type: 'application/epub+zip' }));
      })
      .catch(err => showError(err && err.message ? err.message : "Couldn't fetch that book."));
  } else {
    showWelcome();
  }

  // ---------- Handle ----------
  return {
    teardown() {
      closeSettingsScreen();
      engine.cancel();
      setPlaying(false);
      savePosition();
      // Image blob URLs belong to the shared BookSession, not the mode.
    },
    getPosition: getCanonicalPosition,
    getBookId() { return bookId; },
    isBookLoaded() { return bookLoaded; },
    applyPosition(pos) { applyCanonicalPosition(pos); },
    loadFromSession(session, pos) { return loadFromSession(session, pos); },
  };
}
