const PARAGRAPH_BREAK = "\n";

const TRAILING_CLOSERS = /[")'\]"\u2019]+$/;

function endsSentence(token) {
  const trimmed = token.replace(TRAILING_CLOSERS, "");
  const last = trimmed.charAt(trimmed.length - 1);
  return last === "." || last === "!" || last === "?";
}

export function tokenize(text) {
  const tokens = [];
  const paragraphs = [];
  const paragraphStarts = [];
  const tokenToPara = [];
  const wordTokenIndices = [];
  const tokenToWordOrdinal = [];
  const sentenceStarts = [];
  const paraTexts = text.split(/\n\n+/);
  let sentenceOpen = false;
  paraTexts.forEach((para, pi) => {
    const indices = [];
    const words = para.trim().split(/\s+/).filter(Boolean);
    for (const w of words) {
      const ti = tokens.length;
      if (!sentenceOpen) { sentenceStarts.push(ti); sentenceOpen = true; }
      tokenToPara.push(pi);
      tokenToWordOrdinal.push(wordTokenIndices.length);
      wordTokenIndices.push(ti);
      indices.push(ti);
      tokens.push(w);
      if (endsSentence(w)) sentenceOpen = false;
    }
    sentenceOpen = false;
    paragraphs.push(indices);
    if (indices.length) paragraphStarts.push(indices[0]);
    if (pi < paraTexts.length - 1) {
      tokenToPara.push(-1);
      tokenToWordOrdinal.push(-1);
      tokens.push(PARAGRAPH_BREAK);
    }
  });
  return {
    tokens, paragraphs, paragraphStarts, tokenToPara,
    wordTokenIndices, tokenToWordOrdinal, sentenceStarts,
  };
}

export function orpIndex(word) {
  const n = word.length;
  if (n <= 1)  return 0;
  if (n <= 5)  return 1;
  if (n <= 9)  return 2;
  if (n <= 13) return 3;
  return 4;
}

export { PARAGRAPH_BREAK, endsSentence };

// Binary search: find last index where list[i] <= target
export function lastIndexAtMost(list, target) {
  let lo = 0, hi = list.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] <= target) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}
