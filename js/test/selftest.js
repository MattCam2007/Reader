import { wordRange, pageOfWord, wordAtPageStart } from '../model/geometry.js';
import { toLocator, resolveLocator, exportTokens } from '../model/locator.js';
import { blocksFromDoc, sanitizeInline } from '../epub/extractor.js';
import { EventBus } from '../core/events.js';
import { FONT_MAP, SETTINGS, DEFAULT_PREFS } from '../core/constants.js';
import { PrefsManager } from '../core/prefs.js';
import { buildDocModel } from '../model/doc-model.js';
import { buildChapterIndex } from '../reader/chapters.js';

export function runSelftest(state) {
  const results = [];
  const assert = (module, label, ok) => {
    results.push({ module, label, ok, display: (ok ? "PASS" : "FAIL") + ": [" + module + "] " + label });
  };
  const { doc } = state;

  // --- core/constants ---
  assert("constants", "FONT_MAP has 3 entries", Object.keys(FONT_MAP).length === 3);
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
