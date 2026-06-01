# Stylus Support — Feasibility Study & Implementation Plan (`stylus-support.md`)

> **Status:** Planning / documentation only. No code in this round.
> **Scope:** The paginated reader (`reader.html?mode=read`). Notes on RSVP/TTS
> where relevant. Covers (1) the minimum requirement — *a stylus must not turn
> the page in normal reading mode* — and (2) build‑ready plans for the
> follow‑on features the user named: **per‑word selection** and **highlighting**.
>
> This document follows the conventions of [`upgrades.md`](upgrades.md): each
> feature is an **isolated unit of work** (one branch, one PR, one setting where
> it changes UX), independently mergeable and revertible. Branch management is
> handled by the user — this environment does not push code on its own.

---

## 1. Executive summary

**The ask.** Make the reader stylus‑friendly. At minimum, a stylus (Apple
Pencil, S Pen, USI/Wacom AES, Surface Pen) must **not turn the page** when the
user rests or draws on the reading surface in paginated reading mode. Beyond
that, the user sees value in **selecting individual words** with the stylus
(foundation for future features) and **highlighting** passages.

**Verdict: feasible, low‑to‑moderate effort, no new dependencies.** The
codebase is unusually well‑positioned for this:

- All input is already centralised in two small modules
  (`js/reader/input.js`, `js/rsvp/input.js`). The page‑turn behaviour lives in
  ~50 lines we can make pointer‑type‑aware.
- The reader already has a **word‑level document model** (`doc.words[i]` with
  text node + offsets) and a `wordRange(state, i)` helper that returns a DOM
  `Range` over any word — exactly what per‑word selection and highlighting need.
- The **CSS Custom Highlight API** is already used for search highlighting
  (`js/reader/search.js`, `::highlight(search-results)` in
  `css/components/selection.css`). Highlighting passages reuses that pattern,
  so we can render highlights **without mutating the EPUB DOM**.
- A **persisted, per‑book store keyed by a portable locator** already exists for
  bookmarks (`js/core/bookmarks.js`, `reader:bookmarks:<bookId>`). A highlight
  store is a near‑clone.

**The single biggest decision** is how to detect "this is a pen, not a finger."
There are two viable paths (Section 4); the recommendation is to **migrate the
reader's touch handlers to Pointer Events** so we get `pointerType` (`'pen'` vs
`'touch'` vs `'mouse'`) plus pressure/tilt for free, while keeping a tiny
`Touch.touchType` fallback for older Safari.

