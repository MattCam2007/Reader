# Phase 0 — Format Abstraction Groundwork (Implementation Plan)

> **Read first:** [`file-format-abstraction.md`](./file-format-abstraction.md)
> (the why, the IR, the capability model). This document is the *how* — a precise,
> ordered checklist to implement Phase 0.
>
> **Audience:** an implementer (human or AI) who will follow these steps literally.
> Every task lists the exact files, signatures, what moves where, and an
> acceptance check. Do the tasks **in order** — later tasks depend on earlier ones.

---

## 0. Definition of Done

At the end of Phase 0:

1. There is a **format-adapter interface** and a **registry**. EPUB is registered
   as one adapter; it is still the *only* supported format.
2. `BookSession.fromBuffer` no longer contains EPUB-specific code — it **detects
   the format, selects an adapter, calls `adapter.parse()`, and wraps the result**.
3. All EPUB-specific code lives under `js/formats/epub/`.
4. `BookSession` carries `format` and `capabilities` fields.
5. `deriveBookId` strips the *opened* file's extension (not hard-coded `.epub`).
6. The file `<input accept>` and the "unsupported file" error message are driven
   by the registry, not hard-coded.
7. The self-test suite covers the registry, detection, and the adapter contract.
8. [`docs/ADDING-A-FORMAT.md`](../docs/ADDING-A-FORMAT.md) accurately describes how
   to add the next format, matching the code that now exists.
9. **No behaviour change for the user.** Every existing `.epub` opens, reads,
   speed-reads, speaks, bookmarks, and restores position exactly as before.

### Non-goals (do NOT do these in Phase 0)

- No PDF / MOBI / any new format.
- No change to render, doc-model, pagination, RSVP, TTS, position math, search.
- No lazy-loading of epub.js (keep the CDN tags in `reader.html`).
- No library/bookshelf redesign.

---

## 1. Target file layout

Create a new top-level `js/formats/` tree and relocate the EPUB code into it.

```
js/formats/
├── types.js            NEW  JSDoc typedefs for the IR (Block, Section, TocEntry,
│                            ParsedBook, Capabilities, FormatAdapter). No runtime code.
├── capabilities.js     NEW  Capability key constants + helpers (makeCapabilities,
│                            FULL_CAPABILITIES, NO_CAPABILITIES).
├── detect.js           NEW  detectFormat(buffer, fileName, mimeType) → formatId|null
├── registry.js         NEW  register()/getAdapter()/listAdapters()/acceptString()
├── index.js            NEW  Imports each adapter module so it self-registers; the
│                            single import the rest of the app uses to "have formats".
└── epub/
    ├── epub-adapter.js NEW  The FormatAdapter for EPUB. Owns ePub(), the parse
    │                        pipeline, image resolution, toc — i.e. the body that
    │                        currently lives in BookSession.fromBuffer.
    ├── extractor.js    MOVED from js/epub/extractor.js (unchanged logic)
    ├── images.js       MOVED from js/epub/images.js (unchanged logic)
    └── toc.js          MOVED from js/epub/toc.js (unchanged logic)
```

After the move, **delete the old `js/epub/` directory**. Update every importer
(see Task 7 for the exact list).

---

## 2. Task list (do in order)

### Task 1 — Write the IR typedefs (`js/formats/types.js`)

