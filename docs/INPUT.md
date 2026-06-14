# Input & Stylus Subsystem (`docs/INPUT.md`)

How the paginated Reader turns pointer/touch/key signals into actions, and the
exact place every new pen/stylus feature plugs in. If you are building an S Pen
phase (`plans/spen/`), this is your map of the territory.

> Companion docs: [`ARCHITECTURE.md`](ARCHITECTURE.md) (system shape),
> [`MODULES.md`](MODULES.md) (per-module API), [`BEST-PRACTICES.md`](BEST-PRACTICES.md)
> (the invariants), [`TESTING.md`](TESTING.md) (how to test input).

---

## 1. The three input layers, and why they coexist

The reader viewport (`.reader-viewport`) carries **three overlapping listener
sets** bound in `InputHandler._bindEvents` (`js/reader/input.js`):

| Layer | Events | Drives | Pointer types |
| --- | --- | --- | --- |
| **Touch** | `touchstart/move/end/cancel` | Finger page-turn drag, pinch-zoom, pan-while-zoomed, tap zones | finger only (bails when a pen is active) |
| **Pointer** | `pointerdown/move/up/cancel` | The **pen**: word selection, highlight edit, optional navigation | `pointerType === 'pen'` only |
| **Key / click** | `keydown`, `click` | Arrows/Space/PageUp-Down/Escape; synthetic-click guard | — |

**Why both touch and pointer?** The touch layer predates the pen work and carries
the mature pinch-zoom/pan state machine. Rather than risk regressing it, the pen
was added as a *parallel* Pointer-Events path. The two are kept from fighting by a
single flag:

```
pointerdown (pen) fires BEFORE the compatibility touchstart   (see caveat)
  → set this._penActive = true
  → every touch* handler does `if (this._penActive) return;` at the top
```

> **Caveat — this ordering is a relied-upon assumption, not a spec guarantee.** The
> interleaving of Pointer Events and compatibility Touch Events is
> implementation-defined; the codebase *depends* on `pointerdown` landing before
> `touchstart` on the target Android engines (the comment at `input.js:234-235`
> states this). It holds on Android Chrome/WebView today. If a future engine
> reordered them, the `_penActive` gate would need a different mechanism. Treat it
> as "true on our target platform," not "true everywhere."

So a pen contact is handled exclusively by the `pointer*` handlers, and its
touch-compatibility events are ignored. A finger never sets `_penActive`, so it
keeps the full touch machine. **Do not try to unify these while adding a feature —
add to the pen branch.**

---

## 2. The pen branch — line-by-line mental model

All in `js/reader/input.js`. The pen has two modes, chosen at `pointerdown` by
`this._penNavigating = this._penTurnsPage()` (reads `state._prefs.data.penTurnsPage`,
default **false**):

### 2.1 `penTurnsPage === false` (default): pen = selection tool

- `pointerdown`: add `body.pen-contact` (forces `user-select:none` so Android's
  native selection UI never appears), `preventDefault()`, anchor the word under the
  pen via `this._wordAtPoint(x,y)` → `this._penAnchorWord`.
- `pointermove`: once moved past a 6px deadzone, extend a word-granular selection
  and **paint it live** by calling `callbacks.penSelect(anchor, focus, false)`.
- `pointerup`:
  - if it was a drag → `callbacks.penSelect(anchor, focus, true)` (commit + show
    the action bar);
  - if it was a tap → first try `callbacks.editHighlightAt(x,y)` (edit an existing
    highlight); else select the single word; else clear.

### 2.2 `penTurnsPage === true`: pen = finger

The pen branch re-implements the finger drag/tap state machine (`_decided`,
thresholds, `goTo`) so a pen swipes/taps to navigate. This path exists only when
the user opts in.

### 2.3 The callbacks (wired in `reader-app.js` ~line 589)

`InputHandler` is decoupled from the highlight system through five callbacks:

```js
penSelect(a, b, showBar)  → highlights.setPenSelection(a, b, showBar)
penClearSelection()       → highlights.clearPenSelection()
penSelectionActive()      → highlights.penSelectionActive()
editHighlightAt(x, y)     → highlights.handleTap(x, y)   // returns true if it ate the tap
toggleChrome / closePanels / dismissSelBar / dismissNotePopover / activePopoverRef
```

**This callback seam is where most S Pen phases attach.** A new hardware signal
(hover, barrel, eraser) is read in a `pointer*` handler and routed to a new or
existing callback — without touching the touch machine.

---

## 3. The hardware signals a PointerEvent carries (Tier 1)

For `pointerType === 'pen'`, every `pointer*` event exposes — already, no native
code — the full S Pen digitizer state:

| Field | Meaning | Use |
| --- | --- | --- |
| `pressure` | 0.0–1.0 tip pressure; **0 while hovering** | Phase 3 weight; hover detection |
| `buttons` (bitmask) | `0`=hover, `1`=tip, `2`=barrel held, `32`=eraser | Phase 1 hover, Phase 2 barrel/eraser |
| `button` (transition) | `0`=tip, `2`=barrel, `5`=eraser, `-1`=move/hover | edge detection |
| `tiltX/Y`, `altitudeAngle`, `azimuthAngle` | pen lean | Phase 3 (future chisel) |
| `pointerType` | `'pen'` for any S Pen, passive or BLE | the gate for everything |

