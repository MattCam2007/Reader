# Adding a New File Format

> This guide explains how to teach Reader to open a new file format (PDF, MOBI,
> AZW3, iBook, LIT, plain text, …). It assumes **Phase 0 of the file-format
> abstraction has landed** — i.e. `js/formats/` exists with a registry, detection,
> and the EPUB adapter. See [`plans/file-format-abstraction.md`](../plans/file-format-abstraction.md)
> for the big picture and [`plans/phase-0-format-groundwork.md`](../plans/phase-0-format-groundwork.md)
> for how the groundwork was built.

---

## TL;DR

To add a format you write **one file** — a `FormatAdapter` — and register it. You
do **not** touch the reader, RSVP, TTS, the document model, position math, search,
bookmarks, or the mode switcher. Those all consume a neutral intermediate
representation (the **IR**) that your adapter produces.

> **Worked reference:** the PDF adapter (`js/formats/pdf/pdf-adapter.js`) is a
> complete, shipping example of everything below — lazy CDN library loading,
> magic-byte detection, reconstructing the IR from an unstructured source, and
> synthesising a TOC. Read it alongside this guide.

```
your bytes ──▶ YourAdapter.parse() ──▶ ParsedBook (the IR) ──▶ everything else, unchanged
```

Your entire job is: **turn the file's bytes into the IR**, and **declare honestly
what the format can do** (capabilities).

---

## 1. The contract: produce the IR

Your `parse()` must return a `ParsedBook`. The full typedefs live in
[`js/formats/types.js`](../js/formats/types.js). Here is what each piece means and
the rules you must obey.

### 1.1 `Section`

One chapter / spine item / logical division.

```js
{ href: string, blocks: Block[] }
```

