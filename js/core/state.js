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

    // Document model
    this.doc = {
      words: [],
      blocks: [],
      sections: [],
      text: "",
      wordCharStart: [],
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
