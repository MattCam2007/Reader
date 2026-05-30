import { lastIndexAtMost, PARAGRAPH_BREAK } from './tokenizer.js';

export function stepWord(state, from, dir) {
  return state.ordinalToIdx(state.wordOrdinalAt(from) + dir);
}

export function stepSentence(state, from, dir) {
  if (!state.sentenceStarts.length) return from;
  const cur = state.currentWordIdx(from);
  const si = lastIndexAtMost(state.sentenceStarts, cur);
  if (dir < 0) {
    if (cur > state.sentenceStarts[si]) return state.sentenceStarts[si];
    return state.sentenceStarts[Math.max(0, si - 1)];
  }
  return state.sentenceStarts[Math.min(state.sentenceStarts.length - 1, si + 1)];
}

export function stepParagraph(state, from, dir) {
  if (!state.paragraphStarts.length) return from;
  const cur = state.currentWordIdx(from);
  const pi = lastIndexAtMost(state.paragraphStarts, cur);
  if (dir < 0) {
    if (cur > state.paragraphStarts[pi]) return state.paragraphStarts[pi];
    return state.paragraphStarts[Math.max(0, pi - 1)];
  }
  return state.paragraphStarts[Math.min(state.paragraphStarts.length - 1, pi + 1)];
}

export function rewindWords(state, from, count) {
  let i = Math.min(from, state.tokens.length - 1);
  let rewound = 0;
  while (rewound < count && i > 0) {
    i--;
    if (state.tokens[i] !== PARAGRAPH_BREAK) rewound++;
  }
  return i;
}

export function stepFn(granularity) {
  if (granularity === "sentence") return stepSentence;
  if (granularity === "paragraph") return stepParagraph;
  return stepWord;
}
