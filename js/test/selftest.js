import { wordRange, pageOfWord, wordAtPageStart } from '../model/geometry.js';
import { toLocator, resolveLocator, exportTokens } from '../model/locator.js';
import { blocksFromDoc, sanitizeInline } from '../epub/extractor.js';
import { EventBus } from '../core/events.js';
import { FONT_MAP, SETTINGS, DEFAULT_PREFS } from '../core/constants.js';

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
