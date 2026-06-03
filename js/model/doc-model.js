export function buildDocModel(state, content) {
  const { doc } = state;
  doc.words.length = 0;
  doc.blocks.length = 0;
  doc.sections.length = 0;
  doc.text = "";
  doc.wordCharStart.length = 0;
  doc.tokenToWs = [];
  doc.wsToToken = [];

  state.sectionBlockStart = [];
  const textParts = [];
  let charOffset = 0;

  // Whitespace-word counter. doc.words is the Reader's *render* tokenisation:
  // annotateInlineText() has already split punctuation into its own spans, so a
  // text like "world." is TWO render tokens ("world" and "."). RSVP and TTS,
  // however, count whitespace-delimited words ("world." is one). If positioning
  // used the render count, every punctuation mark would inflate the Reader's
  // per-section word count, and the cross-mode scaling in core/position.js would
  // drift by a page. So we count whitespace words in lock-step and expose a
  // render-token <-> whitespace-word bridge for the position layer to use.
  let wsOrd = -1;
  let prevEndedWithSpace = true; // a block boundary always starts a new word

  const chaps = content.querySelectorAll(".chap");
  chaps.forEach((chap, si) => {
    const secEntry = {
      href: chap.dataset.href || "", el: chap,
      wordStart: doc.words.length, wordEnd: doc.words.length,
      wsStart: doc.wsToToken.length, wsEnd: doc.wsToToken.length,
    };
    doc.sections.push(secEntry);
    state.sectionBlockStart.push(doc.blocks.length);

    const blkEls = chap.querySelectorAll(".blk");
    blkEls.forEach((blkEl) => {
      const bi = doc.blocks.length;
      const blockEntry = { el: blkEl, type: blkEl.tagName.toLowerCase(), section: si, wordStart: doc.words.length, wordEnd: doc.words.length };
      doc.blocks.push(blockEntry);
      prevEndedWithSpace = true;

      const walker = document.createTreeWalker(blkEl, NodeFilter.SHOW_TEXT, null);
      let textNode;
      while ((textNode = walker.nextNode())) {
        const txt = textNode.nodeValue;
        if (!txt) continue;
        const re = /\S+/g;
        let m;
        let firstInNode = true;
        while ((m = re.exec(txt)) !== null) {
          const word = m[0];
          const tokenIdx = doc.words.length;
          // This render token starts a new whitespace word if it is separated
          // from the previous token by whitespace: any non-first match in a node
          // has leading whitespace by construction; the first match in a node
          // has leading whitespace if it isn't at index 0, or the previous text
          // node ended with whitespace. Otherwise it is a continuation (e.g. the
          // "." after "world", or "matter" after a mid-word <b>anti</b>).
          const isNewWord = !firstInNode || m.index > 0 || prevEndedWithSpace;
          if (isNewWord) { wsOrd++; doc.wsToToken.push(tokenIdx); }
          doc.tokenToWs.push(wsOrd < 0 ? 0 : wsOrd);
          firstInNode = false;

          doc.wordCharStart.push(charOffset);
          doc.words.push({
            node: textNode,
            start: m.index,
            end: m.index + word.length,
            block: bi,
            section: si,
          });
          textParts.push(word);
          charOffset += word.length + 1;
        }
        prevEndedWithSpace = /\s$/.test(txt);
      }
      blockEntry.wordEnd = doc.words.length;
    });
    secEntry.wordEnd = doc.words.length;
    secEntry.wsEnd = doc.wsToToken.length;
  });

  doc.text = textParts.join(" ");
}
