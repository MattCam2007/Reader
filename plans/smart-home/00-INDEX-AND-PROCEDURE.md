# Smart-Home Webhooks — Index & Build Procedure (`00-INDEX-AND-PROCEDURE.md`)

> **Read this whole file before starting any phase.** It tells you *how* to build
> a phase; each numbered sheet tells you *what*. Every decision is already made
> for you here or in the sheet — you should not need to invent architecture.

Master plan & rationale: [`../smart-home-webhooks.md`](../smart-home-webhooks.md).
Subsystem reference (read before coding): [`../../docs/WEBHOOKS.md`](../../docs/WEBHOOKS.md).
Payload field reference: [`../../docs/EVENT-CATALOG.md`](../../docs/EVENT-CATALOG.md).
Test harness: [`../../docs/TESTING.md`](../../docs/TESTING.md).
Invariants you must not break: [`../../docs/BEST-PRACTICES.md`](../../docs/BEST-PRACTICES.md).

---

## 0. Context for the implementer (read this — it prevents 90% of mistakes)

You are extending a **client-side, no-build, vanilla ES-module** app. Key facts:

- **No bundler.** Files are loaded as native ES modules by the browser. Import
  with explicit `.js` extensions and real relative paths. There is no
  TypeScript, no JSX, no transpile step.
- **Three reading modes**, each a closure-based `init()` in `js/reader-app.js`,
  `js/rsvp-app.js`, `js/tts-app.js`. They are orchestrated by
  `js/mode-switcher.js`, which gives each mode an `AbortSignal` and tears it down
  on a mode switch. **All event listeners you add must pass `{ signal }`.**
- **One EventBus already exists** (`js/core/events.js`: `on/off/emit`, plus a
  `"*"` wildcard). RSVP already wires it (`bus.emit('playStart')`, etc.). Reader
  and TTS use plain callbacks, not a bus. **Our dispatcher does NOT depend on
  each mode having a bus** — modes call a façade (`ReadingTelemetry.emit`)
  directly. Keep it that way; it's simpler and uniform across all three.
- **Reading position is canonical and shared.** `js/core/position.js`
  `buildPosition(sections, totalWords, ordinal, wordAt)` returns
  `{ href, wordInSec, ord, words, f, ... }`. Every mode already builds one
  (`getCanonicalPosition()`). **Stats and payloads read this — never invent a
  second position or word count** (see [`BEST-PRACTICES.md` §1.2, §1.4](../../docs/BEST-PRACTICES.md)).
- **The book is a `BookSession`** (`js/core/book-session.js`): `title`,
  `bookId`, `format`, `sections`, `toc`, `isSample`. Author/language are not yet
  on it — Phase 1 adds them via the existing EPUB metadata path; if absent, the
  payload field is simply omitted (never `undefined` in JSON).
- **Storage is `localStorage` via `safeSetItem`** (`js/core/safe-storage.js`),
  which prunes by recency on quota errors. Use it for anything you persist.
- **State is per-mode and scoped.** There is no global app object. Cross-mode
  continuity (sessions, lifetime stats) lives in `localStorage`, read fresh.

---

## 1. The build order

| Build | Sheet | Net-new files | Touches existing |
| --- | --- | --- | --- |
| 1 | [`01-stats-and-payload-foundation.md`](01-stats-and-payload-foundation.md) | `webhook-events.js`, `reading-stats.js`, `webhook-payload.js`, `webhook-formats.js` | `selftest.js`, (opt) extractor metadata |
| 2 | [`02-config-and-settings-ui.md`](02-config-and-settings-ui.md) | `webhook-config.js` | `settings-screen.js`, `constants.js`, `i18n` strings, CSS |
| 3 | [`03-dispatcher-queue-retry.md`](03-dispatcher-queue-retry.md) | `webhook-dispatcher.js`, `reading-telemetry.js` | `selftest.js` |
| 4 | [`04-mode-wiring.md`](04-mode-wiring.md) | — | `reader-app.js`, `rsvp-app.js`, `tts-app.js`, `mode-switcher.js` |
| 5 | [`05-presets-and-dashboards.md`](05-presets-and-dashboards.md) | (docs/examples only) | `webhook-formats.js`, `README.md` |
| 6 | [`06-testing-and-debugging.md`](06-testing-and-debugging.md) | — | `selftest.js`, `WEBHOOKS.md` |

Each phase is a separate branch and PR. **Do not start phase N+1 until phase N's
`node test/run-selftest.mjs` is green.**

---

## 2. The procedure for every phase

1. **Read the baseline.** Open every file in the sheet's "Files to touch" and
   read it fully. The mode apps are large closures — read the section you're
   wiring into (e.g. `updateProgressFn`, the RSVP `bus.on(...)` block, the TTS
   engine callbacks) before editing.
2. **Create the pure module(s) first.** Add the `js/core/webhook-*.js` files the
   sheet specifies. Keep **pure** modules (`webhook-events`, `webhook-payload`,
   `webhook-formats`) free of DOM, `localStorage`, network, and import-time side
   effects — they must import and run under Node for tests.
   ⚠️ **Create the module file *before* adding its `import` to `selftest.js`.** A
   top-level import of a missing/throwing module hard-fails the **entire** suite
   (all 200+ assertions go red), not just the new ones.