Create a pure-JSDoc module (no executable code) describing the IR from
[`file-format-abstraction.md` §4](./file-format-abstraction.md#4-the-canonical-intermediate-representation-ir).
This is documentation that DevTools and editors can use; it also gives later tasks
a single place to point at.

Include `@typedef` blocks for `Block`, `Section`, `TocEntry`, `Capabilities`,
`ParsedBook`, and `FormatAdapter`. Mirror the field semantics exactly as written
in the master plan and the authoring guide. Export nothing (or export an empty
object) — it exists for the typedefs.

**Acceptance:** file exists; `import './types.js'` is side-effect-free.

---

### Task 2 — Capability constants (`js/formats/capabilities.js`)

```js
// The complete set of capability keys (see file-format-abstraction.md §5).
export const CAPABILITY_KEYS = [
  'reflow', 'richText', 'textStream', 'images', 'toc', 'search', 'pageFidelity',
];

// Build a capabilities object, defaulting any unspecified key to false.
export function makeCapabilities(overrides = {}) {
  const caps = {};
  for (const k of CAPABILITY_KEYS) caps[k] = !!overrides[k];
  return caps;
}

// Convenience presets.
export const FULL_CAPABILITIES = makeCapabilities({
  reflow:true, richText:true, textStream:true, images:true, toc:true, search:true, pageFidelity:true,
});
export const NO_CAPABILITIES = makeCapabilities();
```

**Acceptance:** `makeCapabilities({reflow:true}).search === false` and `.reflow === true`.

---

### Task 3 — Format detection (`js/formats/detect.js`)

Detection is **magic-bytes first, extension second, MIME third**. It must not
depend on any adapter (no circular import) — adapters *declare* their detection
hints, and the registry passes them in, OR detection is a standalone function the
registry calls. Use the **registry-driven** approach: `detect.js` exposes a pure
matcher; `registry.js` owns the list of registered signatures.

`detect.js`:

```js
// Read the first N bytes of an ArrayBuffer as a Uint8Array (safe for small files).
export function magicBytes(buffer, n = 64) {
  return new Uint8Array(buffer.slice(0, n));
}

// Does the byte array start with the given signature (array of byte values)?
export function startsWith(bytes, sig) {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false;
  return true;
}

// ZIP-based containers (EPUB, future: some others) start with 'PK\x03\x04'.
export const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
```

EPUB detection nuance (document this in the EPUB adapter, not here):
- EPUB is a ZIP (`PK\x03\x04`). A bare ZIP magic match is *necessary but not
  sufficient* — other formats are also ZIPs. The EPUB adapter's `detect` should
  match ZIP magic **and** the `.epub` extension / `application/epub+zip` MIME.
  (A fuller check — looking for `mimetype` = `application/epub+zip` as the first
  archive entry — is a nice-to-have; the extension check is sufficient for Phase 0
  since EPUB is the only ZIP format registered.)

The registry will call each adapter's `detect(...)` in priority order (see Task 4).

**Acceptance:** `startsWith(new Uint8Array([0x50,0x4b,0x03,0x04,0x00]), ZIP_MAGIC) === true`.

---

### Task 4 — The adapter interface + registry (`js/formats/registry.js`)

Define the **FormatAdapter** shape (documented in `types.js`) and a registry.

A `FormatAdapter` is a plain object:

```js
{
  id: 'epub',                       // unique formatId
  label: 'EPUB',                    // human name (for errors/UI)
  extensions: ['.epub'],            // lowercased, dot-prefixed
  mimeTypes: ['application/epub+zip'],
  capabilities: Capabilities,       // what this format supports (Task 2)
  priority: number,                 // higher = checked first by detect (default 0)

  // Return true if THIS adapter handles the given bytes/name/mime.
  detect(bytes /*Uint8Array*/, fileName /*string*/, mimeType /*string*/): boolean,

  // OPTIONAL: ensure the format's parsing library is available. Phase 0 EPUB
  // returns immediately (libs are global via reader.html). Later formats await
  // a dynamic import / script injection here.
  loadLibs?(): Promise<void>,

  // Parse bytes into the canonical IR. THROW a clear Error on failure.
  parse(buffer /*ArrayBuffer*/, fileName /*string*/, opts /*{ onProgress }*/): Promise<ParsedBook>,
}
```

`registry.js`:

```js
import { magicBytes } from './detect.js';

const _adapters = [];

export function registerAdapter(adapter) {
  // Basic shape guard — fail loudly during development.
  if (!adapter || !adapter.id || typeof adapter.parse !== 'function') {
    throw new Error('Invalid format adapter');
  }
  _adapters.push(adapter);
  _adapters.sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

export function listAdapters() { return _adapters.slice(); }

export function getAdapterById(id) { return _adapters.find(a => a.id === id) || null; }

// Choose the adapter for a file. Returns the adapter or null if unsupported.
export function selectAdapter(buffer, fileName, mimeType = '') {
  const bytes = magicBytes(buffer);
  const name = (fileName || '').toLowerCase();
  for (const a of _adapters) {
    try {
      if (a.detect(bytes, name, mimeType)) return a;
    } catch (_) { /* a bad detect() must not break others */ }
  }
  return null;
}

// Build the <input accept> string and a human list from registered formats.
export function acceptString() {
  const parts = [];
  for (const a of _adapters) {
    a.extensions.forEach(e => parts.push(e));
    a.mimeTypes.forEach(m => parts.push(m));
  }
  return [...new Set(parts)].join(',');
}

export function supportedLabels() {
  return _adapters.map(a => a.label);
}
```

**Acceptance:** with the EPUB adapter registered (Task 5),
`selectAdapter(epubBuffer, 'x.epub')` returns the EPUB adapter; `selectAdapter(pdfBytes, 'x.pdf')`
returns `null`; `acceptString()` contains `.epub`.

---

### Task 5 — Move EPUB behind an adapter

This is the heart of Phase 0. It is a **mechanical relocation**, not a rewrite —
the EPUB parsing logic must stay byte-for-byte equivalent.

**5a. Move the three EPUB modules** (no logic change):
- `js/epub/extractor.js` → `js/formats/epub/extractor.js`
- `js/epub/images.js`    → `js/formats/epub/images.js`
- `js/epub/toc.js`       → `js/formats/epub/toc.js`

Fix their *internal* relative imports: `extractor.js` imports
`../core/constants.js` → becomes `../../core/constants.js` (one level deeper now).
Check each moved file's imports and adjust the `../` depth. (`images.js` and
`toc.js` have no cross-dir imports today — verify.)

