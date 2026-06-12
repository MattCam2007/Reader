import { wordRange, pageOfWord, wordAtPageStart } from '../model/geometry.js';
import { toLocator, resolveLocator, exportTokens } from '../model/locator.js';
import { deriveBookId, buildPosition, resolvePosition } from '../core/position.js';
import { blocksFromDoc, sanitizeInline, safeAnchorHref } from '../formats/epub/extractor.js';
import { EventBus } from '../core/events.js';
import { FONT_MAP, SETTINGS, DEFAULT_PREFS, EXTRACTABLE_BLOCK_TYPES, EXTRACTABLE_BLOCK_SELECTOR } from '../core/constants.js';
import { PrefsManager } from '../core/prefs.js';
import { buildDocModel } from '../model/doc-model.js';
import { buildChapterIndex } from '../reader/chapters.js';
import { countWords, splitWords } from '../core/book-session.js';
import { findHits, indexForOffset } from '../shared/search.js';
import { renderSections, annotateInlineText } from '../shared/render.js';
import { loadPageCache, savePageCache, PAGE_KEY_PREFIX } from '../core/page-cache.js';
import { validateBookSrcUrl } from '../core/src-url.js';
import { PageCounter } from '../reader/page-counter.js';
import { makeCapabilities, FULL_CAPABILITIES, NO_CAPABILITIES, CAPABILITY_KEYS } from '../formats/capabilities.js';
import { magicBytes, startsWith, ZIP_MAGIC } from '../formats/detect.js';
import { listAdapters, getAdapterById, selectAdapter, acceptString } from '../formats/registry.js';
import '../formats/index.js'; // ensure adapters are registered for format tests

