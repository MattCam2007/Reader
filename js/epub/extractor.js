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
      const block = { type: "figure", text: "", id: el.id || "" };
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
        sections.push({ href: base, blocks });
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
