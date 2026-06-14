# Best Practices, Procedures & Learnings

A working contributor's guide to **how this codebase wants to be changed**. The
other docs describe *what exists* (ARCHITECTURE, MODULES, DATA-FLOWS, STATE, CSS);
this one captures the *conventions, procedures, reminders, and hard-won learnings*
so a change lands cleanly the first time. Read it before adding a feature — the
Smart Home / MQTT integration ([`plans/smart-home-mqtt.md`](../plans/smart-home-mqtt.md))
was written to follow every rule here.

---

## 1. The non-negotiable invariants

These are load-bearing. Breaking one causes subtle, hard-to-trace bugs.

1. **No build step. Ever.** Plain ES modules, served as-is. No bundler, no
   transpile, no JSX, no TypeScript, no npm runtime deps. `package.json` exists
   only for the headless selftest. If a feature seems to "need" a build, it
   doesn't — vendor the lib instead (§4).
2. **One tokenisation rule.** All word counting goes through `splitWords` /
   `countWords` in `js/core/book-session.js`. Reader's doc-model, RSVP's
   `sectionsToText`, and TTS's `segmentContent` must agree word-for-word, or
   cross-mode position hand-off drifts and restores land pages off. A selftest
   asserts the three counts match — **don't bypass it**.
3. **Canonical position is the currency.** Navigation/persistence use the
   section-href-anchored **word ordinal** (`js/core/position.js`), not a
   fraction-of-book scalar. The fraction is for display only. New position-aware
   code uses `getCanonicalPosition()` / `applyCanonicalPosition()`.
4. **One parse, three modes.** `BookSession` (`js/core/book-session.js`) is built
   once and shared. Modes render it; they do **not** re-parse. The session owns
   image blob URLs and revokes them on `dispose()` — **modes must not revoke**.
5. **Listeners die with their mode.** Every `addEventListener` in a mode app uses
   the mode's `AbortController` `signal` (`addEventListener(..., { signal })`) so
   `teardown()` is leak-free. New listeners follow suit. App-lifetime singletons
   (across mode switches) are the exception and must be created in
   `js/mode-switcher.js`.
6. **Book content is untrusted.** EPUB/PDF text is sanitized (allowlist tags/attrs,
   no `innerHTML` of book data, no book CSS, no `javascript:` URLs). Never render
   book-derived strings as HTML. Settings/UI lookups are **scoped to the settings
   screen** (`byId` in `settings-screen.js`) because book element ids can shadow
   global ids (DOM clobbering).

---

## 2. Architecture conventions

- **Module layout:** `js/core/` = mode-agnostic infrastructure (events, prefs,
  state, position, storage, sessions). `js/model/` = doc model + geometry.
  `js/formats/` = format adapters behind a registry. `js/<mode>/` = per-mode
  pieces. `js/<mode>-app.js` = the mode shell (`init()` → handle with
  `teardown()`). `js/shared/` = cross-mode UI helpers. Put new mode-agnostic
  subsystems in their own `js/core/<feature>/` folder (the Smart Home module does
  this) so they stay self-contained and individually testable.
- **EventBus over ad-hoc callbacks** (`js/core/events.js`): `on()` returns an
  unsubscribe fn; `emit()` also fires `"*"` wildcard listeners. Each mode owns its
  bus — there is **no global cross-mode bus**. A subsystem that must span modes
  (like Smart Home) is a singleton that *subscribes to each mode's bus* at that
  mode's init, on the mode's signal.
