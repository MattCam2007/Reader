import { extractSections } from '../epub/extractor.js';
import { resolveImageUrls } from '../epub/images.js';
import { flattenToc } from '../epub/toc.js';
import { deriveBookId } from './position.js';
import * as perf from './perf.js';

// The single whitespace-word tokenisation rule every mode must agree on. RSVP's
// sectionsToText, TTS's segmentContent and the Reader's doc-model all measure
// section word counts from this exact rule, so cross-mode position hand-off is
// count-exact. Centralising it makes drift impossible by construction.
export function splitWords(text) {
  if (!text) return [];
  return text.split(/\s+/).filter(Boolean);
}

export function countWords(text) {
  return splitWords(text).length;
}

// A BookSession owns the parsed book and its mode-agnostic extracted data —
// built ONCE and shared by every mode. Switching modes reuses this instead of
// re-running ePub()/extractSections from scratch (the multi-second stall the
// performance plan targets). The expensive, mode-agnostic work (parse, extract,
// resolve images) happens exactly once per book regardless of how many modes
// the reader visits.
//
// Image blob URLs are resolved once and baked onto the template frag <img>
// nodes; renderBook clones those frags, so the resolved src rides along into
// each mode's DOM with no re-resolution. The session owns the blob URLs and
// revokes them on dispose() — modes must NOT revoke them.
export class BookSession {
  constructor(data) {
    this.sections = data.sections || [];
    this.allImgUrls = data.allImgUrls || [];
    this.toc = data.toc || [];
    this.bookId = data.bookId || '';
    this.fileName = data.fileName || '';
    this.title = data.title || '';
    this.buffer = data.buffer || null;
    this._blobUrls = data.blobUrls || [];
    this.isSample = !!data.isSample;
  }

  // Build a session from raw EPUB bytes. Runs the whole mode-agnostic pipeline
  // (parse → flatten toc → extract sections → resolve images) once, then
  // destroys the epub.js book object since the blob URLs are already
  // materialised and the rest of the data is plain JS.
  static async fromBuffer(buffer, fileName, urlId, onProgress) {
    if (typeof ePub !== 'function') {
      throw new Error('EPUB library failed to load. Check your connection.');
    }
    const book = ePub(buffer);
    await book.ready;

    let toc = [];
    try {
      const nav = await book.loaded.navigation;
      toc = flattenToc(nav && nav.toc, 0, []);
    } catch (e) { console.warn('session:toc', e); }

    const { sections, allImgUrls } = await perf.timeAsync('session:extract', () =>
      extractSections(book, onProgress));

    const chars = sections.reduce((n, s) => n + s.blocks.reduce((m, b) => m + b.text.length, 0), 0);
    if (chars < 32) {
      try { if (typeof book.destroy === 'function') book.destroy(); } catch (_) {}
      throw new Error('No readable text found (this EPUB may be image-only or DRM-protected).');
    }

    // Resolve images once, baking src onto the template frag <img> nodes.
    const blobUrls = allImgUrls.length
      ? await perf.timeAsync('session:images', () => resolveImageUrls(allImgUrls, book))
      : [];

    const meta = (book.packaging && book.packaging.metadata) || {};
    const title = (meta.title || fileName).trim();
    const bookId = deriveBookId(urlId, meta.title, fileName);

    try { if (typeof book.destroy === 'function') book.destroy(); } catch (e) { console.warn('session:destroy', e); }

    return new BookSession({ sections, allImgUrls, toc, bookId, fileName, title, buffer, blobUrls });
  }

  // Wrap an in-memory sections array (the built-in sample) as a session so the
  // load path is uniform. No book, no images.
  static fromSample(sections, bookId, title) {
    return new BookSession({ sections, toc: [], bookId, title, isSample: true });
  }

  // Release the owned image blob URLs. Call when this session is being replaced
  // by a different book (NOT on a mode switch — the session is shared then).
  dispose() {
    this._blobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (_) {} });
    this._blobUrls = [];
  }
}
