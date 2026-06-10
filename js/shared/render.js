// Shared book rendering. Building the .chap/.blk DOM tree from extracted
// sections and annotating inline punctuation/speech was byte-for-byte identical
// in reader-app and tts-app (~120 lines duplicated). It lives here once so there
// is a single place to render and a single place to optimise.

// Build the content DOM from `sections`. Clears `content` and (if supplied)
// `sectionEls`, repopulating the latter with href -> .chap element. Calls
// `onHeading({ label, el, depth })` for each h1/h2 so the caller can collect a
// heading TOC. Does NOT annotate — callers run annotateInlineText separately so
// they can wrap it in their own perf span.
export function renderSections(content, sections, opts = {}) {
  const { sectionEls, onHeading } = opts;
  content.innerHTML = "";
  if (sectionEls) sectionEls.clear();
  const frag = document.createDocumentFragment();
  sections.forEach((sec) => {
    const wrap = document.createElement("div");
    wrap.className = "chap";
    if (sec.href) {
      wrap.dataset.href = sec.href;
      if (sectionEls) sectionEls.set(sec.href, wrap);
    }
    sec.blocks.forEach((b) => {
      const el = document.createElement((b.type === "figure" || b.type === "table-wrap") ? "div" : b.type);
      // Clone the frag — the session's `sections` are shared across modes and
      // re-rendered on every mode switch, so the template frag must not be
      // consumed. The resolved image src rides along on the clone.
      if (b.frag) el.appendChild(b.frag.cloneNode(true));
      else el.textContent = b.text;
      if (b.id) el.id = b.id;
      el.className = "blk blk-" + b.type;
      if (b.isTocHeading) el.classList.add("blk-chapter-start");
      if (b.type === "figure") {
        el.querySelectorAll("figcaption").forEach(fc => fc.className = "blk-figcaption");
      }
      wrap.appendChild(el);
      if (onHeading && /^h[1-6]$/.test(b.type)) {
        onHeading({ label: b.text, el, depth: parseInt(b.type[1], 10) - 1 });
      }
    });
    frag.appendChild(wrap);
  });
  content.appendChild(frag);
}

// Wrap quoted speech and punctuation in spans for per-theme coloring.
// Block-level so quote state can span inline elements like emphasis tags.
export function annotateInlineText(root) {
  root.querySelectorAll(".blk").forEach(annotateBlock);
}

function annotateBlock(blk) {
  const SPLIT = /(["“”])|([.,:;!?—–…()\[\]])/g;
  const walker = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let nd;
  while ((nd = walker.nextNode())) nodes.push(nd);

  let inSpeech = false;
  for (const node of nodes) {
    const parent = node.parentNode;
    if (!parent) continue;
    if (parent.closest && parent.closest("code, pre")) continue;
    const text = node.nodeValue;
    let last = 0, m, hasMatch = false;
    const parts = [];

    const pushText = (t) => {
      if (!t) return;
      if (inSpeech) {
        const sp = document.createElement("span");
        sp.className = "inline-speech";
        sp.textContent = t;
        parts.push(sp);
      } else {
        parts.push(document.createTextNode(t));
      }
    };

    SPLIT.lastIndex = 0;
    while ((m = SPLIT.exec(text)) !== null) {
      hasMatch = true;
      pushText(text.slice(last, m.index));
      const ch = m[0];
      if (m[1]) {
        const sp = document.createElement("span");
        sp.className = "inline-speech";
        sp.textContent = ch;
        parts.push(sp);
        if (ch === "“") inSpeech = true;
        else if (ch === "”") inSpeech = false;
        else inSpeech = !inSpeech;
      } else {
        const sp = document.createElement("span");
        sp.className = inSpeech ? "inline-punct inline-punct-speech" : "inline-punct";
        sp.textContent = ch;
        parts.push(sp);
      }
      last = m.index + ch.length;
    }

    if (!hasMatch) {
      if (inSpeech) {
        const sp = document.createElement("span");
        sp.className = "inline-speech";
        sp.textContent = text;
        parent.replaceChild(sp, node);
      }
      continue;
    }

    pushText(text.slice(last));
    const frag2 = document.createDocumentFragment();
    for (const p of parts) frag2.appendChild(p);
    parent.replaceChild(frag2, node);
  }
}