3. **Unit-test the pure module.** Add the `import` + assert block to
   `js/test/selftest.js` exactly as the sheet lists. Run
   `node test/run-selftest.mjs`; the new asserts must pass before you wire
   anything live.
4. **Add config/prefs if the sheet calls for it.** Follow
   [`CONTRIBUTING.md` §3](../../docs/CONTRIBUTING.md): add defaults to
   `js/core/constants.js`, settings-screen markup, and i18n strings.
5. **Wire it in (minimal edits).** Make only the edits the sheet lists. Every
   emit call is **one line** at a point the mode already runs; route it through
   `ReadingTelemetry`, never `fetch` directly from a mode.
6. **Functional-test the wiring.** Prefer in-page assertions in `runLiveTests`
   (inside `selftest.js`) — it runs in real Chromium with `state`/`prefs` in
   scope and a stub endpoint (`window.__webhookSink`) you install in the test.
7. **Verify the "rich payload" assertion.** The sheet names the fields that must
   be present and correct for that phase's events. Write the assertion that
   checks them against a synthetic book.
8. **Manual smoke** against the sheet's checklist using a local sink
   (`06-testing-and-debugging.md` ships a 10-line Node `http` echo server), then
   commit.

If a step has no work for a phase, the sheet says so explicitly.

---

## 3. The pure-function discipline (why phases 1–3 split logic from glue)

Network and DOM code can't be unit-tested cheaply. So **every decision is
isolated into a pure function** that takes plain data and returns plain data:

```js
// webhook-payload.js — pure: facts in, envelope out. No clock/IO except an
// injected `now`.
buildEventPayload(type, ctx) -> { schema, event, ts, book, position, pace, ... }

// webhook-formats.js — pure: canonical envelope -> endpoint-specific body.
formatPayload(format, envelope) -> { url?, headers?, body }

// reading-stats.js — pure core, IO at the edges:
applyEvent(stateObj, type, ctx) -> newStateObj      // pure reducer
estimateMinutesRemaining(wordsRemaining, wpm) -> number

// webhook-dispatcher.js — pure decisions, impure send:
shouldSend(endpoint, type, mode, lastSentMap, now) -> boolean   // filter+throttle
```

Keep these exported and dependency-free so `selftest.js` can import them under
Node. The impure shells (`dispatcher`, `telemetry`, `config`) stay thin.

---

## 4. Guardrails (full list in `WEBHOOKS.md`)

- **Fire-and-forget; never throw into a hot path.** Every `telemetry.emit` and
  every send is wrapped in try/catch inside the subsystem. A mode calling
  `emit()` must be safe even if no config, no network, no nothing.
- **Throttle chatty events** (`page.turned`, `session.heartbeat`,
  `rsvp.wpm_changed`) per endpoint. Defaults live in `webhook-events.js`.
- **One canonical position / word count.** Read `getCanonicalPosition()` and the
  mode's existing total-words; do not recount.
- **Persist with `safeSetItem`; read defensively** (every `JSON.parse` in a
  try/catch returning a default).
- **Opt-in & local-first.** Zero endpoints by default. `lifetime` block off by
  default per endpoint. A global pause switch. Strip nothing the user didn't
  agree to send.
- **`{ signal }` on every listener; clean up on teardown.** The dispatcher
  registers against the app-level lifetime, mode emits against the mode signal.
- **Idempotency key on every event**, so a queued retry never double-counts.

---

## 5. Shared helpers you will reuse (don't reimplement)

| Need | Use |
| --- | --- |
| Canonical position of the reader right now | each mode's `getCanonicalPosition()` → `{ href, ord, words, f }` |
| Book identity & metadata | the mode's `BookSession` (`session.title`, `.bookId`, `.format`, `.toc`) |
| Current chapter index/label | Reader `state.curChap` + `state.sectionLabels`; RSVP `state.chapters`/`currentIdx`; TTS `headingToc` walk (see `getTtsBookmarkContext`) |
| Total words (mode-agnostic) | Reader `state.doc.wsToToken.length`; RSVP `state.totalWords`; TTS `totalWords` |
| Live pace | RSVP `prefs.data.wpm` + `StatsTracker`; TTS `prefs.data.rate` |
| Fire an in-app event | `ReadingTelemetry.emit(type, modeCtx)` (Phase 3) — **never** `fetch` from a mode |
| Quota-safe write | `safeSetItem(key, value)` (`js/core/safe-storage.js`) |
| Stable per-day key | `new Date().toISOString().slice(0,10)` → `'YYYY-MM-DD'` (use local date — see Phase 1 §learning) |
| Add a pref/setting | [`CONTRIBUTING.md` §3](../../docs/CONTRIBUTING.md) |

---

## 6. After all six phases

- Update `README.md`: add a **Smart Home / Webhooks** feature blurb and a row in
  the docs table pointing at `docs/WEBHOOKS.md`.
- Confirm `docs/EVENT-CATALOG.md` matches the shipped payloads field-for-field
  (the catalogue is the contract dashboards build against — drift breaks them).
- Confirm the privacy section in `docs/WEBHOOKS.md` lists every field every event
  can send.
</content>
