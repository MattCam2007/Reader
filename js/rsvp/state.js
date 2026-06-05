export class RsvpState {
  constructor() {
    // Playback
    this.currentIdx = 0;
    this.pendingTimer = null;
    this.playState = 'paused'; // 'playing' | 'paused' | 'loading' | 'error' | 'countdown'
    this.rampRemaining = 0;
    this.manuallySeeked = false;
    this.sliderDragging = false;

    // Token data (set on load)
    this.tokens = [];
    this.paragraphs = [];
    this.paragraphStarts = [];
    this.tokenToPara = [];
    this.wordTokenIndices = [];
    this.tokenToWordOrdinal = [];
    this.sentenceStarts = [];

    // Book metadata
    this.chapters = [];
    this.isEpubLoaded = false;
    this.bookId = null;
  }

  get totalWords() {
    return this.wordTokenIndices.length;
  }

  loadTokens(result) {
    this.tokens = result.tokens;
    this.paragraphs = result.paragraphs;
    this.paragraphStarts = result.paragraphStarts;
    this.tokenToPara = result.tokenToPara;
    this.wordTokenIndices = result.wordTokenIndices;
    this.tokenToWordOrdinal = result.tokenToWordOrdinal;
    this.sentenceStarts = result.sentenceStarts;
  }

  setPlayState(s) {
    this.playState = s;
    document.body.classList.remove("paused", "loading", "error", "welcome");
    if (s === "paused") document.body.classList.add("paused");
    else if (s === "loading") document.body.classList.add("loading");
    else if (s === "error") document.body.classList.add("error");
  }

  wordOrdinalAt(idx) {
    if (!this.wordTokenIndices.length) return 0;
    let i = Math.max(0, Math.min(idx, this.tokens.length - 1));
    if (this.tokenToWordOrdinal[i] >= 0) return this.tokenToWordOrdinal[i];
    let f = i;
    while (f < this.tokens.length && this.tokenToWordOrdinal[f] < 0) f++;
    if (f < this.tokens.length) return this.tokenToWordOrdinal[f];
    while (i >= 0 && this.tokenToWordOrdinal[i] < 0) i--;
    return i >= 0 ? this.tokenToWordOrdinal[i] : 0;
  }

  ordinalToIdx(ord) {
    if (!this.wordTokenIndices.length) return 0;
    const o = Math.max(0, Math.min(ord, this.wordTokenIndices.length - 1));
    return this.wordTokenIndices[o];
  }

  currentWordIdx(from) {
    return this.ordinalToIdx(this.wordOrdinalAt(from));
  }

  getParagraphIndex(idx) {
    if (idx < 0) return 0;
    if (idx >= this.tokens.length) return this.paragraphs.length - 1;
    if (this.tokenToPara[idx] >= 0) return this.tokenToPara[idx];
    let i = idx;
    while (i < this.tokens.length && this.tokenToPara[i] < 0) i++;
    if (i < this.tokens.length) return this.tokenToPara[i];
    i = idx;
    while (i >= 0 && this.tokenToPara[i] < 0) i--;
    return Math.max(0, this.tokenToPara[i] || 0);
  }
}
