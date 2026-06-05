# File-Format Abstraction — Master Plan

> **Status:** Planning. Phase 0 is specified in detail in
> [`phase-0-format-groundwork.md`](./phase-0-format-groundwork.md). Later phases
> (PDF, MOBI, AZW/iBook, LIT, …) are sketched here and will get their own
> detailed plans when reached.
>
> **Scope of this document:** the *why*, the target architecture, the canonical
> data contract every format must produce, the capability model, and the phase
> roadmap. It is the map; Phase 0 is the first leg.

---

## 1. Goal

Today Reader is an EPUB reader. The three reading modes (Reader, RSVP, TTS) all
work, but the parsing pipeline is hard-wired to EPUB. We want to support **PDF
and beyond** (MOBI, AZW3/iBook, LIT, plain text, …) while keeping **one unified
reading experience**: the same modes, the same position system, the same
bookmarks, the same chrome — regardless of the file the user opened.

We accept that feature parity across formats is impossible (a scanned PDF cannot
reflow into two columns; an image-only book cannot be spoken by TTS). The goal is
**graceful, format-aware degradation**, not identical behaviour. A user who opens
a PDF should get the best experience that format can offer, and the app should
clearly communicate what is and isn't available — never crash, never silently do
the wrong thing.

---

## 2. Why this is achievable cheaply (current-state analysis)

The codebase is already 90 % of the way to format-agnostic. The expensive,
EPUB-specific work is concentrated in exactly one place, and everything
downstream already speaks a neutral data shape.

### 2.1 The one EPUB-coupled chokepoint

`BookSession.fromBuffer(buffer, fileName, urlId, onProgress)`
(`js/core/book-session.js:48`) is the *only* function that knows it is parsing an
EPUB. It:

- calls the global `ePub()` (epub.js, loaded via CDN in `reader.html:13`),
- reads `book.spine`, `book.archive`, `book.packaging`, `book.navigation`,
- delegates to the EPUB-specific helpers in `js/epub/`:
  - `extractSections(book)` — `js/epub/extractor.js:130`
  - `resolveImageUrls(allImgUrls, book)` — `js/epub/images.js:63`
  - `flattenToc(nav.toc)` / `buildSyntheticToc(sections)` — `js/epub/toc.js`

Then it returns a plain-JS `BookSession`.

### 2.2 Everything downstream is already format-neutral

Once `BookSession` exists, **nothing else touches EPUB APIs**. These consumers
read only the neutral shape (`sections`, `toc`, `bookId`, `title`, `blobUrls`):

| Consumer | File | Reads |
|----------|------|-------|
| Reader render | `js/shared/render.js:11` `renderSections` | `sections[].blocks[]` |
| Reader doc-model | `js/model/doc-model.js` | rendered `.chap`/`.blk` DOM |
| RSVP text stream | `js/rsvp-app.js:32` `sectionsToText` | `sections[].blocks[]` |
| TTS sentence segmentation | `js/tts-app.js:321` `segmentContent` | rendered DOM |
| TOC drawer | `js/epub/toc.js:34` `buildTOC` | `toc[]` |
| Position / handoff | `js/core/position.js` | `sections`, word counts |
| Mode switch / cache | `js/mode-switcher.js:39` | the `session` object |

> **Implication:** to add a format we do **not** touch render, doc-model,
> position, RSVP, TTS, search, bookmarks, or the mode switcher. We only need a
> new thing that produces the same `BookSession` shape from different bytes.

### 2.3 The few places with literal `.epub` assumptions (must be fixed in Phase 0)

These are the only hard-coded EPUB leaks outside the chokepoint:

- `js/core/position.js:76` — `deriveBookId` strips `.epub$` from the filename.
  A PDF named `book.pdf` would keep `.pdf` in its id → must become extension-aware.
- `reader.html:25` — `<input accept=".epub,application/epub+zip">` → must be
  driven by the registry of supported formats.
- `reader.html:12-13` — epub.js + jszip CDN `<script>` tags load globally and
  unconditionally. Acceptable for Phase 0 (EPUB stays the only format), but the
  target pattern is **per-adapter lazy library loading** (see §5.4).
- Fallback filenames `"book.epub"` in `loadFromUrl` (`reader-app.js:685`,
  `rsvp-app.js:692`, `tts-app.js:827`) — cosmetic; tracked but low priority.

---

## 3. Target architecture

