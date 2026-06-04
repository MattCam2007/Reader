import { wordRange, pageOfWord, wordAtPageStart } from '../model/geometry.js';
import { toLocator, resolveLocator, exportTokens } from '../model/locator.js';
import { deriveBookId, buildPosition, resolvePosition } from '../core/position.js';
import { blocksFromDoc, sanitizeInline } from '../epub/extractor.js';
import { EventBus } from '../core/events.js';
import { FONT_MAP, SETTINGS, DEFAULT_PREFS } from '../core/constants.js';
import { PrefsManager } from '../core/prefs.js';
import { buildDocModel } from '../model/doc-model.js';
import { buildChapterIndex } from '../reader/chapters.js';
import { countWords, splitWords } from '../core/book-session.js';
import { findHits, indexForOffset } from '../shared/search.js';
import { renderSections, annotateInlineText } from '../shared/render.js';

export function runSelftest(state) {
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

  // --- epub/extractor: blocksFromDoc ---
  const testDoc = document.createElement("div");
  testDoc.innerHTML = '<p>Hello world</p><h1>Title</h1><p>Paragraph</p>';
  const blocks = blocksFromDoc(testDoc, []);
  assert("extractor", "blocksFromDoc returns blocks", blocks.length >= 2);
  assert("extractor", "blocksFromDoc has h1", blocks.some(b => b.type === "h1"));
  assert("extractor", "blocksFromDoc has p", blocks.some(b => b.type === "p"));

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

  return results;
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
