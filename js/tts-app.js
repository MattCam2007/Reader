import { FONT_MAP, FONT_SERIF, THEME_COLORS, GENERAL_DEFAULTS, ALL_THEME_NAMES } from './core/constants.js';
import { PrefsManager } from './core/prefs.js';
import { BookmarkManager } from './core/bookmarks.js';
import { initBookmarksPanel } from './bookmarks/panel.js';
import { extractSections } from './epub/extractor.js';
import { resolveImageUrls, findCoverImage } from './epub/images.js';
import { flattenToc, buildTOC, resolveHref } from './epub/toc.js';
import { buildSample } from '../fixtures/sample.js';
import { TtsEngine } from './tts/engine.js';
import { TtsHighlighter } from './tts/highlighter.js';
import { TTS_DEFAULTS } from './tts/constants.js';
import { openSettingsScreen, closeSettingsScreen } from './settings/settings-screen.js';

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
  const blobUrls = [];
  const sectionEls = new Map();
  let headingToc = [];
  let bookId = '';
  let bookLoaded = false;

  let sentences = [];       // [{ text, blockEl, wordOffset }]
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
    { panelEl: document.getElementById('ttsBookmarksPanel'), listEl: document.getElementById('ttsBmList'), addBtnEl: document.getElementById('ttsBmAddBtn') },
    signal
  );
  bmPanel.setBook(bookmarkManager);

  function getTtsBookmarkContext() {
    if (!sentences.length) return null;
    const fraction = getPositionFraction();
    const sentence = sentences[currentSentenceIdx] || sentences[0];
    const text = sentence ? (sentence.text || '').slice(0, 120) : '';
    let chapterLabel = '';
    if (headingToc.length && sentence && sentence.blockEl) {
      for (let i = headingToc.length - 1; i >= 0; i--) {
        const hEl = headingToc[i].el;
        const pos = hEl.compareDocumentPosition(sentence.blockEl);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) { chapterLabel = headingToc[i].label; break; }
      }
    }
    return { fraction, chapterLabel, text };
  }

  function navigateTtsToBookmark(item) {
    engine.cancel();
    setPlaying(false);
    const idx = Math.round(item.fraction * Math.max(sentences.length - 1, 0));
    seekToSentence(idx);
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
    document.body.classList.remove('error');
    document.body.classList.add('loading');
    els.overlayBtn.hidden = true;
    els.overlayMsg.textContent = msg;
  }
  function showError(msg) {
    document.body.classList.remove('loading');
    document.body.classList.add('error');
    els.overlayMsg.textContent = msg;
    els.overlayBtn.hidden = false;
  }
  function clearOverlay() {
    document.body.classList.remove('loading', 'error');
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
    const blockSel = '.blk-p, .blk-h1, .blk-h2, .blk-h3, .blk-h4, .blk-h5, .blk-h6, .blk-blockquote, .blk-li';
    const blocks = Array.from(els.content.querySelectorAll(blockSel));
    const result = [];
    let wordOffset = 0;
    for (const blockEl of blocks) {
      const text = blockEl.textContent.trim();
      if (!text) continue;
      const parts = splitSentences(text);
      const highlightEls = parts.length > 1
        ? wrapBlockSentences(blockEl, parts)
        : [blockEl];
      for (let i = 0; i < parts.length; i++) {
        const wc = parts[i].split(/\s+/).filter(Boolean).length;
        result.push({ text: parts[i], blockEl, highlightEl: highlightEls[i] || blockEl, wordOffset });
        wordOffset += wc;
      }
    }
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
    blobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (_) {} });
    blobUrls.length = 0;
    els.content.innerHTML = '';
    sectionEls.clear();
    headingToc = [];
    const frag = document.createDocumentFragment();
    sections.forEach((sec) => {
      const wrap = document.createElement('div');
      wrap.className = 'chap';
      if (sec.href) { wrap.dataset.href = sec.href; sectionEls.set(sec.href, wrap); }
      sec.blocks.forEach((b) => {
        const el = document.createElement(
          (b.type === 'figure' || b.type === 'table-wrap') ? 'div' : b.type
        );
        if (b.frag) el.appendChild(b.frag);
        else el.textContent = b.text;
        if (b.id) el.id = b.id;
        el.className = 'blk blk-' + b.type;
        if (b.type === 'figure') {
          el.querySelectorAll('figcaption').forEach(fc => fc.className = 'blk-figcaption');
        }
        wrap.appendChild(el);
        if (b.type === 'h1' || b.type === 'h2') {
          headingToc.push({ label: b.text, el, depth: b.type === 'h1' ? 0 : 1 });
        }
      });
      frag.appendChild(wrap);
    });
    els.content.appendChild(frag);
    annotateInlineText(els.content);
  }

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

  // ---------- Prefs application ----------
  function applyPrefs() {
    const p = prefs.data;

    // Theme (reads from app-wide general prefs)
    const theme = generalPrefs.data.theme;
    document.body.classList.remove(...ALL_THEME_NAMES.map(t => `theme-${t}`));
    if (theme !== 'dark') document.body.classList.add('theme-' + theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && THEME_COLORS[theme]) meta.setAttribute('content', THEME_COLORS[theme]);

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
  async function loadEpub(file) {
    engine.cancel();
    setPlaying(false);
    highlighter.clearHighlight();
    sentences = [];
    currentSentenceIdx = 0;

    showLoading('Loading ' + file.name + '\u2026');
    closePanels();
    let book = null;
    try {
      if (typeof ePub !== 'function') {
        throw new Error('EPUB library failed to load. Check your connection.');
      }
      const buffer = await file.arrayBuffer();
      book = ePub(buffer);
      await book.ready;

      let epubToc = [];
      try {
        const nav = await book.loaded.navigation;
        epubToc = flattenToc(nav && nav.toc, 0, []);
      } catch (e) { console.warn('tts:toc', e); }

      const { sections, allImgUrls } = await extractSections(book, (msg) => {
        els.overlayMsg.textContent = msg;
      });
      const chars = sections.reduce((n, s) => n + s.blocks.reduce((m, b) => m + b.text.length, 0), 0);
      if (chars < 32) throw new Error('No readable text found (this EPUB may be image-only or DRM-protected).');

      if (allImgUrls.length && book.archive) {
        await resolveImageUrls(allImgUrls, book, blobUrls);
      }

      const coverUrl = await findCoverImage(book);
      if (coverUrl) {
        const img = document.createElement('img');
        img.src = coverUrl;
        const frag = document.createDocumentFragment();
        frag.appendChild(img);
        sections.unshift({ href: '__cover__', blocks: [{ type: 'figure', text: '', id: 'cover', frag }] });
      }

      const meta = (book.packaging && book.packaging.metadata) || {};
      const title = (meta.title || file.name).trim();
      bookId = urlParams.get('id') || title || file.name;
      bookmarkManager.setBook(bookId);
      els.bookTitleEl.textContent = title;
      bookLoaded = true;

      renderBook(sections);
      if (coverUrl) blobUrls.push(coverUrl);
      clearOverlay();

      if (onBookLoaded) onBookLoaded({ buffer, fileName: file.name, bookId });

      // Save position, build TOC, segment sentences
      requestAnimationFrame(() => {
        sentences = segmentContent();
        _ttsSearchCache = null;
        highlighter.setSentences(sentences);
        currentSentenceIdx = restorePosition();

        buildTOC(epubToc, headingToc, els.tocListEl, sectionEls,
          (el) => seekToElementBlock(el),
          closePanels,
          (href) => resolveHref(href, els.content, sectionEls));
      });

    } catch (err) {
      console.error('TTS EPUB load failed:', err);
      showError(err && err.message ? err.message : "Couldn't read that file.");
    } finally {
      if (book && typeof book.destroy === 'function') {
        try { book.destroy(); } catch (_) {}
      }
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
  function posKey() { return 'tts:pos:' + bookId; }

  function savePosition() {
    if (!bookId || !sentences.length) return;
    try { localStorage.setItem(posKey(), String(currentSentenceIdx)); } catch (_) {}
  }

  function restorePosition() {
    if (!bookId) return 0;
    try {
      const saved = parseInt(localStorage.getItem(posKey()) || '0', 10);
      return Math.max(0, Math.min(sentences.length - 1, saved || 0));
    } catch (_) { return 0; }
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
    resultsEl.innerHTML = "";
    if (!query || query.length < 2 || !sentences.length) {
      if (query && query.length >= 2)
        resultsEl.innerHTML = '<div class="reader-search-empty">No results</div>';
      return;
    }
    const { text, sentenceCharStart } = buildTtsSearchCache();
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    const hits = [];
    let pos = 0;
    while ((pos = lower.indexOf(q, pos)) !== -1 && hits.length < 200) {
      hits.push(pos);
      pos += q.length;
    }
    if (!hits.length) {
      resultsEl.innerHTML = '<div class="reader-search-empty">No results</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    hits.forEach((charOff) => {
      let si = 0;
      for (let j = 0; j < sentenceCharStart.length; j++) {
        if (sentenceCharStart[j] <= charOff) si = j;
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
        seekToSentence(si);
        closePanels();
      });
      frag.appendChild(btn);
    });
    resultsEl.appendChild(frag);
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

  // Mode switch
  if (els.ttsReadBtn && onModeSwitch) {
    els.ttsReadBtn.addEventListener('click', () => {
      closeSettingsScreen();
      engine.cancel();
      setPlaying(false);
      savePosition();
      onModeSwitch('read', { fraction: getPositionFraction(), bookId });
    }, { signal });
  }
  if (els.ttsSpeedBtn && onModeSwitch) {
    els.ttsSpeedBtn.addEventListener('click', () => {
      closeSettingsScreen();
      engine.cancel();
      setPlaying(false);
      savePosition();
      onModeSwitch('rsvp', { fraction: getPositionFraction(), bookId });
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

  // Respect prefers-color-scheme on first load
  if (!localStorage.getItem('tts:prefs')) {
    if (window.matchMedia('(prefers-color-scheme: light)').matches) {
      prefs.data.theme = 'light';
      applyPrefs();
    }
  }

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
    bookId = urlParams.get('id') || 'Pride and Prejudice (sample)';
    bookmarkManager.setBook(bookId);
    els.bookTitleEl.textContent = 'Pride and Prejudice';
    renderBook(buildSample());
    requestAnimationFrame(() => {
      sentences = segmentContent();
      _ttsSearchCache = null;
      highlighter.setSentences(sentences);
      currentSentenceIdx = restorePosition();
      buildTOC([], headingToc, els.tocListEl, sectionEls,
        (el) => { seekToElementBlock(el); closePanels(); },
        closePanels,
        (href) => resolveHref(href, els.content, sectionEls));

      // Show coach hint on first visit
      if (els.coach) {
        try {
          if (!localStorage.getItem('tts:hinted')) {
            els.coach.classList.remove('hide');
            els.coach.setAttribute('aria-hidden', 'false');
            setTimeout(() => {
              els.coach.classList.add('hide');
              try { localStorage.setItem('tts:hinted', '1'); } catch (_) {}
            }, 5000);
          }
        } catch (_) {}
      }
    });
  }

  // ---------- Handle ----------
  function getPositionFraction() {
    if (!sentences.length) return 0;
    return currentSentenceIdx / sentences.length;
  }

  return {
    teardown() {
      closeSettingsScreen();
      engine.cancel();
      setPlaying(false);
      savePosition();
      blobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (_) {} });
      blobUrls.length = 0;
    },
    getPositionFraction,
    getBookId() { return bookId; },
    isBookLoaded() { return bookLoaded; },
    seekFraction(f) {
      if (!sentences.length) return;
      const idx = Math.round(f * (sentences.length - 1));
      seekToSentence(idx);
    },
    loadFromBuffer(buffer, fileName) {
      const file = new File([buffer], fileName, { type: 'application/epub+zip' });
      return loadEpub(file);
    },
  };
}
