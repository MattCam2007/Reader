import { wordRange } from '../model/geometry.js';
import { toLocator, resolveLocator, exportTokens } from '../model/locator.js';

export function runSelftest(state) {
  const results = [];
  const assert = (label, ok) => { results.push((ok ? "PASS" : "FAIL") + ": " + label); };
  const { doc } = state;

  assert("doc.words populated", doc.words.length > 0);
  assert("doc.blocks populated", doc.blocks.length > 0);
  assert("doc.sections populated", doc.sections.length > 0);
  assert("doc.text non-empty", doc.text.length > 0);
  assert("wordCharStart aligned", doc.wordCharStart.length === doc.words.length);

  if (doc.words.length > 0) {
    const testIdx = Math.min(5, doc.words.length - 1);
    const loc = toLocator(state, testIdx);
    const resolved = resolveLocator(state, loc);
    assert("locator round-trip (word " + testIdx + ")", resolved === testIdx);
  }

  const tokens = exportTokens(state);
  const wordTokens = tokens.filter(t => t.kind === "word");
  assert("exportTokens word count matches doc.words", wordTokens.length === doc.words.length);

  if (doc.words.length > 0) {
    const range = wordRange(state, 0);
    assert("wordRange returns Range", range instanceof Range);
  }

  console.log("=== Reader Selftest ===");
  results.forEach(r => console.log(r));
  const failures = results.filter(r => r.startsWith("FAIL"));
  if (failures.length) {
    console.warn(failures.length + " test(s) failed");
  } else {
    console.log("All " + results.length + " tests passed");
  }
  return results;
}
