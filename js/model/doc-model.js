export function buildDocModel(state, content) {
  const { doc } = state;
  doc.words.length = 0;
  doc.blocks.length = 0;
  doc.sections.length = 0;
  doc.text = "";
  doc.wordCharStart.length = 0;

  state.sectionBlockStart = [];
  const textParts = [];
  let charOffset = 0;

  const chaps = content.querySelectorAll(".chap");
  chaps.forEach((chap, si) => {
    const secEntry = { href: chap.dataset.href || "", el: chap, wordStart: doc.words.length, wordEnd: doc.words.length };
    doc.sections.push(secEntry);
    state.sectionBlockStart.push(doc.blocks.length);

    const blkEls = chap.querySelectorAll(".blk");
    blkEls.forEach((blkEl) => {
      const bi = doc.blocks.length;
      const blockEntry = { el: blkEl, type: blkEl.tagName.toLowerCase(), section: si, wordStart: doc.words.length, wordEnd: doc.words.length };
      doc.blocks.push(blockEntry);

      const walker = document.createTreeWalker(blkEl, NodeFilter.SHOW_TEXT, null);
      let textNode;
      while ((textNode = walker.nextNode())) {
        const txt = textNode.nodeValue;
        if (!txt) continue;
        const re = /\S+/g;
        let m;
        while ((m = re.exec(txt)) !== null) {
          const word = m[0];
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
      }
      blockEntry.wordEnd = doc.words.length;
    });
    secEntry.wordEnd = doc.words.length;
  });

  doc.text = textParts.join(" ");
}
