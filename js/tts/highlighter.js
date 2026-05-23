export class TtsHighlighter {
  constructor(contentEl, viewportEl) {
    this._contentEl = contentEl;
    this._viewportEl = viewportEl;
    this._sentences = [];
    this._currentEl = null;
    this._autoScroll = true;
  }

  setSentences(sentences) {
    this._sentences = sentences;
  }

  setAutoScroll(enabled) {
    this._autoScroll = enabled;
  }

  highlightSentence(index) {
    const sent = this._sentences[index];
    if (!sent) return;

    // Remove previous
    if (this._currentEl && this._currentEl !== sent.blockEl) {
      this._currentEl.classList.remove('tts-sentence-hl');
    }

    this._currentEl = sent.blockEl;
    this._currentEl.classList.add('tts-sentence-hl');

    if (this._autoScroll) {
      // Smooth scroll so the sentence is visible, near center
      try {
        this._currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (_) {
        this._currentEl.scrollIntoView(false);
      }
    }
  }

  clearHighlight() {
    if (this._currentEl) {
      this._currentEl.classList.remove('tts-sentence-hl');
      this._currentEl = null;
    }
    // Safety: clear all in case of rapid transitions
    this._contentEl.querySelectorAll('.tts-sentence-hl').forEach(el => {
      el.classList.remove('tts-sentence-hl');
    });
  }
}
