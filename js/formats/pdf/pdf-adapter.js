// FormatAdapter for PDF. Phase 1 of the format-abstraction roadmap.
//
// PDFs have no semantic block structure — only positioned text runs on fixed
// pages. This adapter reconstructs readable prose from those runs:
//   1. Group text items into lines by their Y coordinate.
//   2. Join a line's items left-to-right, inserting spaces across visual gaps.
//   3. Merge lines into paragraphs using the first-line INDENT signal (a line
//      that starts further right than the body margin begins a new paragraph).
//   4. Detect chapter headings ("Chapter 12", "Prologue", …) — they start a new
//      Section and become TOC entries, so windowing, the chapter chrome and the
//      TOC drawer all work just as they do for EPUB.
//
// The result is the same canonical IR (Section/Block/TocEntry) every mode
// consumes, so Reader, RSVP and TTS all work on a PDF with no mode-specific code.
//
// pdf.js is lazy-loaded from a CDN the first time a PDF is opened (see loadLibs)
// — a reader who only opens EPUBs never downloads it.

import { makeCapabilities } from '../capabilities.js';
import { startsWith } from '../detect.js';
import { registerAdapter } from '../registry.js';

const PDF_VERSION = '4.0.379';
const PDF_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDF_VERSION}`;
const PDF_LIB_URL = `${PDF_BASE}/build/pdf.min.mjs`;
const PDF_WORKER_URL = `${PDF_BASE}/build/pdf.worker.min.mjs`;

// '%PDF' magic bytes.
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];

// A line that begins a heading, AFTER stripping decoration. Different PDFs mark
// chapters differently ("Chapter 1", "— chapter 1 —"), so we strip surrounding
// dashes/asterisks first. Kept tight: must START with one of these words and be
// a short line, so body sentences that merely contain the word are not misread.
const HEADING_RE = /^(chapter|prologue|epilogue|interlude|part)\b/i;
// Decoration commonly wrapped around heading text.
const HEADING_DECORATION = /^[\s\-–—*•·]+|[\s\-–—*•·]+$/g;
// Pixels a first line must be indented past the body margin to count as a new
// paragraph. The detected body margin + this threshold = the indent column.
const INDENT_MIN = 8;

export const pdfAdapter = {
  id: 'pdf',
  label: 'PDF',
  extensions: ['.pdf'],
  mimeTypes: ['application/pdf'],
  priority: 0,

  // Reconstructed PDF text reflows like any other text in the .blk DOM, so the
  // paginated Reader, RSVP and TTS all work. We do not (yet) preserve inline
  // styling or render the original fixed page layout.
  capabilities: makeCapabilities({
    reflow: true,
    richText: false,
    textStream: true,
    images: false,
    toc: true,
    search: true,
    pageFidelity: false,
  }),

  detect(bytes, fileName, mimeType) {
    return startsWith(bytes, PDF_MAGIC)
      || fileName.endsWith('.pdf')
      || mimeType === 'application/pdf';
  },

  // Lazy-load pdf.js (ESM) from the CDN and start its Web Worker. Cached on
  // globalThis so repeat opens (and mode switches that re-open) don't re-import.
  //
  // IMPORTANT: pdf.js must run in a real worker. A cross-origin *module* worker
  // (the raw CDN URL) frequently fails to construct, and pdf.js then silently
  // falls back to a MAIN-THREAD "fake worker" — which freezes the UI and makes a
  // large PDF look like it has hung at "Parsing…". We avoid that by fetching the
  // (self-contained) worker module and running it from a same-origin blob URL.
  async loadLibs() {
    if (globalThis.pdfjsLib) return;
    let mod;
    try {
      mod = await import(/* @vite-ignore */ PDF_LIB_URL);
    } catch (e) {
      throw new Error('PDF library failed to load. Check your connection.');
    }
    try {
      const resp = await fetch(PDF_WORKER_URL);
      if (!resp.ok) throw new Error('worker fetch ' + resp.status);
      const code = await resp.text();
      const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      mod.GlobalWorkerOptions.workerSrc = blobUrl;
    } catch (e) {
      // Best effort: the direct URL still works in some browsers; if it also
      // fails, pdf.js uses the slower main-thread fallback rather than crashing.
      try { mod.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL; } catch (_) {}
    }
    globalThis.pdfjsLib = mod;
  },

  async parse(buffer, fileName, opts = {}) {
    const { onProgress } = opts;
    await this.loadLibs();
    const pdfjsLib = globalThis.pdfjsLib;

    // Clone the bytes — pdf.js may transfer/neuter the buffer to its worker, and
    // the BookSession keeps the original ArrayBuffer.
    const data = new Uint8Array(buffer.slice(0));
    // Text extraction only — do NOT load font glyph data. Fetching standard-font
    // files per page over the network/Service Worker is slow on mobile and is
    // unnecessary for positioning text.
    const pdf = await pdfjsLib.getDocument({
      data,
      disableFontFace: true,
      isEvalSupported: false,
    }).promise;

    const numPages = pdf.numPages;

    // Pass 1: extract lines for every page and learn two layout signals:
    //   bodyLeft   — the most common line start (continuation lines); indented
    //                first lines sit to its right (paragraph signal A).
    //   medianGap  — the normal line-to-line vertical gap; a gap ~2× larger marks
    //                a paragraph break (paragraph signal B). Some PDFs indent,
    //                some only add vertical space, so we use whichever fires.
    const pages = [];
    const xHist = new Map();
    const gaps = [];
    for (let pn = 1; pn <= numPages; pn++) {
      if (onProgress) onProgress('Parsing… ' + pn + ' / ' + numPages);
      const page = await pdf.getPage(pn);
      const tc = await page.getTextContent();
      const lines = pageLines(tc);
      pages.push(lines);
      for (const l of lines) {
        const k = Math.round(l.minX);
        xHist.set(k, (xHist.get(k) || 0) + 1);
      }
      for (let i = 1; i < lines.length; i++) gaps.push(Math.round(lines[i - 1].y - lines[i].y));
      if (typeof page.cleanup === 'function') page.cleanup();
      // Yield to the event loop periodically so the loading overlay repaints and
      // the page stays responsive — important if pdf.js ever falls back to its
      // main-thread worker (then getTextContent does heavy work on this thread).
      if (pn % 8 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    const bodyLeft = modeKey(xHist);
    const paraGap = (median(gaps) || 12) * 1.6;

    // Pass 2: assemble paragraphs and split into sections at headings.
    const sections = [];
    let curBlocks = null;
    let para = '';
    let secCount = 0;
    let headingCount = 0;

    const ensureSection = () => {
      if (!curBlocks) {
        curBlocks = [];
        sections.push({ href: 'sec' + (secCount++), blocks: curBlocks });
      }
    };
    const flushPara = () => {
      const text = para.replace(/\s+/g, ' ').trim();
      para = '';
      if (text) { ensureSection(); curBlocks.push({ type: 'p', text, id: '' }); }
    };
    const addLine = (text) => {
      if (!para) { para = text; return; }
      // De-hyphenate a word broken across lines ("exhila-" + "ration").
      if (/[-‐]$/.test(para) && /^[a-z]/.test(text)) para = para.slice(0, -1) + text;
      else para += ' ' + text;
    };

    for (const lines of pages) {
      // Reset per page: Y coordinates restart at each page top, so we do not
      // treat a page break as a paragraph break (a paragraph may span pages).
      let prevY = null;
      for (const l of lines) {
        const text = l.text;
        if (isPageNumber(text)) { prevY = l.y; continue; }
        const heading = headingLabel(text);
        if (heading) {
          flushPara();
          curBlocks = [];
          sections.push({ href: 'sec' + (secCount++), blocks: curBlocks });
          curBlocks.push({ type: 'h2', text: heading, id: 'toc' + (headingCount++), isTocHeading: true });
          prevY = l.y;
          continue;
        }
        // New paragraph if this line is indented past the body margin (signal A)
        // OR follows an enlarged vertical gap (signal B).
        const gapBreak = prevY !== null && (prevY - l.y) > paraGap;
        const indentBreak = l.minX > bodyLeft + INDENT_MIN;
        if (gapBreak || indentBreak) flushPara();
        addLine(text);
        prevY = l.y;
      }
    }
    flushPara();

    try { if (typeof pdf.destroy === 'function') pdf.destroy(); } catch (_) {}

    const chars = sections.reduce((n, s) =>
      n + s.blocks.reduce((m, b) => m + b.text.length, 0), 0);
    if (chars < 32) {
      throw new Error('No readable text found (this PDF may be scanned images without a text layer).');
    }

    // TOC from detected headings (synthetic — PDFs rarely carry a usable outline).
    const toc = [];
    sections.forEach((sec) => {
      sec.blocks.forEach((b) => {
        if (b.isTocHeading) toc.push({ label: b.text, href: sec.href + '#' + b.id, depth: 0 });
      });
    });

    let metaTitle = '';
    try {
      const meta = await pdf.getMetadata();
      metaTitle = (meta && meta.info && meta.info.Title || '').trim();
    } catch (_) {}
    const title = (metaTitle || fileName).trim();

    return { sections, toc, title, metaTitle, blobUrls: [], cover: null };
  },
};

// Group a page's text items into lines keyed by rounded Y, each line's items
// sorted left-to-right and joined with gap-aware spacing. Returns top-to-bottom.
function pageLines(textContent) {
  const rows = new Map();
  for (const it of textContent.items) {
    if (!it.transform || typeof it.str !== 'string') continue;
    const y = Math.round(it.transform[5]);
    const x = it.transform[4];
    if (!rows.has(y)) rows.set(y, { y, minX: Infinity, parts: [] });
    const r = rows.get(y);
    if (x < r.minX) r.minX = x;
    r.parts.push({ x, w: it.width || 0, h: it.height || 0, s: it.str });
  }
  const lines = [...rows.values()].sort((a, b) => b.y - a.y);
  for (const l of lines) {
    l.parts.sort((a, b) => a.x - b.x);
    l.text = joinParts(l.parts);
  }
  return lines.filter((l) => l.text);
}

// Join positioned runs into a line. Inserts a space where there is a visual gap
// and neither side already has whitespace — this makes both explicit-space PDFs
// and glyph-positioned PDFs read correctly.
function joinParts(parts) {
  let out = '';
  let prevRight = null;
  for (const p of parts) {
    if (prevRight !== null) {
      const gap = p.x - prevRight;
      const threshold = (p.h ? p.h * 0.2 : 1.5);
      if (gap > threshold && !/\s$/.test(out) && !/^\s/.test(p.s)) out += ' ';
    }
    out += p.s;
    prevRight = p.x + p.w;
  }
  return out.replace(/\s+/g, ' ').trim();
}

// Return a normalised heading label for a line, or null if it is not a heading.
// Strips wrapping decoration ("— chapter 1 —" → "chapter 1") and title-cases the
// result so display is consistent across PDFs ("chapter 1" → "Chapter 1").
function headingLabel(text) {
  const t = text.replace(HEADING_DECORATION, '').trim();
  if (!t || t.length > 30) return null;
  if (!HEADING_RE.test(t)) return null;
  if (t.split(/\s+/).length > 4) return null;
  // Reject prose that merely starts with the keyword: a comma, or a sentence
  // word ending in a period ("part other.", "part, Galen was nervous."), means
  // this is body text. A trailing period after a digit/numeral ("Chapter 1.")
  // is fine.
  if (/,/.test(t)) return null;
  if (/[a-z]\.$/.test(t)) return null;
  return t.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// A line that is just a page number (pure digits). Roman numerals are NOT
// stripped — too easily confused with a one-word line of dialogue.
function isPageNumber(text) {
  return /^\d{1,4}$/.test(text.trim());
}

// Return the key with the highest count in a Map<number, count>; 0 if empty.
function modeKey(hist) {
  let best = 0, bestN = -1;
  for (const [k, n] of hist) if (n > bestN) { bestN = n; best = k; }
  return best;
}

// Median of an array of numbers; 0 for an empty array.
function median(arr) {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

registerAdapter(pdfAdapter);