**5b. Create `js/formats/epub/epub-adapter.js`.** Move the *body* of the current
`BookSession.fromBuffer` (`book-session.js:48-89`) here as `parse()`. Specifically:

```js
import { extractSections } from './extractor.js';
import { resolveImageUrls } from './images.js';
import { flattenToc, buildSyntheticToc } from './toc.js';
import { makeCapabilities } from '../capabilities.js';
import { startsWith, ZIP_MAGIC } from '../detect.js';
import * as perf from '../../core/perf.js';

export const epubAdapter = {
  id: 'epub',
  label: 'EPUB',
  extensions: ['.epub'],
  mimeTypes: ['application/epub+zip'],
  priority: 0,
  capabilities: makeCapabilities({
    reflow:true, richText:true, textStream:true, images:true, toc:true, search:true,
    pageFidelity:false,
  }),

  detect(bytes, fileName, mimeType) {
    // EPUB is a ZIP; disambiguate from other ZIPs by extension/MIME.
    const isZip = startsWith(bytes, ZIP_MAGIC);
    const byName = fileName.endsWith('.epub');
    const byMime = mimeType === 'application/epub+zip';
    return (isZip && (byName || byMime)) || byName;
  },

  async loadLibs() {
    // Phase 0: epub.js + jszip are loaded globally by reader.html. Just verify.
    if (typeof ePub !== 'function') {
      throw new Error('EPUB library failed to load. Check your connection.');
    }
  },

  async parse(buffer, fileName, opts = {}) {
    const onProgress = opts.onProgress;
    await this.loadLibs();
    const book = ePub(buffer);
    await book.ready;

    let toc = [];
    try {
      const nav = await book.loaded.navigation;
      toc = flattenToc(nav && nav.toc, 0, []);
    } catch (e) { console.warn('epub:toc', e); }

    const { sections, allImgUrls } = await perf.timeAsync('session:extract', () =>
      extractSections(book, onProgress));

    const chars = sections.reduce((n, s) =>
      n + s.blocks.reduce((m, b) => m + b.text.length, 0), 0);
    if (chars < 32) {
      try { book.destroy && book.destroy(); } catch (_) {}
      throw new Error('No readable text found (this EPUB may be image-only or DRM-protected).');
    }

    if (!toc.length && sections.length > 1) toc = buildSyntheticToc(sections);

    const blobUrls = allImgUrls.length
      ? await perf.timeAsync('session:images', () => resolveImageUrls(allImgUrls, book))
      : [];

    const meta = (book.packaging && book.packaging.metadata) || {};
    const title = (meta.title || fileName).trim();
    const metaTitle = meta.title || '';

    try { book.destroy && book.destroy(); } catch (e) { console.warn('epub:destroy', e); }

    // Return the canonical IR. NOTE: bookId is derived by book-session, not here.
    return { sections, toc, title, metaTitle, blobUrls, cover: null };
  },
};
```

> **Behaviour-preservation note:** the EPUB-specific `< 32 chars` guard and the
> synthetic-TOC fallback move *with* the EPUB logic into the adapter. They are
> EPUB policies, not session policies. The `book.destroy()` calls move too.

**5c. Create `js/formats/index.js`** — the self-registration barrel:

```js
import { registerAdapter } from './registry.js';
import { epubAdapter } from './epub/epub-adapter.js';

registerAdapter(epubAdapter);
// Future formats register here:
// import { pdfAdapter } from './pdf/pdf-adapter.js'; registerAdapter(pdfAdapter);
```

**Acceptance:** `js/formats/epub/` contains the four files; old `js/epub/` is gone;
importing `js/formats/index.js` registers exactly one adapter.

