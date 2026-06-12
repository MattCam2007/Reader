// Sentence-index lookup for TTS position restore.
//
// Returns the index of the last sentence whose wordOffset <= ord — i.e. the
// sentence CONTAINING the ordinal. Floor semantics are deliberate: a position
// that falls mid-sentence should re-read that sentence on return to TTS, not
// skip ahead to the next one (seekToSentence then plays from the sentence
// start, so a cross-mode return re-reads the current sentence — the correct
// UX). Binary search over the ascending wordOffset array; the old linear scan
// was O(sentences) per restore.
export function sentenceIndexForOrdinal(sentences, ord) {
  if (!sentences || !sentences.length) return 0;
  let lo = 0, hi = sentences.length - 1, idx = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (sentences[mid].wordOffset <= ord) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return idx;
}