export function runSelftest(state, hooks) {
  const results = [];
  const assert = (module, label, ok) => {
    results.push({ module, label, ok, display: (ok ? "PASS" : "FAIL") + ": [" + module + "] " + label });
  };
  const { doc } = state;

  // --- core/constants ---
  assert("constants", "FONT_MAP has the 4 font keys",
    ["serif", "sans", "dyslexic", "mono"].every(k => typeof FONT_MAP[k] === "string")
    && Object.keys(FONT_MAP).length === 4);
  assert("constants", "SETTINGS is non-empty array", Array.isArray(SETTINGS) && SETTINGS.length > 0);
  assert("constants", "DEFAULT_PREFS has theme", typeof DEFAULT_PREFS.theme === "string");

  // --- core/events ---
  const bus = new EventBus();
  let fired = false;
  bus.on("test", () => { fired = true; });
  bus.emit("test");
  assert("events", "EventBus fires listeners", fired);
  let wildFired = false;
  bus.on("*", () => { wildFired = true; });
  bus.emit("other");
  assert("events", "EventBus wildcard fires", wildFired);

  // --- model/doc-model ---
  assert("doc-model", "doc.words populated", doc.words.length > 0);
  assert("doc-model", "doc.blocks populated", doc.blocks.length > 0);
  assert("doc-model", "doc.sections populated", doc.sections.length > 0);
  assert("doc-model", "doc.text non-empty", doc.text.length > 0);
  assert("doc-model", "wordCharStart aligned", doc.wordCharStart.length === doc.words.length);

  // --- model/locator ---
  if (doc.words.length > 0) {
    const testIdx = Math.min(5, doc.words.length - 1);
    const loc = toLocator(state, testIdx);
    assert("locator", "toLocator returns object", loc !== null && typeof loc === "object");
    assert("locator", "locator has s,b,w", "s" in loc && "b" in loc && "w" in loc);
    const resolved = resolveLocator(state, loc);
    assert("locator", "round-trip (word " + testIdx + ")", resolved === testIdx);

    // Edge cases
    const locFirst = toLocator(state, 0);
    assert("locator", "first word resolves", resolveLocator(state, locFirst) === 0);
    const locLast = toLocator(state, doc.words.length - 1);
    assert("locator", "last word resolves", resolveLocator(state, locLast) === doc.words.length - 1);
  }

  // --- model/locator: exportTokens ---
  const tokens = exportTokens(state);
  const wordTokens = tokens.filter(t => t.kind === "word");
  assert("locator", "exportTokens word count matches", wordTokens.length === doc.words.length);

  // --- core/position (canonical, cross-mode position) ---
  {
    // Section table: c1[0..99], c2[100..299], c3[300..399]
    const secs = [
      { href: 'c1', wordStart: 0,   wordCount: 100 },
      { href: 'c2', wordStart: 100, wordCount: 200 },
      { href: 'c3', wordStart: 300, wordCount: 100 },
    ];
    const total = 400;
    // Round-trips exactly within the same stream.
    [0, 50, 100, 250, 399].forEach(ord => {
      const pos = buildPosition(secs, total, ord);
      assert('position', 'round-trip ord ' + ord, resolvePosition(pos, secs, total) === ord);
    });
    const posC2 = buildPosition(secs, total, 250);
    // Reconciles when another mode counts a section's words differently.
    const otherSecs = [
      { href: 'c1', wordStart: 0,   wordCount: 100 },
      { href: 'c2', wordStart: 100, wordCount: 220 }, // 20 more words here
      { href: 'c3', wordStart: 320, wordCount: 100 },
    ];
    const r = resolvePosition(posC2, otherSecs, 420);
    assert('position', 'reconciles differing word counts (in c2)', r >= 100 && r < 320);
    // Falls back gracefully when href is unknown.
    const orphan = { v: 1, href: 'gone', wordInSec: 5, secWords: 10, ord: 200, words: 400, f: 0.5 };
    const fb = resolvePosition(orphan, secs, total);
    assert('position', 'unknown href falls back via ordinal', fb === 200);
    // deriveBookId precedence: id > title > filename(sans .epub).
    assert('position', 'bookId prefers ?id', deriveBookId('the-id', 'Title', 'f.epub') === 'the-id');
    assert('position', 'bookId falls to title', deriveBookId('', 'Title', 'f.epub') === 'Title');
    assert('position', 'bookId falls to filename', deriveBookId('', '', 'My Book.epub') === 'My Book');

    // Regression for the "off by a page" bug. The fix that makes cross-mode
    // hand-off word-exact is that every mode counts the SAME words per section
    // (extractor/doc-model/RSVP/TTS now all include figure captions, tables and
    // pre). When section word counts match, the one-way Reader->other mapping
    // must be exact for EVERY word — no scaling, no drift, no page flip.
    {
      const mk = (counts) => {
        let s = 0; const a = [];
        counts.forEach((c, i) => { a.push({ href: 'c' + i, wordStart: s, wordCount: c }); s += c; });
        return { secs: a, total: s };
      };
      const reader = mk([300, 450, 360]);
      const sameCounts = mk([300, 450, 360]); // identical tokenisation across modes
      let exactOneWay = true;
      for (let w = 0; w < reader.total; w++) {
        const v = resolvePosition(buildPosition(reader.secs, reader.total, w), sameCounts.secs, sameCounts.total);
        if (v !== w) { exactOneWay = false; break; }
      }
      assert('position', 'matching section counts → exact one-way word mapping', exactOneWay);
      // And the section anchor must beat the global-ordinal fallback: a position
      // whose href is known resolves via the section, not the (lossy) ordinal.
      const gap = mk([300, 465, 360]); // other mode counted 15 extra words in c2
      const at = buildPosition(reader.secs, reader.total, 300); // first word of c2 in reader
      assert('position', 'href anchor pins section start across count drift',
        resolvePosition(at, gap.secs, gap.total) === 300); // c2 starts at 300 in both
    }

    // Text-anchored exact snap. When two modes are a few words off numerically,
    // matching the saved snippet must land on the exact word — even when the
    // snippet's leading word repeats elsewhere (tie-break toward prediction).
    {
      const prose = ('the quick brown fox jumps over the lazy dog and then the cat ' +
        'sat on the mat by the door while rain fell softly on the tin roof').split(' ');
      const src = [{ href: 'c', wordStart: 0, wordCount: prose.length }];
      const srcAt = (i) => prose[i] || '';
      const SHIFT = 3; // target counts 3 phantom words before the prose
      const tgtWords = ['x', 'y', 'z'].concat(prose);
      const tgt = [{ href: 'c', wordStart: 0, wordCount: tgtWords.length }];
      const tgtAt = (i) => tgtWords[i] || '';
      let exact = true;
      for (let a = 0; a < prose.length - 8; a++) {
        const p = buildPosition(src, prose.length, a, srcAt);
        if (resolvePosition(p, tgt, tgtWords.length, tgtAt) !== a + SHIFT) { exact = false; break; }
      }
      assert('position', 'text snap lands exactly despite numeric drift', exact);
      const rep = buildPosition(src, prose.length, 11, srcAt); // "the cat sat on the mat…"
      assert('position', 'text snap tie-breaks repeated phrase toward prediction',
        resolvePosition(rep, tgt, tgtWords.length, tgtAt) === 11 + SHIFT);
    }
  }

  // --- model/geometry ---
  if (doc.words.length > 0) {
    const range = wordRange(state, 0);
    assert("geometry", "wordRange returns Range", range instanceof Range);
    const p = pageOfWord(state, document.getElementById("content"), 0);
    assert("geometry", "pageOfWord returns number >= 0", typeof p === "number" && p >= 0);
  }

  // --- epub/extractor: sanitizeInline ---
  const testDiv = document.createElement("div");
  testDiv.innerHTML = '<b>bold</b> <script>evil</script> <a href="#x">link</a>';
  const frag = sanitizeInline(testDiv);
  const tempDiv = document.createElement("div");
  tempDiv.appendChild(frag.cloneNode(true));
  assert("extractor", "sanitizeInline keeps <b>", tempDiv.querySelector("b") !== null);
  assert("extractor", "sanitizeInline strips <script>", tempDiv.querySelector("script") === null);
  assert("extractor", "sanitizeInline keeps <a>", tempDiv.querySelector("a") !== null);

  // --- epub/extractor: anchor href sanitisation (B1 — XSS via book anchors) ---
  {
    const dropped = [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\nscript:alert(1)',          // URL parser strips \n — still javascript:
      'java\tscript:alert(1)',
      'javascript:alert(1)',
      'data:text/html,<script>x</script>',
      'vbscript:msgbox(1)',
      '//evil.example.com/x',           // protocol-relative
      'blob:https://x/y',
      'file:///etc/passwd',
    ];
    assert('extractor', 'safeAnchorHref drops every dangerous scheme',
      dropped.every(h => safeAnchorHref(h) === null));
    const kept = ['#fn-12', 'chapter4.xhtml#anchor', '../text/ch01.xhtml',
      'notes/note1.xhtml', 'http://example.com/a', 'https://example.com/a',
      'foo/bar:baz.xhtml'];             // colon after a slash is not a scheme
    assert('extractor', 'safeAnchorHref keeps fragments, relative paths, http(s)',
      kept.every(h => safeAnchorHref(h) === h));
    assert('extractor', 'safeAnchorHref empty/missing href drops',
      safeAnchorHref('') === null && safeAnchorHref(null) === null && safeAnchorHref('   ') === null);

    // End-to-end: a malicious fixture through sanitizeInline comes out inert.
    const evil = document.createElement('div');
    evil.innerHTML = '<a href="javascript:alert(1)">x</a><a href="#fn1">ok</a>';
    // Build the second link's href via DOM to embed a real newline in the scheme.
    const sneak = document.createElement('a');
    sneak.setAttribute('href', 'java\nscript:alert(2)');
    sneak.textContent = 'y';
    evil.appendChild(sneak);
    const out = document.createElement('div');
    out.appendChild(sanitizeInline(evil));
    const anchors = [...out.querySelectorAll('a')];
    assert('extractor', 'sanitizeInline strips javascript: hrefs (fixture inert)',
      anchors.length === 3 && !anchors[0].hasAttribute('href') && !anchors[2].hasAttribute('href'));
    assert('extractor', 'sanitizeInline keeps the fragment href',
      anchors[1].getAttribute('href') === '#fn1');
  }

  // --- epub/extractor: blocksFromDoc ---
  const testDoc = document.createElement("div");
  testDoc.innerHTML = '<p>Hello world</p><h1>Title</h1><p>Paragraph</p>';
  const blocks = blocksFromDoc(testDoc, []);
  assert("extractor", "blocksFromDoc returns blocks", blocks.length >= 2);
  assert("extractor", "blocksFromDoc has h1", blocks.some(b => b.type === "h1"));
  assert("extractor", "blocksFromDoc has p", blocks.some(b => b.type === "p"));

  // --- core/src-url: ?src= fetch guard (B2) ---
  {
    const bad = ['javascript:alert(1)', 'data:text/plain,x', 'file:///etc/passwd',
      'ftp://host/x.epub', 'blob:https://x/y', 'http://user:pass@host/x.epub',
      'https://:secret@host/x.epub'];
    assert('src-url', 'validateBookSrcUrl rejects non-http(s) and credential URLs',
      bad.every(u => validateBookSrcUrl(u) === null));
    assert('src-url', 'validateBookSrcUrl rejects empty/missing',
      validateBookSrcUrl('') === null && validateBookSrcUrl(null) === null);
    assert('src-url', 'validateBookSrcUrl accepts absolute https',
      validateBookSrcUrl('https://example.com/b.epub') === 'https://example.com/b.epub');
    // Same-origin relative library paths resolve against the page URL.
    const rel = validateBookSrcUrl('books/Fiction/x.epub');
    assert('src-url', 'validateBookSrcUrl resolves same-origin relative paths',
      typeof rel === 'string' && rel.endsWith('/books/Fiction/x.epub'));
  }

  // --- core/prefs ---
  {
    const prefs = new PrefsManager();
    assert("prefs", "defaults match DEFAULT_PREFS shape",
      Object.keys(DEFAULT_PREFS).every(k => k in prefs.data));
    assert("prefs", "default theme is string", typeof prefs.data.theme === "string");
    assert("prefs", "default size is number", typeof prefs.data.size === "number");

    // get() returns correct values
    assert("prefs", "get() returns default theme", prefs.get("theme") === DEFAULT_PREFS.theme);
    assert("prefs", "get() returns default size", prefs.get("size") === DEFAULT_PREFS.size);

    // set() updates data AND emits events
    let emittedKey = null, emittedValue = null;
    prefs.on("theme", (val) => { emittedValue = val; });
    prefs.on("change", (key, val) => { emittedKey = key; });
    prefs.set("theme", "sepia");
    assert("prefs", "set() updates data", prefs.data.theme === "sepia");
    assert("prefs", "set() emits key event", emittedValue === "sepia");
    assert("prefs", "set() emits change event", emittedKey === "theme");
    assert("prefs", "get() reflects set()", prefs.get("theme") === "sepia");
  }

  // --- core/events: off() and multiple listeners ---
  {
    const bus2 = new EventBus();

    // off() unsubscribes
    let offCount = 0;
    const offFn = () => { offCount++; };
    bus2.on("evt", offFn);
    bus2.emit("evt");
    assert("events", "listener fires before off()", offCount === 1);
    bus2.off("evt", offFn);
    bus2.emit("evt");
    assert("events", "off() prevents further calls", offCount === 1);

    // Multiple listeners on same event
    let countA = 0, countB = 0;
    bus2.on("multi", () => { countA++; });
    bus2.on("multi", () => { countB++; });
    bus2.emit("multi");
    assert("events", "multiple listeners both fire", countA === 1 && countB === 1);

    // on() returns unsubscribe function
    let countC = 0;
    const unsub = bus2.on("unsub-test", () => { countC++; });
    bus2.emit("unsub-test");
    assert("events", "on() return unsub — listener fires", countC === 1);
    unsub();
    bus2.emit("unsub-test");
    assert("events", "on() return unsub — unsubscribed", countC === 1);
  }

  // --- model/doc-model: buildDocModel ---
  {
    const testContent = document.createElement("div");
    testContent.innerHTML =
      '<div class="chap" data-href="ch1">' +
        '<div class="blk">Hello world</div>' +
        '<div class="blk">Second block here</div>' +
      '</div>' +
      '<div class="chap" data-href="ch2">' +
        '<div class="blk">Chapter two text</div>' +
      '</div>';

    const testState = {
      sectionBlockStart: [],
      doc: { words: [], blocks: [], sections: [], text: "", wordCharStart: [] },
    };
    buildDocModel(testState, testContent);

    assert("doc-model-build", "sections count = 2", testState.doc.sections.length === 2);
    assert("doc-model-build", "blocks count = 3", testState.doc.blocks.length === 3);
    assert("doc-model-build", "words populated (8 words expected)", testState.doc.words.length === 8);
    assert("doc-model-build", "sectionBlockStart length matches sections",
      testState.sectionBlockStart.length === testState.doc.sections.length);
    assert("doc-model-build", "text is non-empty string", testState.doc.text.length > 0);
    assert("doc-model-build", "wordCharStart aligned with words",
      testState.doc.wordCharStart.length === testState.doc.words.length);

    // Whitespace-word bridge must count words the way RSVP/TTS do (split on
    // whitespace), NOT the way render tokens do (punctuation split out). This is
    // the fix for the cross-mode "off by a page" bug: counts must match exactly.
    {
      const punctContent = document.createElement("div");
      // After annotateInlineText, "world," and "End." split punctuation into
      // their own spans — simulate that fragmentation directly.
      punctContent.innerHTML =
        '<div class="chap" data-href="p1"><div class="blk">' +
          'Hello<span>,</span> world<span>.</span> The end<span>.</span>' +
        '</div></div>';
      const ps = { sectionBlockStart: [], doc: { words: [], blocks: [], sections: [], text: "", wordCharStart: [], tokenToWs: [], wsToToken: [] } };
      buildDocModel(ps, punctContent);
      // Whitespace words: "Hello," "world." "The" "end." = 4 (RSVP would agree).
      assert("doc-model-build", "ws word count ignores split punctuation (4)", ps.doc.wsToToken.length === 4);
      // Render tokens include the punctuation spans: 4 words + 3 punct = 7.
      assert("doc-model-build", "render tokens still include punctuation (7)", ps.doc.words.length === 7);
      // Bridge is consistent: every render token maps into range, every ws word
      // points at a valid render token, and ws ordinals are non-decreasing.
      let bridgeOk = ps.doc.tokenToWs.length === ps.doc.words.length;
      for (let i = 1; i < ps.doc.tokenToWs.length; i++) if (ps.doc.tokenToWs[i] < ps.doc.tokenToWs[i - 1]) bridgeOk = false;
      for (let o = 0; o < ps.doc.wsToToken.length; o++) if (ps.doc.tokenToWs[ps.doc.wsToToken[o]] !== o) bridgeOk = false;
      assert("doc-model-build", "render-token <-> ws-word bridge is consistent", bridgeOk);
    }

    // Verify word entry shape
    if (testState.doc.words.length > 0) {
      const w = testState.doc.words[0];
      assert("doc-model-build", "word has 'node' property", "node" in w);
      assert("doc-model-build", "word has 'start' property", "start" in w);
      assert("doc-model-build", "word has 'end' property", "end" in w);
      assert("doc-model-build", "word.node is a Text node", w.node.nodeType === Node.TEXT_NODE);
      assert("doc-model-build", "word.start is number", typeof w.start === "number");
      assert("doc-model-build", "word.end > word.start", w.end > w.start);
    }
  }

  // --- reader/chapters: buildChapterIndex ---
  {
    // Build a minimal content + state that buildChapterIndex can work with
    const chapContent = document.createElement("div");
    chapContent.innerHTML =
      '<div class="chap" data-href="ch1"><div class="blk blk-h1">Chapter One</div></div>' +
      '<div class="chap" data-href="ch2"><div class="blk blk-h2">Chapter Two</div></div>';
    // Temporarily add to DOM so geometry can compute (pageOfElement needs layout)
    chapContent.style.cssText = "position:absolute;left:-9999px;top:0;";
    document.body.appendChild(chapContent);

    const chapState = {
      headingToc: [],
      chapterIndex: [],
      sectionEls: new Map(),
      isScrollMode: false,
      page: 0,
      total: 1,
    };
    // Populate sectionEls from .chap elements
    chapContent.querySelectorAll(".chap").forEach(el => {
      chapState.sectionEls.set(el.dataset.href, el);
    });

    try {
      buildChapterIndex(chapState, chapContent);
      assert("chapters", "chapterIndex is an array", Array.isArray(chapState.chapterIndex));
      assert("chapters", "chapterIndex has entries", chapState.chapterIndex.length > 0);
      if (chapState.chapterIndex.length > 0) {
        const entry = chapState.chapterIndex[0];
        assert("chapters", "entry has 'label' property", "label" in entry);
        assert("chapters", "entry has 'page' property", "page" in entry);
        assert("chapters", "label is a string", typeof entry.label === "string");
        assert("chapters", "page is a number", typeof entry.page === "number");
      }
    } catch (e) {
      assert("chapters", "buildChapterIndex runs without error", false);
      console.warn("chapters:selftest", e);
    } finally {
      document.body.removeChild(chapContent);
    }
  }

  // --- block-types: the shared EXTRACTABLE_BLOCK_TYPES enumeration (A1) ---
  // The Reader (doc-model walks all .blk), TTS (selector derived from the
  // enumeration) and RSVP (type filter derived from it) must count identical
  // words or cross-mode restores drift cumulatively. This converts that silent
  // drift class into a test failure.
  {
    const figFrag = document.createDocumentFragment();
    figFrag.appendChild(document.createElement('img'));
    const figCap = document.createElement('figcaption');
    figCap.textContent = 'A caption of five words';
    figFrag.appendChild(figCap);
    const synth = [
      { href: 's1', blocks: [
        { type: 'h1', text: 'Title Words Here' },
        { type: 'p', text: 'One two three four five.' },
        { type: 'blockquote', text: 'Quoted words, with punctuation!' },
        { type: 'li', text: 'list item words' },
      ] },
      { href: 's2', blocks: [
        { type: 'pre', text: 'preformatted code words' },
        { type: 'table-wrap', text: 'cell one cell two' },
        { type: 'figure', text: 'A caption of five words', frag: figFrag },
        { type: 'p', text: 'Closing paragraph.' },
      ] },
    ];
    const host = document.createElement('div');
    renderSections(host, synth, {});
    annotateInlineText(host);
    const st = { sectionBlockStart: [], doc: { words: [], blocks: [], sections: [], text: '', wordCharStart: [], tokenToWs: [], wsToToken: [] } };
    buildDocModel(st, host);
    const readerCount = st.doc.wsToToken.length;
    let ttsCount = 0;
    host.querySelectorAll(EXTRACTABLE_BLOCK_SELECTOR).forEach(el => { ttsCount += countWords(el.textContent.trim()); });
    const typeSet = new Set(EXTRACTABLE_BLOCK_TYPES);
    let rsvpCount = 0;
    synth.forEach(sec => sec.blocks.forEach(b => {
      if (typeSet.has(b.type) && b.text && b.text.trim()) rsvpCount += countWords(b.text);
    }));
    assert('block-types', 'synthetic book: reader == tts word count (' + readerCount + ')', readerCount > 0 && readerCount === ttsCount);
    assert('block-types', 'synthetic book: reader == rsvp word count (' + rsvpCount + ')', readerCount === rsvpCount);

    // The extractor must emit only enumerated types (a new type would silently
    // escape TTS/RSVP counting otherwise).
    const probeDoc = document.createElement('div');
    probeDoc.innerHTML = '<h3>H</h3><p>p</p><div>d</div><dd>dd</dd><dt>dt</dt>' +
      '<blockquote>q</blockquote><li>li</li><pre>code</pre>' +
      '<table><tbody><tr><td>t</td></tr></tbody></table>' +
      '<figure><img src="x.png"><figcaption>cap</figcaption></figure>';
    const probeBlocks = blocksFromDoc(probeDoc, []);
    assert('block-types', 'extractor emits only EXTRACTABLE_BLOCK_TYPES',
      probeBlocks.length > 0 && probeBlocks.every(b => typeSet.has(b.type)));

    // Live book: the TTS selector over the real rendered sections must count the
    // doc-model's exact whitespace-word total (works windowed — section els are
    // live references even when detached).
    if (doc.sections.length) {
      let liveTts = 0;
      doc.sections.forEach(sec => {
        sec.el.querySelectorAll(EXTRACTABLE_BLOCK_SELECTOR).forEach(el => {
          liveTts += countWords(el.textContent.trim());
        });
      });
      assert('block-types', 'live book: TTS selector count equals doc-model ws count',
        liveTts === doc.wsToToken.length);
    }
  }

  // --- core/book-session: shared word counting (cross-mode count anchor) ---
  {
    assert("book-session", "splitWords ignores runs of whitespace",
      splitWords("  one \t two\nthree  ").length === 3);
    assert("book-session", "countWords matches splitWords length",
      countWords("one two three four") === splitWords("one two three four").length);
    assert("book-session", "countWords empty/nullish is 0",
      countWords("") === 0 && countWords(null) === 0 && countWords("   ") === 0);
  }

  // --- shared/search: binary-search hit resolution (the O(hits×words) fix) ---
  {
    const charStart = [0, 5, 11, 20, 33, 50];
    // Reference: the old linear "last index whose start <= off".
    const linear = (off) => { let r = 0; for (let i = 0; i < charStart.length; i++) { if (charStart[i] <= off) r = i; else break; } return r; };
    let matches = true;
    for (let off = 0; off <= 60; off++) if (indexForOffset(charStart, off) !== linear(off)) matches = false;
    assert("search", "indexForOffset (binary) matches linear scan", matches);
    assert("search", "indexForOffset clamps below first start", indexForOffset(charStart, -5) === 0);

    const haystack = "the cat sat on the mat near the dog";
    const hits = findHits(haystack, "the", 50);
    assert("search", "findHits finds every occurrence", hits.length === 3);
    assert("search", "findHits hits point at real offsets",
      hits.every(h => haystack.substr(h, 3).toLowerCase() === "the"));
    assert("search", "findHits respects maxHits", findHits("a a a a a", "a", 2).length === 2);
    assert("search", "findHits empty query yields nothing", findHits("abc", "", 10).length === 0);
  }

  // --- shared/render: build the .chap/.blk tree + inline annotation ---
  {
    const c = document.createElement("div");
    const headings = [];
    renderSections(c, [{
      href: "s1",
      blocks: [
        { type: "h1", text: "A Title" },
        { type: "p", text: 'She said “Hello.” Right.' },
      ],
    }], { onHeading: (h) => headings.push(h) });
    assert("render", "renderSections builds one .chap", c.querySelectorAll(".chap").length === 1);
    assert("render", "renderSections builds two .blk", c.querySelectorAll(".blk").length === 2);
    assert("render", "renderSections reports headings", headings.length === 1 && headings[0].depth === 0);
    annotateInlineText(c);
    assert("render", "annotate wraps quoted speech", c.querySelector(".inline-speech") !== null);
    assert("render", "annotate wraps punctuation", c.querySelector(".inline-punct") !== null);
    // Annotation must not change the rendered text (positions depend on it).
    assert("render", "annotate preserves text content",
      c.querySelectorAll(".blk")[1].textContent === 'She said “Hello.” Right.');
  }

  // --- page-cache: localStorage round-trip ---
  {
    const testBookId = '__selftest__';
    const testSig = 'sig|1234';
    const testCounts = [3, 5, 2];
    savePageCache(testBookId, testSig, testCounts);
    const cached = loadPageCache(testBookId);
    assert('page-cache', 'round-trip: sig matches', !!(cached && cached.sig === testSig));
    assert('page-cache', 'round-trip: counts match',
      !!(cached && cached.counts.length === 3 && cached.counts[0] === 3 && cached.counts[1] === 5 && cached.counts[2] === 2));
    assert('page-cache', 'round-trip: version is 1', !!(cached && cached.v === 1));
    assert('page-cache', 'mismatched sig returns null',
      loadPageCache(testBookId + 'x') === null);
    try { localStorage.removeItem(PAGE_KEY_PREFIX + testBookId); } catch (_) {}
  }

  // --- page-counter: overall() arithmetic ---
  {
    // Synthetic state with four sections, all measured.
    const mockState = {
      pageCounts: [10, 15, 8, 12],
      pageCountsComplete: true,
      doc: {
        sections: [
          { wsStart: 0,    wsEnd: 300  },
          { wsStart: 300,  wsEnd: 750  },
          { wsStart: 750,  wsEnd: 990  },
          { wsStart: 990,  wsEnd: 1350 },
        ],
      },
    };
    const pc = new PageCounter(mockState, null, null);
    // Chapter 2, page 3 (0-based): before = 10+15 = 25, page = 25+3+1 = 29, total = 45
    const ov = pc.overall(2, 3);
    assert('page-counter', 'overall() page sums previous chapters + pageInChap+1', ov.page === 29);
    assert('page-counter', 'overall() total sums all chapter counts', ov.total === 45);
    assert('page-counter', 'overall() approx=false when complete', ov.approx === false);
    assert('page-counter', 'overall() page >= 1', ov.page >= 1);
    assert('page-counter', 'overall() page <= total', ov.page <= ov.total);

    // First chapter, first page
    const ov0 = pc.overall(0, 0);
    assert('page-counter', 'overall() first chapter/page is 1', ov0.page === 1);

    // Partial counts: chapter 2 unknown — approx should be true
    const partial = Object.assign({}, mockState, {
      pageCounts: [10, 15, undefined, 12],
      pageCountsComplete: false,
    });
    const pc2 = new PageCounter(partial, null, null);
    const ov2 = pc2.overall(1, 0);
    assert('page-counter', 'overall() approx=true when counts incomplete', ov2.approx === true);
    assert('page-counter', 'overall() page >= 1 with partial counts', ov2.page >= 1);
    assert('page-counter', 'overall() estimated total > 0 with partial counts', ov2.total > 0);
  }

  // --- page-counter: live windowed state (when windowed mode is active) ---
  if (state.windowed) {
    assert('page-counter', 'pageCounts array length matches sections',
      state.pageCounts.length === state.doc.sections.length);
    assert('page-counter', 'pageCountSig is a non-empty string',
      typeof state.pageCountSig === 'string' && state.pageCountSig.length > 0);
    // The current chapter's count must always be exact (set by recordCurrent on every turn)
    assert('page-counter', 'current chapter pageCounts entry is a positive integer',
      Number.isInteger(state.pageCounts[state.curChap]) && state.pageCounts[state.curChap] >= 1);
    const measuredCounts = state.pageCounts.filter(c => c != null);
    assert('page-counter', 'all measured counts are positive integers',
      measuredCounts.every(c => Number.isInteger(c) && c >= 1));
  }

  // --- formats: capabilities ---
  {
    const caps = makeCapabilities({ reflow: true, search: true });
    assert('formats', 'makeCapabilities: specified keys are true', caps.reflow === true && caps.search === true);
    assert('formats', 'makeCapabilities: unspecified keys default false', caps.richText === false && caps.pageFidelity === false);
    assert('formats', 'makeCapabilities: all CAPABILITY_KEYS present', CAPABILITY_KEYS.every(k => k in caps));
    assert('formats', 'FULL_CAPABILITIES: all keys true', CAPABILITY_KEYS.every(k => FULL_CAPABILITIES[k] === true));
    assert('formats', 'NO_CAPABILITIES: all keys false', CAPABILITY_KEYS.every(k => NO_CAPABILITIES[k] === false));
  }

  // --- formats: detect helpers ---
  {
    const epubBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    const pdfBytes  = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x00]);
    assert('formats', 'startsWith: ZIP_MAGIC matches epub bytes', startsWith(epubBytes, ZIP_MAGIC));
    assert('formats', 'startsWith: ZIP_MAGIC does not match pdf bytes', !startsWith(pdfBytes, ZIP_MAGIC));
    assert('formats', 'startsWith: empty sig always matches', startsWith(epubBytes, []));
    assert('formats', 'startsWith: too-long sig returns false', !startsWith(new Uint8Array([1, 2]), [1, 2, 3]));
    const got = magicBytes(epubBytes.buffer, 4);
    assert('formats', 'magicBytes: returns correct slice length', got.length === 4);
    assert('formats', 'magicBytes: first byte matches', got[0] === 0x50);
  }

  // --- formats: registry ---
  {
    const adapters = listAdapters();
    assert('formats', 'registry: at least one adapter registered', adapters.length >= 1);
    const epub = getAdapterById('epub');
    assert('formats', 'registry: EPUB adapter is registered', epub !== null);
    assert('formats', 'registry: EPUB adapter has parse function', typeof epub.parse === 'function');
    assert('formats', 'registry: EPUB adapter has detect function', typeof epub.detect === 'function');
    assert('formats', 'registry: EPUB adapter has extensions array', Array.isArray(epub.extensions) && epub.extensions.includes('.epub'));
    assert('formats', 'registry: EPUB adapter has capabilities', epub.capabilities && typeof epub.capabilities === 'object');

    // selectAdapter: EPUB bytes + .epub name → EPUB adapter
    const epubBuf = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
    const selected = selectAdapter(epubBuf, 'book.epub');
    assert('formats', 'registry: selectAdapter picks EPUB for .epub file', selected !== null && selected.id === 'epub');

    // selectAdapter: a genuinely unsupported format → null (no crash)
    const junkBuf = new Uint8Array([0x00, 0x01, 0x02, 0x03]).buffer;
    assert('formats', 'registry: selectAdapter returns null for unsupported format', selectAdapter(junkBuf, 'book.xyz') === null);

    // acceptString: includes both registered formats
    const accept = acceptString();
    assert('formats', 'registry: acceptString includes .epub', accept.includes('.epub'));
    assert('formats', 'registry: acceptString includes .pdf', accept.includes('.pdf'));
  }

  // --- formats: PDF adapter (Phase 1) ---
  {
    const pdf = getAdapterById('pdf');
    assert('formats', 'PDF: adapter is registered', pdf !== null);
    if (pdf) {
      assert('formats', 'PDF: has parse + detect functions', typeof pdf.parse === 'function' && typeof pdf.detect === 'function');
      assert('formats', 'PDF: extensions include .pdf', pdf.extensions.includes('.pdf'));
      // %PDF magic bytes + .pdf name → detected.
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // '%PDF-'
      assert('formats', 'PDF: detect matches %PDF magic', pdf.detect(pdfBytes, 'book.pdf', ''));
      assert('formats', 'PDF: detect matches .pdf extension', pdf.detect(new Uint8Array([0,0,0,0]), 'book.pdf', ''));
      assert('formats', 'PDF: detect rejects an epub', !pdf.detect(new Uint8Array([0x50,0x4b,0x03,0x04]), 'book.epub', ''));
      // Capabilities: reflowable text, no fixed-page fidelity, no inline images (Phase 1).
      assert('formats', 'PDF: textStream + reflow true', pdf.capabilities.textStream === true && pdf.capabilities.reflow === true);
      assert('formats', 'PDF: pageFidelity + images false', pdf.capabilities.pageFidelity === false && pdf.capabilities.images === false);
      // selectAdapter routes a %PDF buffer to the PDF adapter, not EPUB.
      const pdfBuf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer;
      const sel = selectAdapter(pdfBuf, 'book.pdf');
      assert('formats', 'registry: selectAdapter picks PDF for .pdf file', sel !== null && sel.id === 'pdf');
    }
  }

  // --- formats: EPUB adapter capabilities ---
  {
    const epub = getAdapterById('epub');
    if (epub) {
      assert('formats', 'EPUB: reflow capability true', epub.capabilities.reflow === true);
      assert('formats', 'EPUB: textStream capability true', epub.capabilities.textStream === true);
      assert('formats', 'EPUB: pageFidelity capability false', epub.capabilities.pageFidelity === false);
    }
  }

  // --- formats: CBZ adapter ---
  {
    const cbz = getAdapterById('cbz');
    assert('formats', 'CBZ: adapter is registered', cbz !== null);
    if (cbz) {
      assert('formats', 'CBZ: has parse + detect functions',
        typeof cbz.parse === 'function' && typeof cbz.detect === 'function');
      assert('formats', 'CBZ: extensions include .cbz', cbz.extensions.includes('.cbz'));
      // ZIP magic + .cbz extension → detected.
      const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
      assert('formats', 'CBZ: detect matches ZIP magic + .cbz name',
        cbz.detect(zipBytes, 'comic.cbz', ''));
      assert('formats', 'CBZ: detect matches .cbz extension alone',
        cbz.detect(new Uint8Array([0, 0, 0, 0]), 'comic.cbz', ''));
      assert('formats', 'CBZ: detect rejects .epub',
        !cbz.detect(zipBytes, 'book.epub', ''));
      // Capabilities: image-only, no text stream, page fidelity.
      assert('formats', 'CBZ: images capability true', cbz.capabilities.images === true);
      assert('formats', 'CBZ: pageFidelity capability true', cbz.capabilities.pageFidelity === true);
      assert('formats', 'CBZ: textStream capability false', cbz.capabilities.textStream === false);
      assert('formats', 'CBZ: reflow capability false', cbz.capabilities.reflow === false);
      // selectAdapter routes a .cbz file to the CBZ adapter, not EPUB.
      const cbzBuf = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;
      const selCbz = selectAdapter(cbzBuf, 'comic.cbz');
      assert('formats', 'registry: selectAdapter picks CBZ for .cbz file',
        selCbz !== null && selCbz.id === 'cbz');
      // acceptString now includes .cbz.
      assert('formats', 'registry: acceptString includes .cbz', acceptString().includes('.cbz'));
    }
  }

  // --- formats: CBR adapter ---
  {
    const cbr = getAdapterById('cbr');
    assert('formats', 'CBR: adapter is registered', cbr !== null);
    if (cbr) {
      assert('formats', 'CBR: has parse + detect functions',
        typeof cbr.parse === 'function' && typeof cbr.detect === 'function');
      assert('formats', 'CBR: extensions include .cbr', cbr.extensions.includes('.cbr'));
      // RAR magic bytes.
      const rarBytes = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00, 0x00]);
      assert('formats', 'CBR: detect matches RAR magic', cbr.detect(rarBytes, 'comic.cbr', ''));
      assert('formats', 'CBR: detect matches .cbr extension alone',
        cbr.detect(new Uint8Array([0, 0, 0, 0]), 'comic.cbr', ''));
      // Capabilities: same shape as CBZ.
      assert('formats', 'CBR: images capability true', cbr.capabilities.images === true);
      assert('formats', 'CBR: pageFidelity capability true', cbr.capabilities.pageFidelity === true);
      assert('formats', 'CBR: textStream capability false', cbr.capabilities.textStream === false);
      assert('formats', 'CBR: reflow capability false', cbr.capabilities.reflow === false);
      // selectAdapter routes a .cbr file to the CBR adapter.
      const cbrBuf = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00, 0x00]).buffer;
      const selCbr = selectAdapter(cbrBuf, 'comic.cbr');
      assert('formats', 'registry: selectAdapter picks CBR for .cbr file',
        selCbr !== null && selCbr.id === 'cbr');
      // acceptString now includes .cbr.
      assert('formats', 'registry: acceptString includes .cbr', acceptString().includes('.cbr'));
    }
  }

  // --- Live-app tests (need the real reader closures — see selftestHooks) ---
  if (hooks && doc.wsToToken && doc.wsToToken.length) {
    try {
      runLiveTests(state, hooks, assert);
    } catch (e) {
      console.warn('selftest:live', e);
      assert('live', 'live tests completed without exception (' + (e && e.message) + ')', false);
    }
  }

  // --- Report ---
  console.log("=== Reader Selftest ===");
  results.forEach(r => console.log(r.display));
  const failures = results.filter(r => !r.ok);
  if (failures.length) {
    console.warn(failures.length + " test(s) failed");
  } else {
    console.log("All " + results.length + " tests passed");
  }

  // UI report if visible
  showResults(results);

  // Machine-readable handle for the headless harness (test/run-selftest.mjs).
  if (typeof window !== 'undefined') window.__selftestResults = results;

  return results;
}