**Recommended sequencing:** `S0` (don't‑turn‑the‑page) → `S1` (word selection) →
`S2` (highlighting). `S0` ships the minimum requirement on its own and lays the
input foundation the others build on. `S3` (pressure/ink annotations) is sketched
as future‑facing only.

---

## 2. Baseline — how input works today

### 2.1 Paginated reader input (`js/reader/input.js`)

The `InputHandler` binds **raw touch events** on the viewport:

| Event | Behaviour (today) |
| --- | --- |
| `touchstart` | Records start X/Y/time, current transform; arms a drag (single‑touch, paginated, >1 page only). |
| `touchmove` | Decides axis (`h` if `|dx|>|dy|` and `>8px`; `v` if `|dy|>12px`). Horizontal drag → live `--page-offset` translate, `preventDefault()`. |
| `touchend` | Horizontal past threshold → `pagination.goTo(±1)`. Otherwise, if it was a near‑stationary quick tap → `_handleTap(x)` (tap zones: left 0–30% prev, right 70–100% next, centre toggles chrome). |
| `click` | Synthetic‑click guard (600 ms after touchend), else `_handleTap`. |
| `keydown` | Arrows / Space / PageUp/Down / Escape. |

**Why a stylus turns the page today.** A stylus does not emit a distinct event
stream here — pens fire the **same `touchstart/touchmove/touchend`** sequence as
a finger (touch‑compatibility events). The handler has no way to know the
contact was a pen, so a pen swipe (or even a diagonal pen stroke that crosses the
horizontal threshold) is treated as a page turn. There is currently **no
`pointerType` check and no `touch-action`/`touchType` gating** in `input.js`
(confirmed: the only Pointer Events usage in the repo is in `js/rsvp/input.js`).

### 2.2 Selection today (`js/reader/selection.js`)

`SelectionManager` is purely reactive: it listens to `selectionchange`, and when
the OS/browser produces a non‑empty selection it shows a floating bar with
**Copy** and **Define**. It does **not** create selections itself — it relies on
the platform's native long‑press/drag selection, which a stylus may or may not
trigger depending on the device. CSS gates selection behind
`body.selection-on .reader-content { user-select: text }`
(`css/components/selection.css`).

### 2.3 The word model (the asset that makes this cheap)

`js/model/doc-model.js` builds, per book:

```
doc.words[i]  = { node: Text, start, end, block, section }   // node-relative offsets
doc.blocks[b] = { el, type, section, wordStart, wordEnd }
doc.sections  = [ { href, el, wordStart, wordEnd } ]
doc.text      = full concatenated string
doc.wordCharStart[i] = char offset of word i into doc.text
```

`js/model/geometry.js` exposes `wordRange(state, i)` → a `Range` over word `i`,
plus `pageOfWord`, `wordAtPageStart`. `js/model/locator.js` converts a global
word index ↔ a portable `{s, b, w}` locator (`toLocator`/`resolveLocator`).

**Consequence:** "the word under point (x, y)" and "a stable address for a
selected range" are both already solvable with existing helpers — we only need a
point→word hit test (Section 5, `S1`).

### 2.4 Highlight rendering precedent

`js/reader/search.js` already paints on‑page matches with the **CSS Custom
Highlight API**:

```js
const hl = new Highlight(...ranges);
CSS.highlights.set("search-results", hl);
```

styled by `::highlight(search-results)` in `css/components/selection.css`.
`js/tts/highlighter.js` shows the DOM‑mutation fallback (`range.surroundContents`)
for engines without the Highlight API. Both patterns are reusable for `S2`.

### 2.5 The pagination caveat (must‑know for S1/S2)

`js/reader/pagination.js` **detaches off‑screen chapter DOM** during
re‑pagination (`removeChild` into comment markers, reattached on a later tick).
Any `Range` or word `node` reference can therefore point at **detached DOM**
after a font/size/orientation change. This is exactly why the existing search
and locator code re‑derives ranges *from the model/locator on demand* rather than
holding live `Range`s across relayout. **Highlights and persisted selections
must do the same:** store **locators**, re‑resolve to `Range`s after every
`paginate()`/`repaginate()`.

---

## 3. Requirements

| # | Requirement | Priority |
| --- | --- | --- |
| R1 | A stylus must **not** turn the page (swipe) or trigger tap‑zone navigation in paginated reading mode. | **Must (minimum)** |
| R2 | Finger and keyboard navigation must be **completely unchanged**. | Must |
| R3 | The behaviour must be **revertible** and (where it changes UX) behind a persisted setting with a sensible default. | Must |
| R4 | Stylus can **select an individual word** (tap) and extend the selection (drag). | Should (future‑facing) |
| R5 | Selected text can be **highlighted**, highlights **persist per book**, survive repagination, font/theme changes, and reload. | Should |
| R6 | No new runtime/CDN dependency; offline still works; graceful fallback on engines without Pointer Events / Highlight API. | Must |
| R7 | Accessible: respects `prefers-reduced-motion`; keyboard parity for highlight create/delete; ARIA on any new controls. | Must |

---

## 4. Core technical decision — detecting "pen vs finger"

There are two ways to know a contact is a stylus. We can adopt either or both.

### Option A (recommended): migrate reader input to **Pointer Events**

Pointer Events unify mouse/touch/pen and expose **`event.pointerType`**
(`'pen' | 'touch' | 'mouse'`), plus `pressure`, `tiltX/Y`, `twist`, and a stable
`pointerId` for multi‑contact tracking. Browser support is universal across our
stated targets (Chrome/Edge 90+, Firefox 90+, Safari 13+/iOS 13+).

- **Page‑turn gestures gate on `pointerType !== 'pen'`.** A pen contact simply
  never arms the swipe/tap‑zone logic in reading mode.
- We get **pressure/tilt** for free → enables the future ink/annotation track
  (`S3`) without a second rewrite.
- `setPointerCapture(pointerId)` gives robust drag tracking for selection (`S1`).
- `touch-action: pan-y` (or `none`) on the viewport lets us own horizontal
  gestures cleanly and stops the browser hijacking the stroke.
- RSVP input (`js/rsvp/input.js`) already uses Pointer Events, so this *aligns*
  the two modes rather than diverging them.

**Cost/risk.** `input.js` touch logic (the live‑drag `--page-offset` translate,
the synthetic‑click guard, axis decision, tap‑zone math) must be faithfully
re‑expressed on `pointerdown/move/up/cancel`. This is the one non‑trivial part of
the whole effort. It is contained to a single ~135‑line file with a clear
behavioural contract, and is covered by a manual test matrix (Section 8).

### Option B (smaller, lower‑risk fallback): keep touch events, gate on `Touch.touchType`

iOS/iPadOS Safari exposes **`Touch.touchType === 'stylus'`** (vs `'direct'`) on
the existing `touchstart`/`touchend` `e.touches[0]`. We could add a one‑line
guard at the top of each touch handler:

```js
if (e.touches[0] && e.touches[0].touchType === 'stylus') return; // never navigate
```

- **Pro:** minimal diff, near‑zero regression risk to finger navigation, ships
  R1 today on the most common stylus platform (iPad + Apple Pencil).
- **Con:** `Touch.touchType` is non‑standard and **not implemented on Android**
  (S Pen, USI). It does not give pressure/tilt, so it does not advance `S1`–`S3`.
  It is a dead‑end for the richer features.

### Recommendation

**Do Option A.** It is the right foundation for everything the user described
(word select, highlight, and the implied "future features"), aligns the two
input modules, and adds no dependency. Keep a tiny **`touchType` belt‑and‑braces
fallback** inside the migrated handler for any engine that reports a pointer as
`'touch'` but a touch as `'stylus'`. If the user wants R1 *immediately* with the
smallest possible change, Option B can ship first as a stop‑gap and be folded
into A later — but the plan below assumes A.

> **Open question Q1:** Ship the minimum fix as Option B first (tiny, iPad‑only)
> and migrate to A later, or go straight to A? Default assumption: **straight to
> A.**

---

## 5. Units of work

Template per unit (as in `upgrades.md`): **Goal · Depends on · Isolation ·
Design · Data/Persistence · Steps · Settings UI · Acceptance · Manual tests ·
Risks · Effort (S/M/L)**.

```
 S0  Stylus-aware input  ──►  S1  Word selection  ──►  S2  Highlighting
 (don't turn the page;        (point→word hit          (persist + render
  Pointer Events migration)    test, tap/drag)          via Highlight API)

 S3  Pressure / ink annotations   (future-facing sketch only; depends on S0)
```

---

### Unit S0 — Stylus‑aware input: "don't turn the page" *(R1, R2, R3)*

**Goal.** A stylus contact never turns the page or fires tap‑zone navigation in
paginated reading mode. Finger and keyboard behaviour is byte‑for‑byte unchanged.

**Depends on:** nothing.

**Isolation.** Branch `claude/s0-stylus-input`. Files: `js/reader/input.js`
(migrate to Pointer Events), `js/core/constants.js` (new tuning constants +
default pref), `css/components/content.css` or `chrome.css` (add `touch-action`
on the viewport). Optionally a settings row (Section "Settings UI").

**Design.**
- Replace the three `touch*` listeners with `pointerdown` / `pointermove` /
  `pointerup` / `pointercancel`, preserving the existing state machine
  (`_dragging`, `_decided`, `_startX/Y`, `_baseTx`, `_startT`, `_lastTouchEnd`)
  and the existing thresholds (`SWIPE_THRESHOLD_*`, `TAP_ZONE_*`,
  `TAP_TIMEOUT_MS`, `SYNTHETIC_CLICK_GUARD_MS`).
- **Pen gate:** in `pointerdown`, if `e.pointerType === 'pen'` (or the
  `touchType === 'stylus'` fallback), set a `_penContact` flag and **do not arm**
  the drag/tap path. The pen is then free to do selection (`S1`) or — when neither
  selection nor any stylus feature is active — simply do nothing (no page turn,
  no chrome toggle). Behaviour for `pointerType === 'touch'`/`'mouse'` is the
  current behaviour.
- Use `setPointerCapture(e.pointerId)` on the deciding pointer so a drag that
  leaves the viewport still completes correctly (fixes a latent finger‑drag edge
  case too).
- `touch-action: pan-y` on `.reader-viewport` so the browser yields horizontal
  gestures to us and never starts its own scroll/zoom mid‑swipe; vertical scroll
  in scroll‑mode is preserved.
- The synthetic‑click guard stays: with Pointer Events the stray `click` is still
  possible on some engines; keep the `_lastPointerUp` timestamp guard.
- **Pref:** `prefs.penTurnsPage` (default **false** = pen never navigates). This
  satisfies R1 by default while leaving a switch for users who *want* a pen to
  page‑turn. When `true`, the pen gate is bypassed and a pen behaves like a finger.

**Data/Persistence.** Add `penTurnsPage: false` to `DEFAULT_PREFS`
(`js/core/constants.js`); add a `SETTINGS` row (`repaginate: false`,
`transform: v => v === "true"`). No schema bump needed (additive, defaults safe).

**Steps.**
1. Add `penTurnsPage` to `DEFAULT_PREFS` + a `SETTINGS` entry; add the segmented
   control markup/ID to the settings screen template.
2. Rewrite `InputHandler._bindEvents` on Pointer Events, preserving the drag/tap
   contract. Keep keyboard handler unchanged.
3. Add the pen gate keyed on `e.pointerType` + `touchType` fallback + the
   `penTurnsPage` pref.
4. Add `touch-action: pan-y` to the viewport CSS.
5. Verify the synthetic‑click guard and coach‑dismiss/`closePanels` callbacks
   still fire identically.

**Settings UI.** One segmented control in the reader settings sheet:
**"Stylus turns page"** → *Off (default) / On*. Off = R1.

**Acceptance.**
- A pen swipe/tap on the reading surface does **nothing** to pagination (default
  pref). Finger swipe/tap/keyboard navigation is unchanged.
- Toggling **Stylus turns page → On** restores pen page‑turning; persists.
- Scroll‑mode vertical scrolling with a finger still works; tap‑to‑toggle‑chrome
  still works with a finger.

**Manual tests.** (No headless browser — see `upgrades.md` §5.)
1. iPad + Apple Pencil: swipe across text → page does not turn. Finger swipe →
   turns. Pencil tap in right zone → no turn.
2. Android + S Pen (Chrome): same matrix.
3. Mouse + desktop: click zones and drag unchanged.
4. Finger on phone: swipe both directions, tap all three zones, rubber‑band at
   ends, quick tap vs slow drag — all unchanged.
5. Two‑finger / multi‑touch start → ignored as today (`pointerType==='touch'`
   with >1 active pointer: keep the "single contact only" guard).
6. Scroll‑mode: finger scroll works; pen does not page‑turn.

**Risks.** The touch→pointer rewrite is the only real risk; mitigated by keeping
the exact thresholds/state machine and a thorough manual matrix. `touch-action`
interaction with scroll‑mode needs checking (`pan-y` keeps vertical scroll).
**Effort: M.**

---

### Unit S1 — Per‑word selection with the stylus *(R4)*

**Goal.** A stylus **tap on a word** selects that word; a **pen drag** extends a
word‑granular selection across the range. Surfaces the existing selection bar
(Copy/Define) and is the entry point for highlighting (`S2`). A finger continues
to navigate; the platform's native long‑press selection is left intact.

**Depends on:** `S0` (pen gate + Pointer Events), the word model
(`doc.words`, `wordRange`), `locator.js`.

**Isolation.** Branch `claude/s1-pen-select`. Files: `js/reader/selection.js`
(add a pen‑driven selection path), small additions to `js/reader/input.js`
(route pen down/move/up to the selection manager when a pen is in contact),
`css/components/selection.css` (optional caret/handle styling). Setting:
`prefs.penSelect` (default **on** when `selection` is on).

**Design.**
- **Point → word hit test.** Implement `wordAtPoint(x, y)`:
  1. Use `document.caretPositionFromPoint(x, y)` (or the WebKit
     `document.caretRangeFromPoint`) to get the `(textNode, offset)` under the
     pen.
  2. Map that to a word index by scanning `doc.words` for the entry whose
     `node === textNode` and `start ≤ offset < end` (bounded scan within the word's
     block via `doc.blocks[b].wordStart/wordEnd`, so it's O(words‑in‑block), not
     O(book)). Fall back to nearest word in the block.
  This reuses the same `node`/`start`/`end` data the model already stores; no DOM
  changes, no per‑word spans.
- **Tap = select word.** On a pen `pointerup` classified as a tap (reuse `S0`'s
  tap classification, but in the pen branch), compute `wordAtPoint`, build
  `wordRange(state, i)`, and set the window selection to it
  (`selection.removeAllRanges(); selection.addRange(range)`). The existing
  `selectionchange` listener then shows the Copy/Define bar automatically.
- **Drag = extend selection.** On pen `pointerdown` start a selection anchor at
  `wordAtPoint(downX, downY)`; on `pointermove` (pen) extend the focus to
  `wordAtPoint(curX, curY)`, snapping both ends to **word boundaries** via the
  block's `wordStart/wordEnd`, and set a `Range` from `min` word's start to
  `max` word's end. `setPointerCapture` keeps the drag alive past the viewport
  edge. Auto‑scroll/auto‑page near edges is a **later refinement** (note it, don't
  build it now).
- **Gesture arbitration.** While a pen selection is active or non‑empty, `S0`'s
  pen gate already prevents navigation; additionally keep the existing
  `_handleTap` guard that clears a selection on a *finger* tap
  (`js/reader/input.js:111`).
- **Locators.** Expose the selection's endpoints as portable locators
  (`toLocator(anchorWordIdx)`, `toLocator(focusWordIdx)`) — this is what `S2`
  persists and what a future cross‑view (RSVP/TTS) highlight would consume.

**Data/Persistence.** None in `S1` (selection is ephemeral). The locator export
is an in‑memory API for `S2`.

**Steps.**
1. Add `wordAtPoint(x, y)` to a new `js/reader/word-hit.js` (or into
   `geometry.js`) with the caret‑position → word‑index mapping + block‑scoped
   fallback.
2. In `selection.js`, add `selectWordAt(x, y)` and `extendSelectionTo(x, y)`
   plus an `anchorWordIdx` field; expose `currentSelectionLocators()`.
3. In `input.js`, in the pen branch: tap → `selection.selectWordAt`; drag →
   anchor on down, `selection.extendSelectionTo` on move.
4. CSS: optional larger selection handles / tweak `::selection` for pen
   visibility. Ensure `user-select: text` is active on `.reader-content` (already
   gated by `body.selection-on`).
5. Respect `prefs.penSelect` / `prefs.selection`.

**Settings UI.** Reuse the existing **Selection** toggle; add a sub‑option
**"Pen selects words"** (default On) under it, or fold into the Selection toggle
if we don't want two controls. (Open question Q2.)

**Acceptance.**
- Pen tap selects exactly the tapped word; Copy/Define bar appears; Copy copies
  that word.
- Pen drag selects a word‑aligned range across multiple words/lines within the
  visible page; selection endpoints map to correct locators.
- Finger tap still clears the selection and toggles chrome / navigates; finger
  navigation unaffected.

**Manual tests.** iPad/Pencil + Android/S Pen: tap several words (start, middle,
end of lines; inside italic/bold inline spans from rich‑inline U6); drag forward
and backward; tap whitespace/margin (should no‑op or select nearest word per
fallback); rotate device mid‑selection (selection may drop — acceptable, must not
crash). Verify across a 2‑column page.

**Risks.** `caretPositionFromPoint` vendor differences (Safari uses
`caretRangeFromPoint`) → feature‑detect both. Words split across inline element
boundaries (rich‑inline content from U6) → the model already stores per‑text‑node
offsets, so each word maps to one text node; cross‑node *selections* are fine
because we build the outer `Range` from two word ranges. Detached DOM after
repagination → only operate on the visible/attached page; rebuild on relayout.
**Effort: M.**

---

### Unit S2 — Highlighting *(R5)*

**Goal.** Turn a selection (from `S1` pen drag, or any native selection) into a
**persisted highlight**. Highlights render on the page, survive repagination /
font / theme changes / reload, support multiple colours, and can be deleted.

**Depends on:** `S1` (selection → locators), the locator model, the
CSS Highlight API precedent (`search.js`), the bookmark‑store pattern
(`js/core/bookmarks.js`).

**Isolation.** Branch `claude/s2-highlights`. New files:
`js/core/highlights.js` (store, mirrors `BookmarkManager`),
`js/reader/highlight-render.js` (locator → `Range` → `CSS.highlights`).
Edits: `js/reader/selection.js` (add a **Highlight** button to the sel bar),
`css/components/selection.css` (`::highlight(...)` rules per colour),
`js/reader-app.js` (wire render on paginate/repaginate, load on book set),
optional `js/bookmarks/panel.js` (list highlights alongside bookmarks).
Setting: none required (a feature, not a UX‑mode change); colour choice is a
per‑action picker.

**Design.**
- **Store** `HighlightManager` keyed `reader:highlights:<bookId>`, mirroring
  `BookmarkManager`. Each item:
  ```js
  {
    id, createdAt,
    start: {s, b, w},   // portable locator (anchor)
    end:   {s, b, w},   // portable locator (focus, inclusive word)
    color: 'yellow' | 'green' | 'blue' | 'pink',
    text:  '… first 120 chars …',   // for the list/search, like bookmarks
    note:  ''                        // optional, reuses bookmark note UX
  }
  ```
- **Create.** Selection bar gains a **Highlight** action (swatch row for colour).
  On tap: read `currentSelectionLocators()` from `S1`, `manager.add(...)`,
  re‑render, dismiss the bar and the selection.
- **Render — primary path: CSS Custom Highlight API.** For each colour, collect
  the `Range`s of all highlights of that colour **that intersect attached DOM**,
  build one `Highlight(...ranges)` per colour, and `CSS.highlights.set('hl-' +
  color, hl)`. Style with `::highlight(hl-yellow){ background: … }` etc. in
  `selection.css`. This is the *same mechanism search already uses* and crucially
  **does not mutate the EPUB DOM**, so it composes with pagination's
  detach/reattach and with search highlights (different highlight names layer
  fine). Re‑resolve every highlight's locator → word indices →
  `Range(wordRange(start) … wordRange(end))` after each `paginate()`/`repaginate`.
- **Render — fallback** (no `CSS.highlights`, e.g. older Safari): wrap with
  `range.surroundContents(<mark class="hl hl-yellow">)` using the
  `js/tts/highlighter.js` approach, **unwrapping/re‑wrapping around
  repagination** to avoid stale wrappers in detached DOM. Document this as the
  lower‑fidelity path.
- **Delete / edit.** Tapping an existing highlight (pen or finger) hit‑tests via
  `wordAtPoint` → find the highlight whose locator range contains that word →
  show a small popover (reuse footnote‑popover styling): change colour, add note,
  delete. Keyboard parity: when a highlight word is focused, a delete affordance
  in the bookmarks/highlights panel.
- **Panel.** Extend the existing bookmarks panel (`js/bookmarks/panel.js`) to
  list highlights (colour swatch + snippet + chapter), tap → `goToLocator`.
  (Open question Q3: separate tab vs merged list.)

**Data/Persistence.** New key `reader:highlights:<bookId>` (additive; same
`bookId` resolution as bookmarks/locator). No migration. Export/import can piggy‑
back on any future bookmark export.

**Steps.**
1. `HighlightManager` (clone `BookmarkManager`, add `color`, `start`/`end`
   locators, `updateColor`).
2. `highlight-render.js`: `renderAll(state)` (locator → ranges → `CSS.highlights`
   per colour) + fallback wrapper path + `clearAll`.
3. Selection bar: add **Highlight** + colour swatches; wire to store + render.
4. `reader-app.js`: load highlights on `setBook`; call `renderAll` after first
   `paginate` and after every `repaginate`/scroll‑mode relayout; clear on book
   change.
5. Tap‑existing‑highlight → edit/delete popover.
6. Panel integration + jump‑to.

**Settings UI.** None mandatory. Optional: a default highlight colour pref
(`prefs.highlightColor`).

**Acceptance.**
- Select → Highlight → passage is shaded in the chosen colour; persists across
  reload; correct after font‑size change, theme change, rotation, and
  paginated↔scroll switch (re‑resolved from locators).
- Multiple colours coexist; search highlights still render over/under without
  clobbering (distinct `::highlight` names).
- Tapping a highlight lets you recolour / note / delete; deletion clears render
  and store.
- Highlights list in the panel jumps to the right word.

**Manual tests.** Create 3 highlights in different chapters/colours → reload →
all present and correctly placed. Change font size ±, switch theme, rotate →
positions hold. Switch to scroll mode → still correct. Delete one → gone after
reload. Engine without Highlight API → fallback `<mark>` path renders (verify no
stale marks after repagination). Confirm a highlight spanning a column/page break
renders on both visible columns.

**Risks.**
- **Detached DOM / repagination** is the central correctness risk — mitigated by
  storing locators and re‑rendering from them on every relayout (never holding
  live `Range`s). This is the established pattern in `search.js`.
- **Fallback DOM mutation** (`surroundContents`) can fail when a range crosses
  element boundaries (rich inline) — catch and degrade (highlight the word‑aligned
  sub‑ranges per text node), exactly as `tts/highlighter.js` does.
- **Highlight API availability** — feature‑detected; fallback exists. **Effort: M
  (primary path) / +S for the fallback.**

---

### Unit S3 — Pressure / tilt / ink annotations *(future‑facing sketch only)*

**Not scheduled.** Recorded so `S0`'s Pointer Events foundation is built with it
in mind.

Once `S0` lands, `pointerdown/move` already carry `pressure`, `tiltX/Y`, `twist`.
Future possibilities, each its own unit later:
- **Freehand ink / margin notes**: capture pen strokes to an overlay
  `<canvas>`/SVG positioned over the page, store stroke paths anchored to the
  nearest locator + page‑relative coordinates, re‑project on repagination. (L —
  coordinate re‑anchoring across reflow is the hard part; consider anchoring ink
  to a block element rather than absolute page coords.)
- **Pressure‑sensitive highlighter** (stroke width follows pressure) — cosmetic
  on top of S2 ink.
- **Eraser** via `pointerType==='pen'` + `buttons`/`button === 5` (barrel/eraser
  end on supported pens).
- **Handwriting → text** is out of scope (would need an external engine →
  violates the no‑dependency / offline rule).

**Effort: L+ each; revisit after S2 ships and there's a real use case.**

---

## 6. Cross‑cutting concerns

- **Settings / persistence.** New prefs are additive to `DEFAULT_PREFS`
  (`penTurnsPage`, optional `penSelect`, `highlightColor`); wired through the
  declarative `SETTINGS` table. New stores use the existing
  `reader:<feature>:<bookId>` convention and the `bookId` resolution already used
  by bookmarks/locator. No schema version bump required.
- **Repagination invariant.** Anything that holds a position must store a
  **locator**, not a live `Range`/`node`, and re‑resolve after `paginate`/
  `repaginate`/scroll relayout (Section 2.5). This is the one rule that keeps
  S1/S2 correct.
- **Feature detection / fallback (R6).** Pointer Events (universal on targets;
  `Touch.touchType` fallback for old Safari); `caretPositionFromPoint` ↔
  `caretRangeFromPoint`; `CSS.highlights` ↔ `surroundContents`. No CDN; offline
  unaffected.
- **Accessibility (R7).** Keyboard users get highlight create (from a keyboard
  selection) / delete (via panel) parity; respect `prefers-reduced-motion` (no
  new animations needed); ARIA labels on new buttons/popovers; selection bar and
  highlight popover trap focus via the existing `focus-trap.js` if they become
  modal.
- **RSVP / TTS.** Out of scope for turning behaviour (RSVP already uses Pointer
  Events and has no "pages" to mis‑turn). Highlights are locator‑based, so a
  *future* enhancement could surface reader highlights in TTS via the existing
  `TtsHighlighter`. Noted, not built.
- **Performance.** `wordAtPoint` is block‑scoped (O(words‑in‑block)). Highlight
  render is O(visible highlights) per relayout using one `Highlight` object per
  colour — same cost class as the existing search highlighter.

---

## 7. Risk summary

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Touch→Pointer rewrite regresses finger navigation | Med | Preserve exact thresholds/state machine; full manual matrix (S0). Optionally ship Option B stop‑gap first. |
| Highlights drift after repagination / detached DOM | Med | Store locators; re‑resolve on every relayout (proven `search.js` pattern). |
| `caretPositionFromPoint` vendor differences | Low | Feature‑detect `caretRangeFromPoint` fallback. |
| No CSS Highlight API on older Safari | Low | `surroundContents` fallback (TTS pattern). |
| Stylus detection on Android stop‑gap (Option B only) | Low | Only relevant if B is chosen; A (pointerType) covers Android. |
| Ink annotation reflow re‑anchoring (S3) | High | Deferred; anchor to block + relative coords when scheduled. |

---

## 8. Definition of done (per unit)

Inherits `upgrades.md` §5:
- Branch from fresh `master`; single PR; isolated and revertible.
- UX‑changing behaviour behind a persisted setting with a safe default
  (S0 `penTurnsPage=false`); migration‑safe (additive).
- All referenced element IDs exist; modules parse.
- Manual test checklist in the PR (no headless browser available — must test on
  at least one real pen device: iPad+Pencil or Android+S Pen).
- No new CDN/runtime dependency; offline still works.
- Position/resume + existing search highlighting remain correct (no regression).

---

## 9. Recommended order & effort

1. **S0 — Stylus‑aware input (M).** Ships the minimum requirement (R1). Foundation.
2. **S1 — Pen word selection (M).** Unlocks the "select individual words" value.
3. **S2 — Highlighting (M, +S fallback).** The headline feature.
4. **S3 — Ink/pressure (L+).** Future; only after a concrete use case.

Total for the user's stated goals (R1 + word select + highlight): **~3 isolated
PRs, all M‑sized, no new dependencies.**

---

## 10. Open questions to confirm before building

- **Q1.** Ship Option B (tiny iPad‑only stop‑gap) first, or go straight to the
  Pointer Events migration (Option A)? *Default: straight to A.*
- **Q2.** One **Selection** toggle, or a separate **"Pen selects words"**
  sub‑option? *Default: sub‑option under Selection, on by default.*
- **Q3.** Highlights in the **existing bookmarks panel** (merged or tabbed) or a
  **new panel**? *Default: a tab in the existing panel.*
- **Q4.** Highlight **colour set** — fixed 4 (yellow/green/blue/pink) or themed
  to match the active palette? *Default: fixed 4, theme‑aware text contrast.*
- **Q5.** Should the pen, when *not* selecting, be allowed to **toggle chrome**
  on a tap (a gentle "do nothing but UI" affordance), or be fully inert on the
  reading surface? *Default: inert in reading mode (safest for R1).*