- **`href`** — a **stable, unique** key for this section. It becomes the `.chap`
  element's `data-href` and is part of the cross-mode reading position. Rules:
  - basename only — no directory path, no `#fragment`;
  - stable across re-opens of the same file (don't include random ids);
  - unique within the book.
  - For formats without a natural file name (PDF, plain text), synthesise one:
    `'sec1'`, `'sec2'`, … or `'page-12'`. Just be deterministic.

### 1.2 `Block`

One structural content unit.

```js
{
  type: string,            // 'p' | 'h1'..'h6' | 'figure' | 'table-wrap' | 'pre'
                           //   | 'li' | 'blockquote' | 'table' …
  text: string,            // REQUIRED. Collapsed plain text. THE WORD-COUNT ANCHOR.
  id: string,              // anchor id for TOC fragments ('' if none)
  frag?: DocumentFragment, // OPTIONAL rich inline DOM (see 1.4)
  isTocHeading?: boolean,  // mark headings you want in a synthesised TOC
}
```

**Critical rule — `text` is the position anchor.** RSVP, TTS, and the Reader's
document model all count words by running `countWords(block.text)`
(`js/core/book-session.js`, splits on `/\s+/`). The reading position handed between
modes and saved to `localStorage` is a **word ordinal** computed from these
counts. Therefore:

- Every block that contributes visible words **must** have those words in `text`.
- `text` must be deterministic for the same input (no locale-dependent ordering).
- If you emit a rich `frag` (1.4), the *words rendered from the frag must match
  the words in `text`* (same count, same order). A mismatch makes positions drift
  by exactly the difference — the single most common way to break the "unified
  experience." The EPUB adapter is careful about this for figures/captions
  (see `formats/epub/extractor.js`); follow that example.

**`type` values** drive CSS class names (`blk-<type>`) and a few render special
cases: `figure` and `table-wrap` render as `<div>`, everything else renders as an
element of that tag name. If your format has no concept of a tag, use `'p'` for
prose and `'h1'..'h6'` for headings. Normalise exotic containers to `'p'`.

### 1.3 `id` and TOC headings

If a block is a heading you want navigable from the TOC, give it a unique `id`
(e.g. `'toc-0'`, `'toc-1'`, …) and set `isTocHeading: true`. The session's
synthetic-TOC builder (`formats/epub/toc.js` `buildSyntheticToc`) will turn flagged
headings into TOC entries with `href: section.href + '#' + id`. If your format has
its own real TOC, emit `ParsedBook.toc` directly (1.5) and you can skip flagging.

### 1.4 `frag` — rich inline content (optional but recommended)

For a faithful Reader/TTS experience, provide a `DocumentFragment` of sanitised
inline DOM per block (bold, italic, links, inline images). Rules:

- **Sanitise.** Only emit safe inline tags/attributes. Reuse the EPUB adapter's
  `sanitizeInline` helper pattern (`formats/epub/extractor.js`) and the allowlists
  in `js/core/constants.js` (`INLINE_TAGS`, `SAFE_ATTRS`).
- **Never consume it.** The same `ParsedBook.sections` is shared across all three
  modes and re-rendered on every mode switch; `renderSections`
  (`js/shared/render.js`) clones the frag each time. Hand over a reusable frag.
- **Bake image src onto the frag.** Resolve images during `parse()` to `blob:`
  URLs and set them on the `<img>` nodes inside the frag (see 1.6).
- If you can't produce rich inline DOM, omit `frag`; the renderer falls back to
  `block.text`. You lose inline styling but everything still works.

### 1.5 `TocEntry[]`

```js
{ label: string, href: string, depth: number }
```

- `href` is `'sectionHref'` or `'sectionHref#blockId'` and must resolve against
  the `section.href` / `block.id` values you emitted.
- `depth` 0 = top level.
- Return `[]` if you have no TOC; if you flagged `isTocHeading` blocks, the session
  will synthesise one for you.

### 1.6 Images / `blobUrls`

- Resolve embedded images during `parse()` into `blob:` object URLs.
- Push every URL you create into `ParsedBook.blobUrls`. The `BookSession` **owns**
  these and revokes them on `dispose()` — your adapter must **not** revoke them.
- Set the resolved URL as the `src` on the `<img>` inside the block's `frag`.
- See `formats/epub/images.js` for the EPUB approach (archive lookup with path
  fallbacks).

### 1.7 `title` / `metaTitle`

- `title` — the human-readable title (your best metadata, else the filename).
- `metaTitle` — the raw metadata title (may be `''`). Used by `deriveBookId` to
  produce a stable book id; if absent, the filename (sans extension) is used.

---

## 2. The adapter object

Create `js/formats/<yourformat>/<yourformat>-adapter.js` exporting a
`FormatAdapter` (typedef in `js/formats/types.js`):

```js
import { makeCapabilities } from '../capabilities.js';
import { magicBytes, startsWith } from '../detect.js';

export const pdfAdapter = {
  id: 'pdf',
  label: 'PDF',
  extensions: ['.pdf'],
  mimeTypes: ['application/pdf'],
  priority: 0,                 // higher = checked first in detection

  // Declare HONESTLY what this format supports. Modes/UI degrade based on this.
  capabilities: makeCapabilities({
    reflow:     false,         // a fixed-page PDF does not reflow into columns
    richText:   false,         // text layer only, limited inline structure
    textStream: true,          // pdf.js text layer → word stream (RSVP/TTS OK)
    images:     true,
    toc:        true,          // PDF outline if present
    search:     true,
    pageFidelity: true,        // can render original page images (future view)
  }),

  // Return true iff this adapter handles the bytes/name/mime.
  detect(bytes, fileName, mimeType) {
    // PDF magic: '%PDF' = [0x25,0x50,0x44,0x46]
    return startsWith(bytes, [0x25, 0x50, 0x44, 0x46])
        || fileName.endsWith('.pdf')
        || mimeType === 'application/pdf';
  },

  // Lazy-load the parsing library (see §4). EPUB's loadLibs is a no-op because
  // its libs are global; yours should dynamically import / inject pdf.js here.
  async loadLibs() {
    if (!window.pdfjsLib) {
      await import(/* the pdf.js module or a script injector */);
    }
  },

  // Bytes → IR. Throw a clear Error on failure.
  async parse(buffer, fileName, opts = {}) {
    const { onProgress } = opts;
    await this.loadLibs();
    // ... use the library to walk pages/outline ...
    // ... build sections[] of blocks[], resolve images → blobUrls ...
    // ... extract outline → toc[] ...
    if (/* no readable text */ false) {
      throw new Error('No readable text found in this PDF (it may be a scanned image).');
    }
    return { sections, toc, title, metaTitle, blobUrls, cover: null };
  },
};
```

### Register it

Add two lines to [`js/formats/index.js`](../js/formats/index.js):

```js
import { pdfAdapter } from './pdf/pdf-adapter.js';
registerAdapter(pdfAdapter);
```

That's it for wiring. Detection, the file-input `accept` string, the
"unsupported format" error list, and `deriveBookId` extension-stripping all read
from the registry automatically.

---

## 3. Capabilities: be honest

The capability flags are how Reader stays usable on imperfect formats **without
the modes hard-coding format knowledge**. Declare them truthfully:

| Capability | Set true when… | Consumers (now / future) |
|------------|----------------|--------------------------|
| `reflow` | text re-flows at any font size | Reader paginated mode |
| `richText` | inline structure/styling preserved | Reader/TTS fidelity |
| `textStream` | a clean word stream exists | **RSVP & TTS require this** |
| `images` | embedded images resolvable | Reader render |
| `toc` | real or synthesisable TOC | TOC drawer |
| `search` | full-text searchable | search panel |
| `pageFidelity` | can render the original page layout | future "page image" view |

> If `textStream:false` (e.g. a scanned, OCR-less PDF), RSVP and TTS cannot work
> for that book. The app should degrade gracefully (the mode switcher / library
> read `session.capabilities` to disable or annotate those modes). Do **not** fake
> `textStream:true` to silence a warning — it produces broken word positions.

---

## 4. Loading your parsing library

Each format brings its own heavy library. The target pattern is **lazy, per-format
loading** via `loadLibs()` so a user who only reads EPUBs never downloads pdf.js.

- Implement `loadLibs()` to dynamically `import()` an ES module, or inject a
  `<script>` for a UMD CDN build, then resolve once it's available.
- `parse()` must `await this.loadLibs()` before using the library.
- Add the library URL to the service-worker precache list in `sw.js` so it's
  available offline (do this when your format's phase lands).

> EPUB currently loads epub.js + jszip globally in `reader.html` for historical
> reasons; its `loadLibs()` just verifies `ePub` exists. New formats should prefer
> true lazy loading. EPUB can be migrated to the lazy pattern later without
> changing the interface.

---

## 5. Detection rules

`selectAdapter(buffer, fileName, mimeType)` (`js/formats/registry.js`) asks each
registered adapter's `detect()` in **priority order** (highest `priority` first)
and returns the first match.

- Prefer **magic bytes** over extension (files get renamed). Use the helpers in
  `js/formats/detect.js` (`magicBytes`, `startsWith`).
- Disambiguate shared containers. EPUB, some MOBI/AZW, and others are all ZIP/PDB
  containers — a magic match alone is ambiguous. Combine magic + extension/MIME,
  and use `priority` so the more specific adapter wins.
- `detect()` must be **fast and side-effect-free** and must not throw (the
  registry guards against throws, but don't rely on it).

---

## 6. Testing your adapter

1. **Self-tests** (`js/test/selftest.js`, run via `reader.html?selftest=1`):
   - Add an assertion that your adapter is registered (`getAdapterById('pdf')`).
   - Add a `detect()` unit assertion (magic bytes + extension).
   - Add a capability sanity assertion.
   - Keep selftest **side-effect-free and fast** — do NOT parse a real multi-MB
     file in the suite.
2. **Manual matrix** — open several real files of your format and verify, at
   minimum: Reader render, TOC navigation, **position persists across reload**,
   **mode switch keeps the same position** (Reader→RSVP→TTS), search, bookmarks.
   This catches word-count/position drift (the #1 bug class).
3. **Capability degradation** — open a deliberately limited file (e.g. a scanned
   PDF) and confirm the app degrades cleanly rather than crashing.

---

## 7. Common pitfalls

- **Word-count drift.** `block.text` words ≠ rendered `frag` words → positions
  drift. Keep them identical. Test by switching modes and checking you land on the
  same word.
- **Unstable `section.href`.** Random/changing hrefs break saved positions and
  bookmarks on re-open. Make them deterministic.
- **Revoking blob URLs in the adapter.** Don't — the `BookSession` owns them.
- **Consuming a `frag`.** It's cloned per render across three modes; emit a
  reusable fragment, never one you mutate/append elsewhere.
- **Lying in capabilities.** Faking `textStream` produces a silently broken RSVP/TTS.
- **Heavy work in `detect()`.** Keep it to magic bytes + name; do the parse in
  `parse()`.

---

## 8. Checklist for a new format

- [ ] `js/formats/<fmt>/<fmt>-adapter.js` exports a `FormatAdapter`.
- [ ] `parse()` returns a valid `ParsedBook` (sections, toc, title, blobUrls, metaTitle).
- [ ] `block.text` word counts match rendered output exactly.
- [ ] `section.href` values are stable & unique.
- [ ] Images resolved to blob URLs, pushed to `blobUrls`, baked onto frags.
- [ ] `capabilities` declared honestly.
- [ ] `detect()` uses magic bytes, is fast, doesn't throw.
- [ ] `loadLibs()` lazy-loads the parsing library; lib added to `sw.js` precache.
- [ ] Registered in `js/formats/index.js`.
- [ ] Self-tests added (registration, detect, capabilities).
- [ ] Manual matrix passes, incl. position persistence + mode-switch handoff.
- [ ] Docs updated (`MODULES.md` entry for the new adapter; this checklist re-read).
```
