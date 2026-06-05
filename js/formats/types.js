// IR typedefs for the format-abstraction layer.
// Pure JSDoc — no executable code, no imports. Import this file solely for editor
// and DevTools type information.

/**
 * @typedef {Object} Block
 * One structural content unit (paragraph, heading, figure, …).
 *
 * @property {string}           type         'p'|'h1'..'h6'|'figure'|'table-wrap'|'pre'|'li'|'blockquote'
 * @property {string}           text         Collapsed plain text. THE WORD-COUNT ANCHOR — every mode
 *                                           counts words from this via countWords(). Must match any
 *                                           rendered frag word-for-word (same count, same order).
 * @property {string}           id           Anchor id for TOC fragment hrefs. '' if none.
 * @property {DocumentFragment} [frag]       OPTIONAL rich inline DOM for Reader/TTS. Cloned on every
 *                                           render — never consume/mutate. Resolved image src baked
 *                                           onto <img> nodes inside.
 * @property {boolean}          [isTocHeading] True if the synthetic-TOC builder should emit an entry.
 */

/**
 * @typedef {Object} Section
 * One chapter / spine item / logical division.
 *
 * @property {string}  href    Stable unique section key: basename only, no path, no #fragment.
 *                             Determines the .chap data-href and the position anchor across modes.
 *                             Must be deterministic across re-opens of the same file.
 * @property {Block[]} blocks
 */

/**
 * @typedef {Object} TocEntry
 * @property {string} label   Display text.
 * @property {string} href    'sectionHref' or 'sectionHref#blockId'.
 * @property {number} depth   Nesting depth, 0 = top level.
 */

/**
 * @typedef {Object} Capabilities
 * What this format can do. Modes degrade gracefully based on these flags.
 *
 * @property {boolean} reflow       Text reflows at any font/column (EPUB: true; scanned PDF: false).
 * @property {boolean} richText     Inline structure / styling preserved (block frags present).
 * @property {boolean} textStream   A clean word stream can be extracted (RSVP & TTS require this).
 * @property {boolean} images       Embedded images resolvable to blob URLs.
 * @property {boolean} toc          A real or synthesisable table of contents exists.
 * @property {boolean} search       Full-text search supported.
 * @property {boolean} pageFidelity Can render original fixed-page layout (PDF: true; EPUB: false).
 */

/**
 * @typedef {Object} ParsedBook
 * The canonical intermediate representation every format adapter must produce.
 *
 * @property {Section[]}   sections    Non-empty; total text ≥ 32 chars.
 * @property {TocEntry[]}  toc         May be []; book-session synthesises one if empty + isTocHeading set.
 * @property {string}      title       Human-readable title (best metadata, else fileName).
 * @property {string}      metaTitle   Raw metadata title for bookId derivation; '' if unknown.
 * @property {string[]}    blobUrls    Object URLs created during parse. Owned by BookSession.dispose().
 * @property {string|null} [cover]     Optional cover blob URL for library thumbnails.
 */

/**
 * @typedef {Object} FormatAdapter
 * A pluggable format handler. Register via registry.registerAdapter().
 *
 * @property {string}      id            Unique format identifier ('epub', 'pdf', …).
 * @property {string}      label         Human name used in error messages and UI ('EPUB', 'PDF', …).
 * @property {string[]}    extensions    Lowercased, dot-prefixed (['.epub']).
 * @property {string[]}    mimeTypes     MIME types (['application/epub+zip']).
 * @property {Capabilities} capabilities What this format supports.
 * @property {number}      [priority]    Detection priority; higher = checked first (default 0).
 *
 * @property {function(Uint8Array, string, string): boolean} detect
 *   Return true if this adapter handles (bytes, lowerFileName, mimeType). Fast, side-effect-free.
 *
 * @property {function(): Promise<void>} [loadLibs]
 *   Ensure the format's parsing library is available (lazy dynamic import or script injection).
 *   Phase 0 EPUB returns immediately (libs are global). New formats should lazy-load here.
 *
 * @property {function(ArrayBuffer, string, {onProgress?: function}): Promise<ParsedBook>} parse
 *   Parse bytes → canonical IR. Throw a descriptive Error on failure.
 */
