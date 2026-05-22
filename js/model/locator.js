export function toLocator(state, globalWordIndex) {
  const { doc, sectionBlockStart } = state;
  if (!doc.words.length) return null;
  const wi = Math.max(0, Math.min(doc.words.length - 1, globalWordIndex));
  const w = doc.words[wi];
  const blk = doc.blocks[w.block];
  const blockInSection = w.block - sectionBlockStart[w.section];
  return {
    s: w.section,
    b: blockInSection,
    w: wi - blk.wordStart,
  };
}

export function resolveLocator(state, loc) {
  const { doc, sectionBlockStart } = state;
  if (!loc || !doc.sections.length) return -1;
  const si = Math.max(0, Math.min(doc.sections.length - 1, loc.s || 0));
  const startBI = sectionBlockStart[si];
  const endBI = si + 1 < doc.sections.length ? sectionBlockStart[si + 1] : doc.blocks.length;
  const sectionBlockCount = endBI - startBI;
  if (!sectionBlockCount) return doc.sections[si].wordStart;
  const bi = Math.max(0, Math.min(sectionBlockCount - 1, loc.b || 0));
  const blk = doc.blocks[startBI + bi];
  const wordCount = blk.wordEnd - blk.wordStart;
  const wi = Math.max(0, Math.min(Math.max(0, wordCount - 1), loc.w || 0));
  return blk.wordStart + wi;
}

export function exportTokens(state) {
  const { doc } = state;
  return doc.words.map((w, i) => {
    const text = w.node.nodeValue.slice(w.start, w.end);
    const needsBreak = i > 0 && doc.words[i].block !== doc.words[i - 1].block;
    const tokens = [];
    if (needsBreak) tokens.push({ text: "\n", kind: "break" });
    tokens.push({ text, kind: "word" });
    return tokens;
  }).flat();
}