**Hover ("Air View")** is just `pointermove` with `pointerType==='pen' &&
buttons===0 && pressure===0` — the digitizer reports the pen's position while it is
*near but not touching*. The viewport already receives these; today they are
ignored. Phase 1 consumes them.

> **What a PointerEvent does NOT carry:** the BLE remote button-click and the
> in-air gestures. Those are Bluetooth signals invisible to a web page — they need
> the native `SPenBridge` (Tier 2, Phase 4). Do not look for them in PointerEvents.

---

## 4. Point → word: the hit-test you will reuse constantly

`js/model/geometry.js`:

```js
wordAtPoint(state, x, y, prefer='start') → render-token index | -1
```

Uses `document.caretPositionFromPoint` (or WebKit `caretRangeFromPoint`) to get a
`(textNode, offset)`, then `wordIndexFromNodeOffset` maps it to a word index,
scanning only the words in the containing `.blk` (O(words-in-block)). Every
pen/hover feature that needs "what word is under the pen" calls this. It returns
`-1` on whitespace/margins — **always handle −1.**

Word index ↔ portable locator: `toLocator(state, i)` / `resolveLocator(state, loc)`
(`js/model/locator.js`). A word range for rendering: `wordRange(state, i)`.

---

## 5. The highlight system the pen feeds (recap for input work)

`js/reader/highlight-render.js` (`HighlightController`) and `js/core/highlights.js`
(`HighlightManager`). The methods input code calls:

| Call | Effect |
| --- | --- |
| `setPenSelection(a, b, showBar)` | Paint a word-granular selection `[a..b]` via `::highlight(pen-selection)`; show the action bar when `showBar`. |
| `createFromWords(a, b, color)` | Commit `[a..b]` to a stored highlight (the pen path — no native selection). |
| `createFromSelection(color)` | Commit the current *window* selection (the finger/native path). |
| `itemAtPoint(x, y)` / `itemAtWord(wi)` | Find the stored highlight under a point/word, or `null`. |
| `handleTap(x, y)` | If a highlight is under the point, open its edit bar; return `true`. |
| `renderAll()` | Re-resolve all stored highlights to ranges and publish `CSS.highlights`. **Call after every relayout.** |

**Phase 2 (barrel-drag, eraser) is almost entirely "call `createFromWords`
directly" and "call a new `deleteHighlightAt`"** — the store already does the work.

---

## 6. Settings & prefs plumbing (how to add a pen pref)

Declarative, in `js/core/constants.js`:

1. Add the default to `DEFAULT_PREFS` (e.g. `penHover: true`).
2. Add a row to the `SETTINGS` table:
   `{ seg: "penHoverSeg", attr: "penhover", pref: "penHover", repaginate: false, transform: v => v === "true" }`
   (mirror the existing `penSeg`/`selectionSeg` rows exactly).
3. Add the segmented-control markup with that `id` to the settings screen template
   (`js/settings/settings-screen.js` / the reader template).

Read a pref at runtime via `state._prefs.data.<key>` (as `_penTurnsPage()` does).
**Default must be safe** — a new pen feature defaults on only if it cannot cause an
accidental action for finger users (hover/pressure: on; anything that could turn a
page: off).

---

## 7. Gotchas the input code already encodes (don't relearn the hard way)

- **The synthetic-click guard.** A `pointerup`/`touchend` is followed by a stray
  `click` on some engines. `_lastTouchEnd`/`_lastPointerUp` timestamps suppress it
  (`SYNTHETIC_CLICK_GUARD_MS`). When you add a pen path that ends an interaction,
  stamp the guard or you'll get a phantom page-turn.
- **`setPointerCapture(pointerId)`** keeps a pen drag alive when it leaves the
  viewport. The pen branch already does this; reuse it for any new drag.
- **`body.pen-contact`** is the class that suppresses Android's native selection
  during a pen contact. Add it on pen-down, remove it on up/cancel — every exit
  path. A leaked `pen-contact` class disables finger selection.
- **`layoutScale(content)`** — while the chrome bars are visible the viewport is
  CSS-scaled, so `getBoundingClientRect()` returns scaled pixels. Any new
  point↔offset math must divide by `layoutScale` (see `geometry.js`). The existing
  `wordAtPoint` path is already scale-safe; new absolute-position code is not free.
- **Detached DOM after repagination** — see [`BEST-PRACTICES.md`](BEST-PRACTICES.md).
  Never hold a node/Range across a relayout; re-resolve from a locator.

---

## 8. Where each S Pen phase attaches (quick index)

| Phase | Signal read | Where | Routes to |
| --- | --- | --- | --- |
| 1 Hover preview | `pointermove`, `buttons===0 && pressure===0` | new `pointermove` listener / pen branch | new `HoverPreview` → `DefinitionPopover.show` / `footnotes` |
| 2 Barrel + eraser | `e.buttons & 2`, `e.buttons & 32` | pen branch in `input.js` | `createFromWords` (barrel-drag), new `deleteHighlightAt` (eraser) |
| 3 Pressure | `e.pressure` sampled on `pointermove` | pen selection drag | a `weight` stored on the highlight item + CSS opacity |
| 4 Reading remote | `window.__spen.onButtonClick/...` | new `SPenRemoteController` | `pagination.next/prev`, RSVP/TTS playback |
| 5 Pen-detach | `window.__spen.onPenAttached` | `SPenRemoteController` | toggle `body.spen-active` + prefs |

Each phase build-sheet expands these into exact edits, prefs, and tests.