---

### Task 6 — Refactor `BookSession.fromBuffer` into a dispatcher

Rewrite `js/core/book-session.js`'s `fromBuffer` to use the registry. It keeps the
same public signature and return type (a `BookSession`), so **no caller changes**.

```js
import { deriveBookId } from './position.js';
import { selectAdapter, supportedLabels } from '../formats/registry.js';
import { makeCapabilities, FULL_CAPABILITIES } from '../formats/capabilities.js';
import '../formats/index.js'; // ensure adapters are registered (side-effect import)

// ...splitWords / countWords unchanged...

export class BookSession {
  constructor(data) {
    // ...existing fields...
    this.format = data.format || '';
    this.capabilities = data.capabilities || makeCapabilities();
  }

  static async fromBuffer(buffer, fileName, urlId, onProgress) {
    const adapter = selectAdapter(buffer, fileName);
    if (!adapter) {
      const ext = (fileName.split('.').pop() || '').toLowerCase();
      throw new Error(
        `Reader can't open .${ext} files yet. Supported formats: ${supportedLabels().join(', ')}.`
      );
    }
    const parsed = await adapter.parse(buffer, fileName, { onProgress });
    const bookId = deriveBookId(urlId, parsed.metaTitle, fileName);
    return new BookSession({
      sections: parsed.sections,
      toc: parsed.toc,
      title: parsed.title,
      blobUrls: parsed.blobUrls,
      bookId, fileName, buffer,
      format: adapter.id,
      capabilities: adapter.capabilities,
    });
  }

  static fromSample(sections, bookId, title) {
    return new BookSession({
      sections, toc: [], bookId, title, isSample: true,
      format: 'sample', capabilities: FULL_CAPABILITIES,
    });
  }

  // dispose() unchanged.
}
```

> Drop the now-dead `allImgUrls` field from `BookSession` (it was only used during
> the EPUB build and is internal to the adapter now). Verify nothing reads
> `session.allImgUrls` — grep confirms only `book-session.js` and docs mention it.

**Acceptance:** opening an `.epub` produces a `BookSession` with
`format === 'epub'` and `capabilities.reflow === true`; opening an unsupported
extension throws the friendly "can't open .pdf files yet" error.

---

### Task 7 — Update all importers of the old `js/epub/` paths

Search-and-replace the import paths. The current importers of `js/epub/*` are:

| File | Old import | New import |
|------|-----------|-----------|
| `js/core/book-session.js` | `../epub/extractor.js`, `../epub/images.js`, `../epub/toc.js` | now imported by the adapter, not the session — **remove** these three imports from book-session |
| `js/reader-app.js` | `resolveHref`, `buildTOC` from `./epub/toc.js` | `./formats/epub/toc.js` |
| `js/rsvp-app.js` | `flattenToc`/toc helpers from `./epub/toc.js` (verify) | `./formats/epub/toc.js` |
| `js/tts-app.js` | toc helpers from `./epub/toc.js` (verify) | `./formats/epub/toc.js` |
| `js/test/selftest.js` | any `../epub/*` imports | `../formats/epub/*` |

**Action:** grep the repo for `epub/extractor`, `epub/images`, `epub/toc`,
`'./epub`, `'../epub` and update every hit. (`toc.js` exports `buildTOC`,
`resolveHref`, `flattenToc`, `buildSyntheticToc` — these are consumed by the mode
apps for the *rendered* TOC drawer; they are not EPUB-format-specific in behaviour
but they physically live in the epub folder. For Phase 0, leave them in
`formats/epub/toc.js` and just fix the import paths. A later cleanup can promote
the truly format-neutral toc-drawer helpers to `js/shared/` — out of scope here.)

> **Decision to record:** `buildTOC`/`resolveHref` operate on the *rendered DOM*
> and the neutral `toc[]`, so they are not EPUB-specific. Moving them out of
> `formats/epub/` is desirable but is a **follow-up**, not Phase 0, to keep the
> diff mechanical. Document this in the authoring guide as a known wrinkle.

**Acceptance:** no file imports from `js/epub/`; the app boots; selftest passes.

---

### Task 8 — Make bookId extension-aware (`js/core/position.js`)

`deriveBookId` (`position.js:70-77`) currently does:

```js
const name = (fileName || '').replace(/\.epub$/i, '').trim();
```

Make it strip any registered extension (or any single trailing extension):

```js
import { listAdapters } from '../formats/registry.js';
// ...
const exts = listAdapters().flatMap(a => a.extensions); // ['.epub', ...]
let name = (fileName || '').trim();
for (const e of exts) {
  if (name.toLowerCase().endsWith(e)) { name = name.slice(0, -e.length).trim(); break; }
}
```

> **Caution — circular import:** `position.js` is imported by `book-session.js`
> which imports `formats/index.js` which imports adapters which import
> `capabilities.js` (no cycle back to position). `position.js` importing
> `registry.js` is fine (registry imports only `detect.js`). **Verify there is no
> import cycle** `position → registry → … → position`. If a cycle appears, fall
> back to a simpler rule: strip the last `.<ext>` only if it's ≤5 chars and
> alphabetic — no registry import needed. Prefer the registry approach if clean.

**Acceptance:** `deriveBookId('', '', 'My Book.epub') === 'My Book'` still holds
(selftest `position` cases at `selftest.js:97-99`); add a `.pdf` case that also
strips correctly once a second extension exists (for now assert `.epub` behaviour
is unchanged).

---

### Task 9 — Drive the file input + errors from the registry

**9a. `reader.html:25`** currently hard-codes
`accept=".epub,application/epub+zip"`. Two options:
- *Simplest (Phase 0):* leave the static `accept` as-is (it already equals the
  registry output for a single EPUB adapter) **but add a code comment** pointing to
  `acceptString()` as the source of truth for future formats; **or**
- *Better:* in `mode-switcher.js` boot (or each app's file-input setup), set
  `fileInput.setAttribute('accept', acceptString())` after `formats/index.js` is
  imported, so it auto-updates as formats register.

Pick the *Better* option if it doesn't complicate boot; otherwise the comment is
acceptable for Phase 0.

**9b. Friendly unsupported-format error.** The throw in Task 6 already produces
the message; ensure the three `loadEpub`/`loadFromSession` catch blocks
(`reader-app.js:626`, `rsvp-app.js:630`, `tts-app.js`) surface `err.message`
verbatim (they already do — `showError(err.message)`). No change needed beyond
verifying. Optionally rename `loadEpub` → `loadFile` for honesty; **out of scope**
for Phase 0 to keep the diff small (note it as a follow-up).

**Acceptance:** the file picker still accepts `.epub`; dropping/opening a `.pdf`
shows "Reader can't open .pdf files yet. Supported formats: EPUB."

---

### Task 10 — Self-tests (`js/test/selftest.js`)

Add a new test group `formats` exercising the new seams (the suite is a simple
`assert(group, name, bool)` reporter — follow the existing pattern at
`selftest.js`):

- `detect.startsWith` / `ZIP_MAGIC` matches a `PK\x03\x04` byte array.
- `makeCapabilities` defaults unspecified keys to false; presets correct.
- `registry`: after importing `formats/index.js`, `listAdapters().length >= 1`;
  `getAdapterById('epub')` is non-null; `selectAdapter(zipBytesNamedEpub)` returns it;
  `selectAdapter(bytesNamedPdf)` returns null; `acceptString()` includes `.epub`.
- `epubAdapter.capabilities` has `reflow:true, pageFidelity:false`.
- `deriveBookId` still strips `.epub` (keep existing cases).
- **Adapter contract probe (cheap):** assert `epubAdapter` has the required keys
  (`id`, `parse` function, `detect` function, `extensions` array, `capabilities`).

Do **not** add a heavy "parse a real epub in the test" case — selftest must stay
side-effect-free and fast. The existing `extractor`/`render` tests already cover
the parsing internals; they just import from the new path now.

**Acceptance:** `reader.html?selftest=1` shows all groups green, including the new
`formats` group.

---

### Task 11 — Documentation

1. **Write [`docs/ADDING-A-FORMAT.md`](../docs/ADDING-A-FORMAT.md)** — the authoring
   guide. (A complete draft is delivered alongside this plan; Task 11's job is to
   reconcile it with the code that actually landed — fix any signature drift.)
2. **Update `docs/ARCHITECTURE.md`:**
   - Replace the "EPUB Processing Pipeline" section's framing: the pipeline now
     lives behind a `FormatAdapter`; `BookSession.fromBuffer` is a dispatcher.
   - Update the directory tree (`js/epub/` → `js/formats/…`).
   - Add a short "Format Adapters" subsection pointing to `ADDING-A-FORMAT.md`.
3. **Update `docs/MODULES.md`:**
   - Move the `js/epub/*` entries under a new `js/formats/epub/*` heading.
   - Add entries for `formats/types.js`, `capabilities.js`, `detect.js`,
     `registry.js`, `index.js`, `epub/epub-adapter.js`.
   - Update the `BookSession.fromBuffer` entry to describe dispatching.
4. **Update `docs/DATA-FLOWS.md`:** the "Loading an EPUB File" flow becomes
   "Loading a Book File": detect → selectAdapter → adapter.parse → BookSession.
5. **Update `README.md`** line(s) that say "Load any `.epub` file": reword to
   "Load a supported book file (EPUB today; more formats coming)" — keep it honest
   without over-promising.

**Acceptance:** docs reference no `js/epub/` paths; `ADDING-A-FORMAT.md` matches the
real adapter interface.

---

## 3. Import-cycle & boot-order checklist (read before coding)

The new modules form this dependency graph (arrows = "imports"):

```
mode-switcher / *-app  ──▶ core/book-session ──▶ formats/index ──▶ formats/registry
                                  │                    │                 │
                                  │                    ▼                 ▼
                                  │            formats/epub/adapter   formats/detect
                                  ▼                    │
                          core/position ──▶ formats/registry (Task 8)
                                  ▲                    │
                                  └────────────────────┘  ← WATCH THIS EDGE
```

- `formats/registry.js` must import **only** `formats/detect.js` (no app/core).
- `formats/capabilities.js` and `formats/detect.js` import **nothing** from the
  app — they are leaves.
- The only risky edge is **Task 8** (`position.js → registry.js`). `registry.js`
  does not import `position.js`, so there is no cycle — but `book-session.js`
  imports both `position.js` and `formats/index.js`. ES modules resolve this fine
  (no runtime cycle), but if you observe a "cannot access before initialization"
  error, apply the fallback in Task 8 (no registry import in `position.js`).

---

## 4. Verification plan

### 4.1 Automated
- `reader.html?selftest=1` → all groups green (existing + new `formats`).

### 4.2 Manual matrix (use the real books in `books/`)

For **at least three** EPUBs of different sizes (the perf plan names good ones:
`books/Battletech/14 - … Bloodname (1991).epub` (small),
`books/Brandon Sanderson/Mistborn/02 - … The Well of Ascension (2007).epub` (medium),
`books/Brandon Sanderson/Mistborn/01 - … The Final Empire (2006).epub` (large)):

| Check | How | Pass = |
|-------|-----|--------|
| Open in Reader | folder icon → pick file | renders, paginates, images show |
| TOC works | open TOC drawer, tap entries | lands on correct chapters |
| Position persists | read, reload page | restores to same word |
| Switch Reader→RSVP→TTS | mode buttons | same book, same position, **no re-parse stall** (check perf marks) |
| Bookmarks | add, jump, delete | work as before |
| Search | search a known word | hits highlight + navigate |
| Sample book | open with no `?src=` | Pride & Prejudice sample still loads |
| `?src=` URL load | `reader.html?src=books/…epub` | loads from URL |
| Unsupported file | rename an epub to `.pdf`, open it | friendly "can't open .pdf yet" error, no crash |

### 4.3 Regression sentinels
- No console errors on boot or load.
- `git grep -n "js/epub/"` returns **only** doc/plan history references, not live
  imports.
- `session.format === 'epub'` and `session.capabilities.reflow === true` (inspect
  in DevTools).

---

## 5. Commit strategy

Land as a small sequence of focused commits (each green-on-selftest):

1. `formats: add IR typedefs, capabilities, detect, registry` (Tasks 1-4) — pure
   additions, nothing wired.
2. `formats: move EPUB pipeline under formats/epub + adapter` (Task 5) — relocation
   + adapter, old `js/epub/` deleted, importers updated (Task 7).
3. `book-session: dispatch via format registry` (Task 6) + bookId (Task 8) +
   input/error wiring (Task 9).
4. `test+docs: format registry selftests, ADDING-A-FORMAT guide, doc updates`
   (Tasks 10-11).

Each commit must keep the app fully working — the user sees **zero** behaviour
change across the whole phase.

---

## 6. Risk register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Import path typo after move breaks boot | Med | Grep-driven Task 7; selftest after each commit |
| Import cycle via Task 8 | Low | registry imports no app code; fallback rule documented |
| Subtle behaviour change in moved EPUB logic | Low | Pure relocation — diff the moved files to confirm logic identical; manual matrix |
| `allImgUrls` removal breaks a hidden consumer | Low | Grep confirms only book-session referenced it |
| TOC helpers in `formats/epub/toc.js` feel mis-placed | Cosmetic | Documented as a follow-up; not blocking |