```
                       bytes + fileName
                              │
                              ▼
                   ┌────────────────────┐
                   │  formats/detect.js  │  sniff magic bytes + extension + MIME
                   └─────────┬──────────┘
                             │  formatId ('epub' | 'pdf' | …)
                             ▼
                   ┌────────────────────┐
                   │ formats/registry.js │  formatId → FormatAdapter
                   └─────────┬──────────┘
                             │  adapter
                             ▼
        ┌────────────────────────────────────────────┐
        │            FormatAdapter.parse()            │   format-SPECIFIC
        │  e.g. formats/epub/epub-adapter.js          │
        │   - load format lib (epub.js / pdf.js / …)  │
        │   - walk structure → Section[] / Block[]    │
        │   - resolve images → blobUrls               │
        │   - build toc → TocEntry[]                  │
        │   - derive title                            │
        └─────────────────────┬──────────────────────┘
                              │  ParsedBook  (the canonical IR)
                              ▼
                   ┌────────────────────┐
                   │ core/book-session  │  wraps IR + bookId + capabilities
                   └─────────┬──────────┘
                             │  BookSession  (format-NEUTRAL from here down)
                             ▼
        renderSections · doc-model · RSVP · TTS · position · toc · search …
                       (UNCHANGED — already format-agnostic)
```

`BookSession.fromBuffer` stops *being* the EPUB parser and becomes a thin
**dispatcher**: detect → select adapter → `adapter.parse()` → wrap the result.

---

## 4. The canonical Intermediate Representation (IR)

This is the contract. **Every format adapter must produce exactly this shape.**
It is not new — it is the shape the code already uses today, written down so it
can be a stable interface. (Exact field semantics live in the authoring guide,
[`docs/ADDING-A-FORMAT.md`](../docs/ADDING-A-FORMAT.md).)

### 4.1 `Block`

One structural unit of content (paragraph, heading, figure, table, list item…).

```js
{
  type: string,           // 'p' | 'h1'..'h6' | 'figure' | 'table-wrap' | 'pre'
                          //   | 'li' | 'blockquote' | … (a tag-ish name; div/dd/dt
                          //   are normalised to 'p' by the EPUB adapter today)
  text: string,           // collapsed plain text — the WORD-COUNT ANCHOR. RSVP,
                          //   TTS and the doc-model all count words from this via
                          //   countWords(). For a figure this is the caption text
                          //   (or '' for an image-only figure).
  id: string,             // anchor id for TOC fragment hrefs ('' if none). The
                          //   adapter assigns synthetic 'toc-N' ids to heading-like
                          //   blocks that lack one (see extractor.js idSeed).
  frag?: DocumentFragment,// OPTIONAL rich inline DOM for Reader/TTS. Cloned on
                          //   every render (shared across modes — never consumed).
                          //   Resolved image src is baked onto <img> nodes here.
  isTocHeading?: boolean  // true if this block is a heading the synthetic-TOC
                          //   builder should turn into an entry.
}
```

### 4.2 `Section`

One spine item / chapter file.

```js
{
  href: string,           // stable section key: basename, NO path, NO #fragment
                          //   (e.g. 'chapter1.xhtml'). Used as the .chap data-href
                          //   and as the position anchor across modes.
  blocks: Block[]
}
```

### 4.3 `TocEntry`

```js
{
  label: string,          // display text
  href: string,           // 'sectionHref' or 'sectionHref#blockId'
  depth: number           // nesting depth, 0 = top level
}
```

### 4.4 `ParsedBook` (what an adapter's `parse()` returns)

```js
{
  sections: Section[],    // required, non-empty, ≥32 chars of text total
  toc: TocEntry[],        // may be []; book-session synthesises one if empty
  title: string,          // human title (adapter's best metadata, else fileName)
  blobUrls: string[],     // object URLs the adapter created (owned by the session,
                          //   revoked on dispose()). Baked onto block frags.
  metaTitle?: string,     // raw metadata title for bookId derivation (may differ
                          //   from `title`); '' if unknown
  cover?: string | null,  // optional cover blob URL (future: library thumbnails)
}
```

### 4.5 `BookSession` (unchanged public shape)

`book-session.js` wraps a `ParsedBook` plus the derived `bookId`, the original
`buffer`, and **two new fields** (Phase 0):

```js
{
  sections, toc, bookId, fileName, title, buffer, blobUrls, isSample,  // existing
  format: string,         // NEW: the formatId that produced this ('epub', …)
  capabilities: Capabilities, // NEW: see §5
}
```

Adding fields is backward-compatible — every existing consumer ignores unknown
fields.

---

## 5. The capability model

Different formats can do different things. A `Capabilities` object lets modes and
UI degrade gracefully **without knowing which format they're looking at**.

### 5.1 Capability keys (Phase 0 establishes the vocabulary)

