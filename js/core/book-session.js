import { deriveBookId } from './position.js';
import { selectAdapter, supportedLabels } from '../formats/registry.js';
import { makeCapabilities, FULL_CAPABILITIES } from '../formats/capabilities.js';
import '../formats/index.js'; // ensure all adapters are registered (side-effect import)
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
// re-running the format-specific parse from scratch.
//
// Image blob URLs are resolved once and baked onto the template frag <img>
// nodes; renderBook clones those frags, so the resolved src rides along into
// each mode's DOM with no re-resolution. The session owns the blob URLs and
// revokes them on dispose() — modes must NOT revoke them.
export class BookSession {
  constructor(data) {
    this.sections = data.sections || [];
    this.toc = data.toc || [];
    this.bookId = data.bookId || '';
    this.fileName = data.fileName || '';
    this.title = data.title || '';
    this.buffer = data.buffer || null;
    this._blobUrls = data.blobUrls || [];
    this.isSample = !!data.isSample;
    // Phase 0: format id and capabilities are carried on the session so modes
    // and UI can degrade gracefully without knowing which format was opened.
    this.format = data.format || '';
    this.capabilities = data.capabilities || makeCapabilities();
  }

  // Parse a file from raw bytes. Detects the format, selects the registered
  // adapter, runs adapter.parse() to produce the canonical IR, then wraps the
  // result. Throws a descriptive Error for unsupported or corrupt files.
  static async fromBuffer(buffer, fileName, urlId, onProgress) {
    const adapter = selectAdapter(buffer, fileName);
    if (!adapter) {
      const ext = (fileName || '').split('.').pop().toLowerCase();
      const supported = supportedLabels().join(', ');
      throw new Error(
        `Reader can't open .${ext} files yet. Supported formats: ${supported}.`
      );
    }

    const parsed = await perf.timeAsync('session:parse', () =>
      adapter.parse(buffer, fileName, { onProgress }));

    const bookId = deriveBookId(urlId, parsed.metaTitle, fileName);

    return new BookSession({
      sections: parsed.sections,
      toc: parsed.toc,
      title: parsed.title,
      blobUrls: parsed.blobUrls,
      bookId,
      fileName,
      buffer,
      format: adapter.id,
      capabilities: adapter.capabilities,
    });
  }

  // Wrap an in-memory sections array (the built-in sample) as a session so the
  // load path is uniform. No book, no images. Full capabilities by convention.
  static fromSample(sections, bookId, title) {
    return new BookSession({
      sections,
      toc: [],
      bookId,
      title,
      isSample: true,
      format: 'sample',
      capabilities: FULL_CAPABILITIES,
    });
  }

  // Release the owned image blob URLs. Call when this session is being replaced
  // by a different book (NOT on a mode switch — the session is shared then).
  dispose() {
    this._blobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (_) {} });
    this._blobUrls = [];
  }
}
