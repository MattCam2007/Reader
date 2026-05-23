import { FONT_MAP, FONT_SERIF, THEME_COLORS, MIN_SIZE, MAX_SIZE } from './core/constants.js';
import { PrefsManager } from './core/prefs.js';
import { extractSections } from './epub/extractor.js';
import { resolveImageUrls, findCoverImage } from './epub/images.js';
import { flattenToc, buildTOC, resolveHref } from './epub/toc.js';
import { buildSample } from '../fixtures/sample.js';
import { TtsEngine } from './tts/engine.js';
import { TtsHighlighter } from './tts/highlighter.js';

const TTS_DEFAULTS = {
  v: 1,
  theme: 'dark',
  font: 'serif',
  size: 19,
  lineHeight: 1.62,
  margin: 'normal',
  align: 'justify',
  brightness: 1,
  warmth: 0,
  rate: 1.0,
  pitch: 1.0,
  voiceName: '',
  autoScroll: true,
  highlightMode: 'sentence',
};

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
    ttsVoiceBtn:    document.getElementById('ttsVoiceBtn'),
    ttsReadBtn:     document.getElementById('ttsReadBtn'),
    ttsOpenBtn:     document.getElementById('ttsOpenBtn'),
    ttsPlayBtn:     document.getElementById('ttsPlayBtn'),
    ttsPrevBtn:     document.getElementById('ttsPrevBtn'),
    ttsNextBtn:     document.getElementById('ttsNextBtn'),
    ttsRateSeg:     document.getElementById('ttsRateSeg'),
    ttsSettings:    document.getElementById('ttsSettings'),
    ttsVoicePanel:  document.getElementById('ttsVoicePanel'),
    ttsVoiceList:   document.getElementById('ttsVoiceList'),
    ttsThemeSeg:    document.getElementById('ttsThemeSeg'),
    ttsFontSeg:     document.getElementById('ttsFontSeg'),
    ttsMarginSeg:   document.getElementById('ttsMarginSeg'),
    ttsHighlightSeg:document.getElementById('ttsHighlightSeg'),
    ttsSizeDown:    document.getElementById('ttsSizeDown'),
    ttsSizeUp:      document.getElementById('ttsSizeUp'),
    ttsSizeDisplay: document.getElementById('ttsSizeDisplay'),
    ttsLineHeightDown: document.getElementById('ttsLineHeightDown'),
    ttsLineHeightUp:   document.getElementById('ttsLineHeightUp'),
    ttsLineHeightDisplay: document.getElementById('ttsLineHeightDisplay'),
    ttsBrightnessSlider: document.getElementById('ttsBrightnessSlider'),
    ttsWarmthSlider:     document.getElementById('ttsWarmthSlider'),
    comfortDim:     document.getElementById('comfortDim'),
    comfortWarm:    document.getElementById('comfortWarm'),
    coach:          document.getElementById('ttsCoach'),
  };

  // ---------- State ----------
  const prefs = new PrefsManager({ storageKey: 'tts:prefs', defaults: TTS_DEFAULTS, version: 1 });
  prefs.load();

  const urlParams = new URLSearchParams(location.search);
  const blobUrls = [];
  const sectionEls = new Map();
  let headingToc = [];
  let bookId = '';
  let bookLoaded = false;

  let sentences = [];       // [{ text, blockEl, wordOffset }]
  let totalWords = 0;
  let currentSentenceIdx = 0;
  let isPlaying = false;
  let voices = [];
  let selectedVoice = null;

  // ---------- Engine ----------
  const engine = new TtsEngine({
    onSentenceStart(index) {
      currentSentenceIdx = index;
      if (prefs.data.highlightMode === 'sentence') {
        highlighter.highlightSentence(index);
      }
    },
    onSentenceEnd(index) {
      currentSentenceIdx = index + 1;
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

  // ---------- Panels ----------
  let _panelTrigger = null;

  function closePanels() {
    document.body.classList.remove('show-toc', 'tts-show-settings', 'tts-show-voice');
    if (els.ttsTocBtn) els.ttsTocBtn.setAttribute('aria-expanded', 'false');
    if (els.ttsSettingsBtn) els.ttsSettingsBtn.setAttribute('aria-expanded', 'false');
    if (els.ttsVoiceBtn) els.ttsVoiceBtn.setAttribute('aria-expanded', 'false');
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
    _panelTrigger = els.ttsSettingsBtn;
    closePanels();
    _panelTrigger = els.ttsSettingsBtn;
    document.body.classList.add('tts-show-settings');
    els.ttsSettingsBtn.setAttribute('aria-expanded', 'true');
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
  }

  // ---------- Prefs application ----------
  function applyPrefs() {
    const p = prefs.data;

    // Theme
    document.body.classList.remove('theme-dark', 'theme-sepia', 'theme-light', 'theme-oled');
    if (p.theme !== 'dark') document.body.classList.add('theme-' + p.theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && THEME_COLORS[p.theme]) meta.setAttribute('content', THEME_COLORS[p.theme]);

    // Font & size
    els.content.style.fontFamily = FONT_MAP[p.font] || FONT_SERIF;
    els.content.style.fontSize = p.size + 'px';
    if (els.ttsSizeDisplay) els.ttsSizeDisplay.textContent = p.size;

    // Line height
    els.content.style.setProperty('--reading-line-height', String(p.lineHeight));
    if (els.ttsLineHeightDisplay) els.ttsLineHeightDisplay.textContent = p.lineHeight.toFixed(1);

    // Margin
    els.viewport.classList.remove('margin-narrow', 'margin-normal', 'margin-wide');
    els.viewport.classList.add('margin-' + (p.margin || 'normal'));

    // Comfort overlay
    if (els.comfortDim) els.comfortDim.style.opacity = String(1 - (p.brightness || 1));
    if (els.comfortWarm) els.comfortWarm.style.opacity = String(p.warmth || 0);
    if (els.ttsBrightnessSlider) els.ttsBrightnessSlider.value = String(Math.round((p.brightness || 1) * 100));
    if (els.ttsWarmthSlider) els.ttsWarmthSlider.value = String(Math.round((p.warmth || 0) * 100));

    // Auto scroll
    highlighter.setAutoScroll(p.autoScroll !== false);

    // Sync seg buttons
    syncSegBtn(els.ttsThemeSeg, 'data-theme', p.theme);
    syncSegBtn(els.ttsFontSeg, 'data-font', p.font);
    syncSegBtn(els.ttsMarginSeg, 'data-margin', p.margin || 'normal');
    syncSegBtn(els.ttsHighlightSeg, 'data-hl', p.highlightMode || 'sentence');

    // Rate buttons
    const rateBtns = els.ttsRateSeg ? els.ttsRateSeg.querySelectorAll('.tts-rate-btn') : [];
    rateBtns.forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.rate) === p.rate);
    });
  }

  function syncSegBtn(segEl, attr, val) {
    if (!segEl) return;
    segEl.querySelectorAll('.reader-seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute(attr) === String(val));
      btn.setAttribute('aria-pressed', String(btn.getAttribute(attr) === String(val)));
    });
  }

  function changeSize(dir) {
    const next = Math.max(MIN_SIZE, Math.min(MAX_SIZE, prefs.data.size + dir * 2));
    if (next === prefs.data.size) return;
    prefs.data.size = next;
    applyPrefs();
    prefs.save();
  }

  function changeLineHeight(dir) {
    const next = Math.round(Math.max(1.0, Math.min(2.4, prefs.data.lineHeight + dir)) * 10) / 10;
    if (next === prefs.data.lineHeight) return;
    prefs.data.lineHeight = next;
    applyPrefs();
    prefs.save();
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
      els.bookTitleEl.textContent = title;
      bookLoaded = true;

      renderBook(sections);
      if (coverUrl) blobUrls.push(coverUrl);
      clearOverlay();

      if (onBookLoaded) onBookLoaded({ buffer, fileName: file.name, bookId });

      // Save position, build TOC, segment sentences
      requestAnimationFrame(() => {
        sentences = segmentContent();
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

  // ---------- Settings wiring ----------
  function wireSettings() {
    // Theme
    if (els.ttsThemeSeg) {
      els.ttsThemeSeg.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-theme]');
        if (!btn) return;
        prefs.data.theme = btn.dataset.theme;
        applyPrefs();
        prefs.save();
      }, { signal });
    }
    // Font
    if (els.ttsFontSeg) {
      els.ttsFontSeg.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-font]');
        if (!btn) return;
        prefs.data.font = btn.dataset.font;
        applyPrefs();
        prefs.save();
      }, { signal });
    }
    // Margin
    if (els.ttsMarginSeg) {
      els.ttsMarginSeg.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-margin]');
        if (!btn) return;
        prefs.data.margin = btn.dataset.margin;
        applyPrefs();
        prefs.save();
      }, { signal });
    }
    // Highlight mode
    if (els.ttsHighlightSeg) {
      els.ttsHighlightSeg.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-hl]');
        if (!btn) return;
        prefs.data.highlightMode = btn.dataset.hl;
        if (btn.dataset.hl === 'off') highlighter.clearHighlight();
        applyPrefs();
        prefs.save();
      }, { signal });
    }
    // Size
    if (els.ttsSizeDown) els.ttsSizeDown.addEventListener('click', () => changeSize(-1), { signal });
    if (els.ttsSizeUp) els.ttsSizeUp.addEventListener('click', () => changeSize(1), { signal });
    // Line height
    if (els.ttsLineHeightDown) els.ttsLineHeightDown.addEventListener('click', () => changeLineHeight(-0.1), { signal });
    if (els.ttsLineHeightUp) els.ttsLineHeightUp.addEventListener('click', () => changeLineHeight(0.1), { signal });
    // Brightness/warmth
    if (els.ttsBrightnessSlider) {
      els.ttsBrightnessSlider.addEventListener('input', (e) => {
        prefs.data.brightness = parseInt(e.target.value, 10) / 100;
        applyPrefs();
        prefs.save();
      }, { signal });
    }
    if (els.ttsWarmthSlider) {
      els.ttsWarmthSlider.addEventListener('input', (e) => {
        prefs.data.warmth = parseInt(e.target.value, 10) / 100;
        applyPrefs();
        prefs.save();
      }, { signal });
    }
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
  if (els.ttsVoiceBtn) els.ttsVoiceBtn.addEventListener('click', () => {
    openVoicePanel();
    renderVoiceList();
  }, { signal });
  if (els.backdrop) els.backdrop.addEventListener('click', closePanels, { signal });

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
      engine.cancel();
      setPlaying(false);
      savePosition();
      onModeSwitch('read', { fraction: getPositionFraction(), bookId });
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

  wireSettings();

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
    els.bookTitleEl.textContent = 'Pride and Prejudice';
    renderBook(buildSample());
    requestAnimationFrame(() => {
      sentences = segmentContent();
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