- **Prefs are scoped** (`js/core/prefs.js`): one `PrefsManager` per scope
  (`general:`, `reader:`, `rsvp:`, `tts:`, and new `smart:`). Defaults live in
  `js/core/constants.js` (or the feature's own `constants.js`). `.set()` emits the
  key + `"change"`; persist with `.save()`. A new pref = add to the defaults object
  **and** a control in the right settings tab **and** an i18n label.
- **Capabilities, not format checks.** Code that varies by format reads
  `session.capabilities` (`js/formats/capabilities.js`), it doesn't branch on
  `format === 'pdf'`. Degrade gracefully when a capability is absent.
- **Feature detection, graceful fallback.** Optional web APIs (Highlight,
  Fullscreen, clipboard, SpeechSynthesis, and now **WebSocket/MQTT**) are detected
  and degrade silently when unavailable.

---

## 3. Settings & i18n procedure (do all four, every time)

Adding a user-facing setting is a **four-part** change. Miss one and it half-works:
1. **Default** → the scope's defaults object (e.g. `SMART_DEFAULTS`).
2. **Control** → `xTabHTML()` markup + `wireXTab()` handler in
   `js/settings/settings-screen.js` (mirror an existing tab; reuse `createPicker`
   from `js/shared/picker.js` and the `.sscreen-*` classes).
3. **i18n** → a key in **all** of `js/i18n/{en,fr,es,de}.js` (English value is an
   acceptable placeholder for the others — flag it in the PR).
4. **Apply** → the `onXChange` callback so the running app reacts live (and
   `prefs.save()` persists it).

New **tab**: add a `<button data-tab="...">` to the nav, a branch in `showTab()`,
and a `tab.<name>` i18n key. Remember the **language-change reload** keeps the open
tab via `consumePendingSettingsTab()`.

---

## 4. Vendoring a third-party library (the only way to add a dep)

Pattern, proven by `epub.js`, `jszip` (eager) and `pdf.js`, `libarchive.js`
(lazy):
1. Download a **pinned** version of the browser/UMD build into `vendor/`, with the
   **version in the filename** (`epub-0.3.93.min.js`, `mqtt-5.10.1.min.js`).
2. **Eager** (needed at boot): `<script defer src="vendor/...">` in `reader.html`.
   **Lazy** (only when a feature/format is used): inject the `<script>` at runtime
   behind a memoised promise (see format adapters' `loadLibs`; the Smart Home
   `mqtt-client.js` does the same). Prefer **lazy** so unused features cost 0 bytes.
3. **Service worker** (`sw.js`): eager libs go in the precache shell; lazy libs are
   cache-first on first use (don't precache — readers who never use them never
   download them). Keep the **version comment in `sw.js` in sync** and bump the
   cache version note when the asset list changes (see the cache-naming comment at
   the top of `sw.js` — GitHub Pages never substitutes `__COMMIT_HASH__`, so the
   stale-while-revalidate + version-prefix scheme is what saves returning users).
4. Record the version + license in the PR (and optionally `vendor/README.md`).
   Only vendor permissively-licensed libs (MIT/BSD/Apache).

---

## 5. Performance reminders

- **Page turns are paint-bound.** The windowed renderer attaches one `.chap` at a
  time (default for paginated layout above `WINDOW_MIN_WORDS`). Don't force
  whole-book layout. Heavy work goes to idle time (see `PageCounter`,
  `js/core/page-cache.js`, `docs/PERFORMANCE.md`).
- **Throttle high-frequency emitters.** Page turns, RSVP word batches, TTS sentence
  boundaries can fire many times a second. Anything that does I/O (storage, MQTT
  publish) off these must throttle/debounce. Existing debounce constants live in
  `js/core/constants.js` (`SAVE_DEBOUNCE_MS`, `RESIZE_DEBOUNCE_MS`, …); follow that
  convention (Smart Home adds `minProgressIntervalMs`).
- **Measure before/after** with `js/core/perf.js` (`perf.mark`, `perf.timeAsync`).
- **localStorage is synchronous** — keep writes small and debounced; never write on
  every frame/word.

---

## 6. Security & privacy checklist

- Treat all book content as hostile (§1.6). Sanitiser changes get extra scrutiny.
- **No secrets in the repo** (broker URLs, tokens, credentials). Tests never touch
  the network — mock external clients.
- User-provided credentials (e.g. MQTT) live in `localStorage` **plaintext** —
  unavoidable for a static app. Mitigate with UI warnings + least-privilege
  guidance; never log them.
- Prefer encrypted transports (`wss://`, `https://`) beyond localhost.
- Publishing reading data is a **privacy surface** — features that do it are
  opt-in, off by default, and documented (what is sent, to where).
- If a CSP is ever added, remember outbound needs: `connect-src` for `ws:`/`wss:`,
  CDN origins for lazy format libs.

---

## 7. Testing procedure

- **Selftest is the regression net.** `js/test/selftest.js`, run in-browser
  (`reader.html?selftest=1`) and headlessly (`node test/run-selftest.mjs`, also in
  CI). Add `assert(...)`-style tests in the same style for new logic.
- **Test pure functions, not sockets/DOM.** Extract logic into pure functions
  (payload builders, stats math, topic builders) and test those. For external
  clients (MQTT), inject a **mock** that records calls — never open a real
  connection in tests, so CI stays hermetic.
- **What the selftest must keep proving:** cross-mode word-count agreement,
  canonical position round-trips, windowed boundaries, scroll restore. Don't add a
  feature that can silently break these without a covering assertion.
- **Manual verification** still matters for anything UI/network. Document the exact
  manual recipe in the feature's plan/reference (the Smart Home doc has a
  Mosquitto + `mosquitto_sub` recipe).

---

## 8. Git & delivery procedure

- Develop on the assigned feature branch; **commit in logical, reviewable steps**
  (one concern per commit), not one mega-commit.
- Push with `git push -u origin <branch>`; retry network failures with backoff.
- **Don't open a PR unless asked.**
- Update docs **in the same change** as the code: if event names/payloads change,
  update `docs/SMART-HOME.md`; if a new subsystem lands, link it from `README.md`'s
  developer-docs table and add a `docs/` entry.
- Keep new code's **comment density and idiom matching the surrounding file** — this
  codebase favours explanatory "why" comments on non-obvious decisions (see the
  long comments in `state.js`, `sw.js`, `book-session.js`). Match that.

---

## 9. Learnings (traps already hit — don't repeat them)

- **Browsers can't do raw MQTT/TCP.** MQTT from a web page is WebSockets-only;
  default to the broker's WS port (9001), and `wss://` on HTTPS pages. (See
  `docs/SMART-HOME.md` §"hard constraint".)
- **DOM clobbering:** book content is in the DOM before UI; a book element with
  `id="theme"` would shadow a control. Always scope UI queries to their container
  (`byId` in the settings screen) — never bare `document.getElementById` for
  controls that coexist with book content.
- **Stale service-worker caches:** `__COMMIT_HASH__` is never substituted on GitHub
  Pages, so cache names can't rotate per deploy. The app relies on
  stale-while-revalidate + a manually-bumped cache prefix. When you move/rename a
  module, returning users can get a mix of old/new code whose imports 404 — bump
  the cache note and keep modules importable.
- **Fraction drift:** using fraction-of-book for navigation (instead of the word
  ordinal) caused "I lost my place" reports. Always prefer the canonical position.
- **Viewport reflow before resize event:** mobile chrome collapse reflows the DOM
  *before* the resize event fires, so the live page number is stale during
  relayout — that's why Reader caches a stable anchor (`state._lastPos`). If you
  read geometry around a resize, beware the same hazard.
- **Unique client identity matters for stateful external services:** a non-unique
  MQTT `clientId` makes the broker kick the older session in a flap loop. Generate
  + persist a random id (`smart:deviceId`), reuse it.
- **Retained vs transient:** dashboards that connect *after* an event see nothing
  unless the value is published **retained**. Publish current state retained;
  publish happenings as transient events.
</content>
