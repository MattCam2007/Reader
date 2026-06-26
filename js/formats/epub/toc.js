// CSS class pattern for Word/Calibre HTML TOC entries: MsoToc1, MsoToc2, etc.
// MsoToc (no number) is the overall book-title heading row — skipped.
const MSOTOC_CLASS_RE = /\bMsoToc(\d+)\b/i;

// Strips trailing page-number suffixes from Word-generated TOC labels.
// e.g. "Chapter One. 4" → "Chapter One", "PART TWO.. 68" → "PART TWO"
function stripPageNum(str) {
  return str.replace(/[\s. ]+\d+\s*$/, '').trim();
}

// Parse a guide-type TOC from an EPUB 2 book when the NCX is absent or sparse.
// Reads container.xml → OPF → guide reference → HTML TOC file, then extracts
// entries from MsoToc* CSS class paragraphs (the pattern used by Word→Calibre
// converted epubs). Returns TocEntry[] (may be empty on any failure).
export async function parseGuideToc(book) {
  try {
    const zip = book.archive && book.archive.zip;
    if (!zip) return [];

    // Find OPF path via container.xml
    const containerFile = zip.file('META-INF/container.xml');
    if (!containerFile) return [];
    const containerXml = await containerFile.async('text');
    const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
    const rootFileEl = containerDoc.querySelector(
      'rootfile[media-type="application/oebps-package+xml"]');
    const opfPath = rootFileEl && (rootFileEl.getAttribute('full-path') || '');
    if (!opfPath) return [];

    // Load OPF and find guide reference with type="toc"
    const opfFile = zip.file(opfPath);
    if (!opfFile) return [];
    const opfXml = await opfFile.async('text');
    const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');
    const guideRef = opfDoc.querySelector('guide > reference[type="toc"]');
    if (!guideRef) return [];

    // Resolve guide href relative to OPF directory, strip fragment anchor
    const rawGuideHref = guideRef.getAttribute('href') || '';
    const opfDir = opfPath.includes('/') ? opfPath.replace(/[^/]+$/, '') : '';
    const tocFileName = decodeURIComponent(rawGuideHref.split('#')[0]);
    const tocFilePath = opfDir + tocFileName;

    // Load the guide TOC HTML file
    const tocFile = zip.file(tocFilePath);
    if (!tocFile) return [];
    const tocHtml = await tocFile.async('text');

    const doc = new DOMParser().parseFromString(tocHtml, 'application/xhtml+xml');
    const tocDir = tocFilePath.includes('/') ? tocFilePath.replace(/[^/]+$/, '') : '';
    const entries = [];

    doc.querySelectorAll('[class]').forEach(el => {
      const m = MSOTOC_CLASS_RE.exec(el.getAttribute('class') || '');
      if (!m) return;
      const depth = parseInt(m[1], 10) - 1; // MsoToc1 → 0, MsoToc2 → 1, …

      const anchor = el.querySelector('a[href]');
      if (!anchor) return;

      const label = stripPageNum(anchor.textContent);
      if (!label) return;

      // Decode the anchor href; keep it relative to epub root
      const href = tocDir + decodeURIComponent(anchor.getAttribute('href') || '');
      if (!href.trim() || href === tocDir) return;

      entries.push({ label, href, depth });
    });

    return entries;
  } catch (e) {
    console.warn('epub:guide-toc', e);
    return [];
  }
}

// Build a best-effort TOC from the extracted sections when the EPUB provides no
// navigation document. Iterates over every block flagged isTocHeading (set by
// blocksFromDoc for semantic h1-h6 and common calibre/Word/Sigil CSS class
// patterns). Each such block gets its own TOC entry using the synthetic id
// assigned during extraction, so intra-file chapters are individually linkable.
// Falls back to one section-level entry per file when a section has no headings.
export function buildSyntheticToc(sections) {
  const items = [];
  sections.forEach((sec, i) => {
    const headings = sec.blocks.filter(b => b.isTocHeading && b.text.trim());
    if (headings.length) {
      headings.forEach(b => {
        const href = b.id ? sec.href + '#' + b.id : sec.href;
        items.push({ label: b.text.trim(), href, depth: 0 });
      });
    } else {
      // Section has no detected headings — add a file-level fallback entry.
      const label = sec.href.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim()
        || ('Section ' + (i + 1));
      items.push({ label, href: sec.href, depth: 0 });
    }
  });
  return items;
}

export function flattenToc(nodes, depth, acc) {
  (nodes || []).forEach((n) => {
    acc.push({ label: (n.label || "").trim() || "Untitled", href: n.href || "", depth });
    if (n.subitems && n.subitems.length) flattenToc(n.subitems, depth + 1, acc);
  });
  return acc;
}

export function buildTOC(epubToc, headingToc, tocListEl, sectionEls, goToPageFn, closePanelsFn, resolveHrefFn) {
  const items = [];
  if (epubToc && epubToc.length) {
    epubToc.forEach((it) => items.push({ label: it.label, href: it.href, depth: it.depth }));
  } else if (headingToc.length > 0) {
    headingToc.forEach((h) => items.push({ label: h.label, el: h.el, depth: h.depth }));
  }
  tocListEl.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "reader-toc-empty";
    empty.textContent = "No contents available.";
    tocListEl.appendChild(empty);
    return;
  }
  items.forEach((it) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "reader-toc-item depth-" + Math.min(2, it.depth || 0);
    btn.textContent = it.label || "Untitled";
    btn.addEventListener("click", () => {
      const el = it.el || resolveHrefFn(it.href);
      if (el) goToPageFn(el);
      closePanelsFn();
    });
    tocListEl.appendChild(btn);
  });
}

export function resolveHref(href, content, sectionEls) {
  if (!href) return null;
  const parts = href.split("#");
  const frag = parts[1];
  if (frag) {
    try {
      const sel = "#" + CSS.escape(frag);
      // Attached content first (the common, fast path).
      const e = content.querySelector(sel);
      if (e) return e;
      // Windowed rendering detaches all but the current chapter, so the target
      // may live in a detached .chap subtree — search those too (querySelector
      // works on detached elements). sectionEls holds every chapter element.
      for (const sectionEl of sectionEls.values()) {
        if (sectionEl.isConnected) continue; // already covered by content query
        const d = sectionEl.querySelector(sel);
        if (d) return d;
      }
    } catch (e) { console.warn("toc:resolveHref", e); }
  }
  const base = parts[0].split("/").pop();
  // Try both as-is and URL-decoded to handle encoding mismatches between
  // epub.js item hrefs and guide-TOC hrefs (e.g. %2C vs comma).
  let sectionEl = sectionEls.get(base) || null;
  if (!sectionEl) {
    try { sectionEl = sectionEls.get(decodeURIComponent(base)) || null; } catch (_) {}
  }
  // Fragment absent or unresolved: fall back to the section's first heading
  // rather than the file root. Many EPUBs anchor a chapter with an empty
  // <a id="…"/> that carries no text and is dropped during extraction (so the
  // fragment can't resolve), or omit the fragment entirely — and the heading
  // is often not the first thing in the file (an epigraph, part label, or
  // scene break precedes it). Landing on the heading puts us where the chapter
  // visually starts instead of a page or so earlier at the file top.
  if (sectionEl) {
    try {
      const heading = sectionEl.querySelector(
        ".blk-h1, .blk-h2, .blk-h3, .blk-h4, .blk-h5, .blk-h6");
      if (heading) return heading;
    } catch (e) { console.warn("toc:resolveHref:heading", e); }
  }
  return sectionEl;
}
