import { RICH_INLINE, BLOCK_SEL, SKIP_SEL, INLINE_TAGS, SAFE_ATTRS } from '../core/constants.js';

export function sanitizeInline(srcNode) {
  const frag = document.createDocumentFragment();
  for (const child of srcNode.childNodes) {
    if (child.nodeType === 3) {
      frag.appendChild(document.createTextNode(child.nodeValue));
    } else if (child.nodeType === 1) {
      const tag = child.tagName.toLowerCase();
      if (INLINE_TAGS.has(tag)) {
        const el = document.createElement(tag);
        if (child.id) el.id = child.id;
        const allowed = SAFE_ATTRS[tag];
        if (allowed) {
          for (const attr of allowed) {
            if (child.hasAttribute(attr)) el.setAttribute(attr, child.getAttribute(attr));
          }
        }
        if (tag === "img" && el.hasAttribute("src")) {
          el.dataset.origSrc = el.getAttribute("src");
          el.removeAttribute("src");
        }
        el.appendChild(sanitizeInline(child));
        frag.appendChild(el);
      } else {
        frag.appendChild(sanitizeInline(child));
      }
    }
  }
  return frag;
}

function rootOf(docOrEl) {
  if (!docOrEl) return null;
  if (docOrEl.nodeType === 9) {
    return docOrEl.body || (docOrEl.querySelector && docOrEl.querySelector("body")) || docOrEl.documentElement;
  }
  if (docOrEl.nodeType === 1) {
    const tag = docOrEl.tagName ? docOrEl.tagName.toUpperCase() : "";
    if (tag === "HTML") return (docOrEl.querySelector && docOrEl.querySelector("body")) || docOrEl;
    return docOrEl;
  }
  return null;
}

// CSS class patterns commonly used by calibre/Sigil/Word exports for chapter
// titles that aren't marked up as semantic heading elements.
const HEADING_CLASS_RE = /\b(ch|chap|chapter|chaptitle|chapter[-_]?title|chaptertitle|part|heading|head|section[-_]?title)\b/i;

// Extract the most heading-like text from a raw section document. Called during
// extraction while the original DOM is still available (class info is lost after
// blocks are flattened). Returns null if nothing usable is found.
function extractSectionTitle(docOrEl) {
  const root = rootOf(docOrEl);
  if (!root || !root.querySelector) return null;
  for (const sel of ['h1', 'h2', 'h3']) {
    const el = root.querySelector(sel);
    if (el) {
      const t = (el.textContent || '').trim();
      if (t && t.length <= 120) return t;
    }
  }
  for (const el of root.querySelectorAll('p, div')) {
    if (HEADING_CLASS_RE.test(el.className || '')) {
      const t = (el.textContent || '').trim();
      if (t && t.length <= 120) return t;
    }
  }
  return null;
}

function collectImgSrcs(frag, imgUrls) {
  if (!imgUrls) return;
  const imgs = frag.querySelectorAll ? frag.querySelectorAll("img") : [];
  imgs.forEach(img => {
    const src = img.dataset.origSrc || img.getAttribute("src");
    if (src) imgUrls.push({ img, src });
  });
}

export function blocksFromDoc(docOrEl, imgUrls) {
  const root = rootOf(docOrEl);
  if (!root || !root.querySelectorAll) return [];
  const out = [];
  root.querySelectorAll(BLOCK_SEL).forEach((el) => {
    if (el.closest && el.closest(SKIP_SEL)) return;
    const tag0 = el.tagName.toLowerCase();
    if (tag0 === "img") {
      if (el.closest && el.closest("p,div,figure,li,blockquote,pre,dd,dt,table")) return;
      const block = { type: "figure", text: "", id: el.id || "" };
      if (RICH_INLINE) {
        block.frag = document.createDocumentFragment();
        const clone = document.createElement("img");
        const src = el.getAttribute("src");
        if (src) { clone.dataset.origSrc = src; }
        const alt = el.getAttribute("alt");
        if (alt) clone.setAttribute("alt", alt);
        block.frag.appendChild(clone);
        collectImgSrcs(block.frag, imgUrls);
      }
      out.push(block);
      return;
    }
    if (tag0 === "table") {
      const block = { type: "table-wrap", text: (el.textContent || "").replace(/\s+/g, " ").trim(), id: el.id || "" };
      if (RICH_INLINE) block.frag = sanitizeInline(el);
      out.push(block);
      return;
    }
    if (tag0 === "figure") {
      // Carry the caption text so word-counting modes (RSVP/TTS) count the same
      // words the Reader renders from the figure's frag (which includes the
      // figcaption). An empty text here would make RSVP drop the block and its
      // caption words, shifting every later word ordinal in the section.
      const cap = el.querySelector("figcaption");
      const capText = cap ? (cap.textContent || "").replace(/\s+/g, " ").trim() : "";
      const block = { type: "figure", text: capText, id: el.id || "" };
      if (RICH_INLINE) block.frag = sanitizeInline(el);
      if (block.frag) collectImgSrcs(block.frag, imgUrls);
      out.push(block);
      return;
    }
    if (tag0 === "figcaption") return;
    const nestedBlock = el.querySelector(BLOCK_SEL.replace(",img", ""));
    if (nestedBlock) return;
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    const hasImg = el.querySelector("img");
    if (!text && !hasImg) return;
    let tag = tag0;
    if (tag === "div" || tag === "dd" || tag === "dt") tag = "p";
    const block = { type: tag, text, id: el.id || "" };
    if (RICH_INLINE) {
      block.frag = sanitizeInline(el);
      collectImgSrcs(block.frag, imgUrls);
    }
    out.push(block);
  });
  return out;
}