// Tests that drive the live reader app through its real closures: layout-mode
// switches, bookmark add/check/navigate, and position restores across layout
// changes. Only runs from the ?selftest=1 entry points, where reader-app
// passes its hooks. Restores layout prefs and position when done.
function runLiveTests(state, hooks, assert) {
  const {
    prefs, chrome, bookmarkManager, applyPrefs, relayout, seekToToken,
    getBookmarkContext, navigateToBookmark, getCanonicalPosition,
    applyCanonicalPosition, readerSections, totalWsWords, wsWordText,
  } = hooks;
  const doc = state.doc;
  const totalWs = doc.wsToToken.length;
  const origLayout = prefs.data.layout;
  const origSize = prefs.data.size;
  const origPos = getCanonicalPosition();

  const setLayout = (layout, forceWindow) => {
    prefs.data.layout = layout;
    state.forceWindow = !!forceWindow;
    applyPrefs();        // toggles the layout-scroll body class
    relayout(null);      // explicit null: lay out without a position restore
  };

  const sampleOrds = [0.05, 0.3, 0.55, 0.8, 0.97]
    .map(f => Math.round(f * (totalWs - 1)));

  // --- A7: bookmark anchor / page-presence / navigate symmetry ---
  // For each layout mode: bookmark a position, assert the presence check sees
  // it where it was captured, navigate away and back via the bookmark, and
  // assert the presence check sees it at the landing position. This is the
  // invariant behind the quick-bookmark button: the three operations must
  // agree by construction.
  const layouts = [
    ['paginated', false, 'paginated'],
    ['paginated', true,  'windowed'],
    ['scroll',    false, 'scroll'],
  ];
  for (const [layout, force, name] of layouts) {
    setLayout(layout, force);
    if (name === 'windowed' && !state.windowed) {
      assert('bookmark-symmetry', 'forceWindow enters windowed mode', false);
      continue;
    }
    let ok = true, detail = '';
    for (const ord of sampleOrds) {
      seekToToken(doc.wsToToken[ord]);
      const ctx = getBookmarkContext();
      if (!ctx) { ok = false; detail = 'no context at ord ' + ord; break; }
      const item = bookmarkManager.add(ctx);
      const here = chrome.getPageBookmarks(bookmarkManager.getAll()).some(b => b.id === item.id);
      seekToToken(0);
      navigateToBookmark(item);
      const back = chrome.getPageBookmarks(bookmarkManager.getAll()).some(b => b.id === item.id);
      bookmarkManager.remove(item.id);
      if (!here || !back) {
        ok = false;
        detail = 'ord ' + ord + ': present-at-capture=' + here + ' present-after-navigate=' + back;
        break;
      }
    }
    assert('bookmark-symmetry', name + ': capture/check/navigate agree' + (ok ? '' : ' — ' + detail), ok);
  }

  // --- C2: scroll restore after a font-size change lands the same word ---
  setLayout('scroll', false);
  seekToToken(doc.wsToToken[Math.round(0.5 * (totalWs - 1))]);
  const before = getCanonicalPosition();
  prefs.data.size = origSize + 3;
  applyPrefs();
  relayout(before);
  const after = getCanonicalPosition();
  assert('position-live', 'scroll restore after font-size change lands within ±1 word',
    !!before && !!after && Math.abs(after.ord - before.ord) <= 1);
  prefs.data.size = origSize;
  applyPrefs();
  relayout(null);

  // --- C2: cross-mode round-trip (reader → TTS counting rule → reader) ---
  // Builds the TTS-rule section table + word list from the live DOM (the same
  // derivation tts-app's segmentContent uses) and round-trips positions
  // through it. A1 makes the counts equal; the text snap absorbs the rest.
  {
    const ttsWords = [];
    const ttsSecs = [];
    doc.sections.forEach(sec => {
      const start = ttsWords.length;
      sec.el.querySelectorAll(EXTRACTABLE_BLOCK_SELECTOR).forEach(el => {
        for (const w of splitWords(el.textContent.trim())) ttsWords.push(w);
      });
      ttsSecs.push({ href: sec.href, wordStart: start, wordCount: ttsWords.length - start });
    });
    const ttsAt = (i) => ttsWords[i] || '';
    const readerSecs = readerSections();
    const totalR = totalWsWords();
    let ok = true, detail = '';
    for (const f of [0.1, 0.35, 0.6, 0.85]) {
      const ord = Math.round(f * (totalR - 1));
      const p1 = buildPosition(readerSecs, totalR, ord, wsWordText);
      const tOrd = resolvePosition(p1, ttsSecs, ttsWords.length, ttsAt);
      const p2 = buildPosition(ttsSecs, ttsWords.length, tOrd, ttsAt);
      const back = resolvePosition(p2, readerSecs, totalR, wsWordText);
      if (Math.abs(back - ord) > 1) { ok = false; detail = ord + ' -> ' + tOrd + ' -> ' + back; break; }
    }
    assert('position-live', 'reader → TTS-rule → reader round-trip within ±1 word' + (ok ? '' : ' — ' + detail), ok);
  }

  // Restore the pre-test layout and position.
  state.forceWindow = false;
  prefs.data.layout = origLayout;
  applyPrefs();
  relayout(null);
  if (origPos) applyCanonicalPosition(origPos);
}