```js
Capabilities = {
  reflow:         boolean, // text reflows into columns at any font size (EPUB: true,
                           //   scanned PDF: false). Reader paginated mode needs this.
  richText:       boolean, // inline structure / styling preserved (block frags present)
  textStream:     boolean, // a clean word stream can be extracted (RSVP & TTS need this)
  images:         boolean, // embedded images resolvable
  toc:            boolean, // a real or synthesisable table of contents
  search:         boolean, // full-text search supported
  pageFidelity:   boolean, // can render the original fixed page layout (PDF: true,
                           //   EPUB: false). Drives a future "page image" view.
}
```

### 5.2 EPUB capabilities (Phase 0 value)

EPUB supports everything except fixed-page fidelity:

```js
{ reflow:true, richText:true, textStream:true, images:true, toc:true, search:true, pageFidelity:false }
```

### 5.3 How modes use it (Phase 0: plumb only; later: enforce)

- **Phase 0:** `BookSession` carries `capabilities`; modes may read it but
  behaviour is unchanged (EPUB supports all the relevant caps anyway). This proves
  the wiring without risk.
- **Later phases:** the mode switcher / library consult `capabilities` to disable
  or annotate modes a format can't serve (e.g. grey out RSVP for a textStream:false
  scanned PDF, show a "best viewed in Reader" hint), and Reader can offer a
  page-fidelity view when `pageFidelity:true`.

### 5.4 Library loading per adapter (target pattern)

Each format's heavy parsing library should load **only when that format is opened**:

- EPUB: epub.js + jszip
- PDF: pdf.js
- MOBI/AZW: a mobi parser, etc.

An adapter declares its libs and a `loadLibs()` hook. In Phase 0 the EPUB libs
stay in `reader.html` (global) to minimise risk, but the adapter interface
includes the `loadLibs()` seam so later formats can lazy-load and so EPUB can be
migrated to lazy loading later without an interface change.

---

## 6. Phase roadmap

| Phase | Deliverable | State after |
|-------|-------------|-------------|
| **0 — Groundwork** *(this effort)* | Extract the format-adapter interface, registry, detection; move EPUB behind it; capabilities + format-aware bookId; authoring guide. **No new format yet.** | EPUB is one adapter among a (size-1) registry. Adding a format is a documented, isolated task. |
| **1 — PDF (text)** ✅ *landed* | `formats/pdf/` adapter using pdf.js text layer → IR (line grouping, indent/gap paragraph detection, "Chapter N" heading → sections + TOC). Reader/RSVP/TTS work on text-based PDFs. Validated on the Babylon 5 PDFs in `books/`. | Two formats. Capability gating becomes load-bearing. |
| **2 — PDF (page fidelity)** | Optional fixed-page render view for PDFs (`pageFidelity`), Reader gains a page-image presentation. | PDFs that don't reflow still usable. |
| **3 — MOBI / AZW3** | `formats/mobi/` adapter (PalmDOC/KF8 parsing) → IR. | Kindle formats. |
| **4 — iBook / LIT / others** | Additional adapters as demand dictates. | Long tail. |
| **5 — Plain text / Markdown** | Trivial adapter; good smoke test of the interface. | — |

Each later phase is "write one adapter + register it + declare capabilities,"
following [`docs/ADDING-A-FORMAT.md`](../docs/ADDING-A-FORMAT.md). If a later
phase needs IR changes, that's a signal the IR was under-specified — amend §4 and
the authoring guide together.

---

## 7. Cross-cutting concerns

- **Position stability across formats.** The canonical position is
  `section href + word ordinal` (`js/core/position.js`). Every adapter must
  produce stable `section.href` keys and `block.text` whose `countWords()` is
  deterministic, or cross-mode handoff and saved positions drift. This is the
  single most important invariant for the "unified experience."
- **bookId stability.** `deriveBookId` must strip the *opened* file's extension,
  not hard-code `.epub`, so the same book keeps one id. (Phase 0 task.)
- **Error handling.** Detection failure or an unsupported format must surface a
  clear, format-named error ("Reader can't open .pdf files yet") — never a stack
  trace. Adapters throw typed errors; `BookSession.fromBuffer` maps them to
  user-facing messages.
- **Sample book.** `BookSession.fromSample` (`book-session.js:93`) stays as-is; it
  is format-less by definition and gets `format:'sample'`, full capabilities.
- **Service worker / offline.** New format libs added to the precache list in
  `sw.js` when their phase lands (not Phase 0).

---

## 8. What Phase 0 explicitly does NOT do

- Does not add PDF or any new format.
- Does not change Reader/RSVP/TTS behaviour, rendering, or position math.
- Does not lazy-load epub.js (keeps it global; only adds the seam).
- Does not redesign the library/bookshelf.

See [`phase-0-format-groundwork.md`](./phase-0-format-groundwork.md) for the
step-by-step implementation.
