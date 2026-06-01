import { SelectionToolbar } from '../shared/selection-toolbar.js';

// Reader-side wrapper around the shared SelectionToolbar. Adds "Speed" and
// "Listen" actions that resolve the start of the selection to a global word
// index, so switching modes resumes from the selected word rather than the
// top of the current page.
export class SelectionManager {
  constructor(state, signal, opts = {}) {
    this.state = state;
    const modes = opts.onModeSwitch
      ? [
          { mode: 'rsvp', label: '⚡ Speed' },
          { mode: 'tts', label: '🔊 Listen' },
        ]
      : [];
    this._toolbar = new SelectionToolbar({
      signal,
      isEnabled: () => !!(state._prefs && state._prefs.data && state._prefs.data.selection),
      resolveFraction: (range) => this._fractionFromRange(range),
      fallbackFraction: opts.getFallbackFraction,
      getBookId: opts.getBookId,
      onModeSwitch: opts.onModeSwitch,
      modes,
    });
  }

  // Map the start of a DOM range to a fraction (0..1) of the way through the book,
  // using the document model's word→textNode mapping.
  _fractionFromRange(range) {
    const words = this.state.doc && this.state.doc.words;
    if (!words || !words.length) return null;
    const wi = this._wordIndexFromRange(range, words);
    if (wi < 0) return null;
    return wi / words.length;
  }

  _wordIndexFromRange(range, words) {
    let node = range.startContainer;
    let offset = range.startOffset;
    if (node && node.nodeType === Node.ELEMENT_NODE) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const first = walker.nextNode();
      if (first) { node = first; offset = 0; }
    }
    if (!node) return -1;

    // A single text node can hold several words; pick the one covering the offset.
    let firstOnNode = -1;
    for (let i = 0; i < words.length; i++) {
      if (words[i].node === node) {
        if (firstOnNode < 0) firstOnNode = i;
        if (offset < words[i].end) return i;
      } else if (firstOnNode >= 0) {
        return i - 1; // offset is past the last word on this node
      }
    }
    if (firstOnNode >= 0) return words.length - 1;

    // The selection started in a node with no indexed words (whitespace, a
    // punctuation-only span, etc.): use the first word at or after it in DOM order.
    for (let i = 0; i < words.length; i++) {
      const pos = node.compareDocumentPosition(words[i].node);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return i;
    }
    return -1;
  }

  dismiss() {
    this._toolbar.dismiss();
  }
}
