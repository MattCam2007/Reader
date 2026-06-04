export class ReaderState {
  constructor() {
    this.page = 0;
    this.total = 1;
    this.stride = 1;
    this.bookId = "sample";
    this.docModelBuilt = false;
    this.sectionEls = new Map();
    this.headingToc = [];
    this.chapterIndex = [];
    this.sectionBlockStart = [];

    // Windowed rendering (default for paginated layout): only one .chap is
    // attached to the DOM at a time so the browser lays out / paints a fraction
    // of the book per turn (~60× faster turns). The global doc-model is built
    // once at load, so search / bookmarks / canonical position still work; seeks
    // attach the target chapter on demand. Off in scroll layout. See pagination.js.
    this.windowed = false;
    this.chapWindows = [];   // [{ el, marker }] for every chapter, in order
    this.curChap = 0;        // index of the currently-attached chapter
    this.sectionLabels = []; // per-section heading label, for windowed progress

    // Whole-book page counts (windowed mode only). Measured lazily by PageCounter
    // during idle time and cached in localStorage keyed by layout signature so
    // the exact numbers are available instantly on subsequent loads with the same
    // font/size/viewport. undefined entries are unmeasured (still being estimated).
    this.pageCounts = [];          // exact pages per section (undefined = unmeasured)
    this.pageCountsComplete = false;
    this.pageCountSig = "";        // layout signature the pageCounts belong to

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
