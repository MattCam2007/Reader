export class TtsHighlighter {
  constructor(contentEl, viewportEl) {
    this._contentEl = contentEl;
    this._viewportEl = viewportEl;
    this._sentences = [];
    this._currentEl = null;
    this._wordMark = null;
    this._autoScroll = true;
  }

  setSentences(sentences) {
    this._sentences = sentences;
  }

  setAutoScroll(enabled) {
    this._autoScroll = enabled;
  }

  // Highlight a specific DOM element (sentence span or block el)
  highlightAt(el) {
    if (this._currentEl && this._currentEl !== el) {
      this._currentEl.classList.remove('tts-sentence-hl');
    }
    this._currentEl = el;
    el.classList.add('tts-sentence-hl');
    if (this._autoScroll) {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      catch (_) { el.scrollIntoView(false); }
    }
  }

  // Convenience: highlight sentence's default span element
  highlightSentence(index) {
    const sent = this._sentences[index];
    if (sent) this.highlightAt(sent.highlightEl || sent.blockEl);
  }

  // Highlight the whole paragraph block for a sentence
  highlightParagraph(index) {
    const sent = this._sentences[index];
    if (sent) this.highlightAt(sent.blockEl);
  }

  clearHighlight() {
    this.clearWordHighlight();
    if (this._currentEl) {
      this._currentEl.classList.remove('tts-sentence-hl');
      this._currentEl = null;
    }
    // Safety sweep
    this._contentEl.querySelectorAll('.tts-sentence-hl').forEach(el => {
      el.classList.remove('tts-sentence-hl');
    });
  }

  // Word-level highlight within the current sentence span.
  // charIndex/charLength are offsets into the utterance text (= sentences[i].text).
  highlightWord(sentenceIndex, charIndex, charLength) {
    if (charLength <= 0) return;
    const sent = this._sentences[sentenceIndex];
    // Only works when we have a sentence span (not a fallback blockEl)
    if (!sent || sent.highlightEl === sent.blockEl) return;

    this.clearWordHighlight();

    const range = this._rangeInEl(sent.highlightEl, charIndex, charIndex + charLength);
    if (!range) return;
    try {
      const mark = document.createElement('span');
      mark.className = 'tts-word-hl';
      range.surroundContents(mark);
      this._wordMark = mark;
    } catch (_) {
      // Word boundary crossed an element — skip silently
    }
  }

  clearWordHighlight() {
    if (!this._wordMark) return;
    const mark = this._wordMark;
    this._wordMark = null;
    const parent = mark.parentNode;
    if (!parent) return;
    // Unwrap: move mark's children before it, then remove mark
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    // Merge any adjacent text nodes created by the wrap/unwrap cycle
    parent.normalize();
  }

  // Return a Range spanning [startChar, endChar) within el's text nodes.
  _rangeInEl(el, startChar, endChar) {
    const range = document.createRange();
    let charCount = 0;
    let startSet = false, endSet = false;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const len = node.textContent.length;
      if (!startSet && charCount + len > startChar) {
        range.setStart(node, startChar - charCount);
        startSet = true;
      }
      if (startSet && !endSet && charCount + len >= endChar) {
        range.setEnd(node, endChar - charCount);
        endSet = true;
        break;
      }
      charCount += len;
    }
    return (startSet && endSet) ? range : null;
  }
}
