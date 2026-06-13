// FormatAdapter for EPUB. Owns the entire EPUB-specific parse pipeline: epub.js
// invocation, spine extraction, image resolution, TOC flattening. Everything
// returned is the canonical IR (Block/Section/TocEntry) understood by the rest
// of the app. Nothing downstream needs to know this was an EPUB.

import { extractSections } from './extractor.js';
import { resolveImageUrls } from './images.js';
import { flattenToc, buildSyntheticToc } from './toc.js';
import { makeCapabilities } from '../capabilities.js';
import { startsWith, ZIP_MAGIC } from '../detect.js';
import { registerAdapter } from '../registry.js';
import * as perf from '../../core/perf.js';

export const epubAdapter = {
  id: 'epub',
  label: 'EPUB',
  extensions: ['.epub'],
  mimeTypes: ['application/epub+zip'],
  priority: 0,

  capabilities: makeCapabilities({
    reflow: true,
    richText: true,
    textStream: true,
    images: true,
    toc: true,
    search: true,
    pageFidelity: false,
  }),

  // EPUB is a ZIP. Disambiguate from other ZIP-based formats by extension/MIME.
  detect(bytes, fileName, mimeType) {
    const isZip = startsWith(bytes, ZIP_MAGIC);
    const byName = fileName.endsWith('.epub');
    const byMime = mimeType === 'application/epub+zip';
    return (isZip && (byName || byMime)) || byName;
  },

  // Phase 0: epub.js + jszip are loaded globally by reader.html. Just verify.
  async loadLibs() {
    if (typeof ePub !== 'function') {
      throw new Error('EPUB library failed to load. Check your connection.');
    }
  },

  async parse(buffer, fileName, opts = {}) {
    const { onProgress } = opts;
    await this.loadLibs();

    const book = ePub(buffer);
    await book.ready;

    let toc = [];
    try {
      const nav = await book.loaded.navigation;
      toc = flattenToc(nav && nav.toc, 0, []);
    } catch (e) { console.warn('epub:toc', e); }

    const { sections, allImgUrls, warnings } = await perf.timeAsync('session:extract', () =>
      extractSections(book, onProgress));

    const chars = sections.reduce((n, s) =>
      n + s.blocks.reduce((m, b) => m + b.text.length, 0), 0);
    if (chars < 32) {
      try { if (typeof book.destroy === 'function') book.destroy(); } catch (_) {}
      throw new Error('No readable text found (this EPUB may be image-only or DRM-protected).');
    }

    // Synthesise a TOC from heading blocks when the EPUB has no navigation doc.
    if (!toc.length && sections.length > 1) toc = buildSyntheticToc(sections);

    const blobUrls = allImgUrls.length
      ? await perf.timeAsync('session:images', () => resolveImageUrls(allImgUrls, book))
      : [];

    const meta = (book.packaging && book.packaging.metadata) || {};
    const title = (meta.title || fileName).trim();
    const metaTitle = (meta.title || '').trim();

    try { if (typeof book.destroy === 'function') book.destroy(); } catch (e) { console.warn('epub:destroy', e); }

    return { sections, toc, title, metaTitle, blobUrls, cover: null, warnings: warnings || [] };
  },
};

// Self-register when this module is imported.
registerAdapter(epubAdapter);