export async function extractSections(book, onProgress) {
  const items = (book.spine && book.spine.spineItems) || [];
  if (!items.length) throw new Error("This EPUB has no readable spine items.");
  const sections = [];
  const allImgUrls = [];
  for (let i = 0; i < items.length; i++) {
    const section = items[i];
    if (onProgress) onProgress("Parsing\u2026 " + (i + 1) + " / " + items.length);
    try {
      const sectionDoc = await section.load(book.load.bind(book));
      const imgUrls = [];
      const blocks = blocksFromDoc(sectionDoc, imgUrls);
      if (blocks.length) {
        const base = (section.href || ("sec" + i)).split("/").pop().split("#")[0];
        const sectionDir = (section.href || "").replace(/[^/]*$/, "");
        imgUrls.forEach(entry => {
          entry.resolvedSrc = sectionDir + entry.src;
        });
        allImgUrls.push(...imgUrls);
        const title = extractSectionTitle(sectionDoc);
        sections.push({ href: base, blocks, title });
      }
    } catch (err) {
      console.warn("Skipping section:", section && section.href, err);
    } finally {
      if (section && typeof section.unload === "function") {
        try { section.unload(); } catch (e) { console.warn("section:unload", e); }
      }
    }
  }
  return { sections, allImgUrls };
}

/* ── Plain-text extraction for RSVP speed reader ── */

const BLOCK_TAGS_TEXT = new Set([
  "P", "DIV", "SECTION", "ARTICLE",
  "H1", "H2", "H3", "H4", "H5", "H6",
  "LI", "BLOCKQUOTE", "PRE", "DT", "DD",
]);
const SKIP_TAGS_TEXT = new Set([
  "SCRIPT", "STYLE", "NAV", "HEADER", "FOOTER",
  "ASIDE", "FORM", "BUTTON", "SELECT", "INPUT",
  "NOSCRIPT", "TEMPLATE", "IMG", "FIGURE", "FIGCAPTION",
]);

function walkForText(node, buf) {
  if (!node) return;
  if (node.nodeType === 3) { buf.push(node.nodeValue); return; }
  if (node.nodeType !== 1) return;
  const tag = node.tagName.toUpperCase();
  if (SKIP_TAGS_TEXT.has(tag)) return;
  if (tag === "BR") { buf.push("\n"); return; }
  const isBlock = BLOCK_TAGS_TEXT.has(tag);
  if (isBlock) buf.push("\n\n");
  for (const child of node.childNodes) walkForText(child, buf);
  if (isBlock) buf.push("\n\n");
}

function extractTextFromDoc(docOrEl) {
  const root = rootOf(docOrEl);
  if (!root) return "";
  const buf = [];
  walkForText(root, buf);
  let text = buf.join("");
  text = text.replace(/\u00a0/g, " ");
  text = text.replace(/[^\S\n]+/g, " ");
  text = text.replace(/ ?\n ?/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function extractChapterTitle(docOrEl, fallbackNum) {
  const root = rootOf(docOrEl);
  if (!root || !root.querySelector) return "Chapter " + fallbackNum;
  for (const sel of ["h1", "h2", "h3", "title"]) {
    const el = root.querySelector(sel);
    if (el) {
      const t = el.textContent.trim();
      if (t && t.length < 80) return t;
    }
  }
  return "Chapter " + fallbackNum;
}

export async function extractPlainText(book, onProgress) {
  const items = (book.spine && book.spine.spineItems) || [];
  if (!items.length) throw new Error("This EPUB has no readable spine items.");
  const parts = [];
  const chapterMeta = [];
  let totalWords = 0;
  for (let i = 0; i < items.length; i++) {
    const section = items[i];
    if (onProgress) onProgress(i + 1, items.length);
    try {
      const doc = await section.load(book.load.bind(book));
      const text = extractTextFromDoc(doc);
      if (text) {
        const title = extractChapterTitle(doc, chapterMeta.length + 1);
        chapterMeta.push({ title, wordOffset: totalWords });
        totalWords += text.split(/\s+/).filter(Boolean).length;
        parts.push(text);
      }
    } catch (e) {
      console.warn("extractor:plaintext", section && section.href, e);
    } finally {
      if (section && typeof section.unload === "function") {
        try { section.unload(); } catch (_) {}
      }
    }
  }
  return { text: parts.join("\n\n"), chapters: chapterMeta };
}