function showResults(results) {
  const existing = document.getElementById("selftest-report");
  if (existing) existing.remove();

  const div = document.createElement("div");
  div.id = "selftest-report";
  div.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:rgba(0,0,0,0.95);color:#e8e8e8;font:13px/1.6 monospace;padding:1rem;overflow:auto;";

  const failures = results.filter(r => !r.ok);
  const summary = document.createElement("div");
  summary.style.cssText = "font-size:16px;font-weight:bold;margin-bottom:1rem;color:" + (failures.length ? "#e74c3c" : "#2ecc71");
  summary.textContent = failures.length
    ? failures.length + " FAILED / " + results.length + " total"
    : "All " + results.length + " tests passed";
  div.appendChild(summary);

  // Group by module
  const modules = new Map();
  results.forEach(r => {
    if (!modules.has(r.module)) modules.set(r.module, []);
    modules.get(r.module).push(r);
  });
  for (const [mod, tests] of modules) {
    const h = document.createElement("div");
    h.style.cssText = "color:#888;margin-top:0.8rem;font-weight:bold;";
    h.textContent = mod;
    div.appendChild(h);
    tests.forEach(r => {
      const line = document.createElement("div");
      line.style.color = r.ok ? "#2ecc71" : "#e74c3c";
      line.textContent = (r.ok ? "\u2713 " : "\u2717 ") + r.label;
      div.appendChild(line);
    });
  }

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.style.cssText = "position:fixed;top:1rem;right:1rem;background:#e74c3c;color:#fff;border:0;padding:0.5rem 1rem;border-radius:0.5rem;cursor:pointer;font:inherit;font-weight:bold;";
  closeBtn.addEventListener("click", () => div.remove());
  div.appendChild(closeBtn);

  document.body.appendChild(div);
}
