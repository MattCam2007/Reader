export class ReaderState {
  constructor() {
    this.page = 0;
    this.total = 1;
    this.stride = 1;
    this.bookId = "sample";
    this.docModelBuilt = false;
    this.paginateGen = 0;
    this.pendingDetached = [];
    this.blobUrls = [];
    this.sectionEls = new Map();
    this.headingToc = [];
    this.chapterIndex = [];
    this.sectionBlockStart = [];

    // Phase 6 prototype (?window=1): single-section windowed rendering. Only one
    // .chap is attached to the DOM at a time so the browser lays out / paints a
    // fraction of the book per turn. Diagnostic-grade: no doc-model / canonical
    // position while active (see pagination.js).
    this.windowed = false;
    this.chapWindows = [];   // [{ el, marker }] for every chapter, in order
    this.curChap = 0;        // index of the currently-attached chapter

    // Document model
    this.doc = {
      words: [],
      blocks: [],
      sections: [],
      text: "",
      wordCharStart: [],
      // Bridge between the Reader's render tokenisation (doc.words — punctuation
      // split into its own spans) and whitespace-delimited words (what RSVP/TTS
      // count). Positioning uses the whitespace words so cross-mode hand-off is
      // count-exact. See model/doc-model.js.
      tokenToWs: [],   // render-token index -> whitespace-word ordinal
      wsToToken: [],   // whitespace-word ordinal -> first render-token index
    };
  }

  get isScrollMode() {
    return this._prefs && this._prefs.data.layout === "scroll";
  }

  get fraction() {
    return this.total > 1 ? this.page / (this.total - 1) : 0;
  }

  setPrefs(prefs) {
    this._prefs = prefs;
  }
}
