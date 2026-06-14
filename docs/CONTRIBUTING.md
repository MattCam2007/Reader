# Contributing — Procedures & Dev Loop (`docs/CONTRIBUTING.md`)

The step-by-step procedures for working in this repo. Pair with
[`BEST-PRACTICES.md`](BEST-PRACTICES.md) (the invariants/learnings) and
[`TESTING.md`](TESTING.md) (the test harness).

---

## 1. What this project is (orientation in 30 seconds)

A **zero-build, offline-first, client-side reading PWA.** No bundler, no
transpile, no framework — native ES modules loaded straight by the browser. Open
`reader.html` and it runs. Three modes (Reader / RSVP / TTS) share one parsed
`BookSession`. See [`ARCHITECTURE.md`](ARCHITECTURE.md).

**Consequences for how you work:**
- Edit a `.js` file → reload the browser. That's the whole loop.
- No build step means **no TypeScript, no JSX, no import aliases** — use relative
  `../` imports with the `.js` extension, exactly like the existing code.
- Keep modules small and single-purpose; match the surrounding style (the codebase
  is consistent — read a neighbour before writing).

---

## 2. The dev loop

```sh
# 1. Serve locally (some browsers block ES modules over file://)
python3 -m http.server
#    → http://localhost:8000/reader.html

# 2. Edit a module under js/, reload the page.

# 3. Run the test suite before you commit (headless Chromium):
npm install                      # first time only
npx playwright install chromium  # first time only
node test/run-selftest.mjs       # == npm test  → must be green

# 4. Visual test report in a real browser, any time:
#    http://localhost:8000/reader.html?selftest=1
```

For stylus/pen work you also need a **real Android Galaxy device with an S Pen** —
synthetic events cover logic and wiring, but final acceptance is on hardware
(see each phase build-sheet's manual checklist).

---

## 3. Procedure: add a preference / setting

Prefs are declarative. To add one (e.g. a pen feature toggle):

1. **Default** — add the key to `DEFAULT_PREFS` in `js/core/constants.js` with a
   **safe default** (a value that cannot cause an accidental action).
2. **Wiring** — add a row to the `SETTINGS` table:
   ```js
   { seg: "myFeatureSeg", attr: "myattr", pref: "myFeature",
     repaginate: false, transform: v => v === "true" },
   ```
   (`repaginate: true` only if the change alters layout.) Copy an existing boolean
   row like `penSeg` verbatim.
3. **UI** — add the segmented-control markup with `id="myFeatureSeg"` to the
   settings screen (`js/settings/settings-screen.js` / reader template).
4. **Read it** at runtime via `state._prefs.data.myFeature`.
5. **Test** — assert the default in `selftest.js` (the prefs block already checks
   `DEFAULT_PREFS` shape).

No schema version bump is needed — additive prefs with safe defaults are
forward/backward compatible.

## 4. Procedure: add a per-book store

Mirror `js/core/highlights.js` / `js/core/bookmarks.js`:
- Key prefix `reader:<feature>:<bookId>`; one JSON array/object.
- `setBook(bookId)` loads; mutations call `safeSetItem` (quota-safe).
- Address content by **locator**, never a live Range (see BEST-PRACTICES §1.1).
- Add a round-trip assertion to `runLiveTests` in `selftest.js`.

## 5. Procedure: add an input/stylus behaviour

See [`INPUT.md`](INPUT.md) for the full map. In short:
1. Read the signal in the **pen branch** of `js/reader/input.js` (`pointer*`),
   never the touch handlers.
2. Pull the *decision* into a **pure function** in a small module → unit-testable.
3. Route the outcome through a **callback** (wired in `reader-app.js`) to the
   feature module (highlights, definition, pagination…). Don't couple `input.js`
   to those modules directly.
4. Gate UX changes behind a pref (Procedure 3) with a safe default.
5. Clean up every contact-scoped flag/class on **both** `pointerup` and
   `pointercancel`.

## 6. Procedure: add a test

[`TESTING.md`](TESTING.md) is the full guide. Minimum for any change:
- a **unit** assertion for new pure logic, and/or
- a **live** assertion in `runLiveTests` for wired behaviour,
- both via `assert(module, label, ok)` in `js/test/selftest.js`,
- `node test/run-selftest.mjs` green locally; CI runs it on every push/PR.

---

## 7. Git & PR discipline

- **One feature → one branch → one revertible PR.** Keep unrelated changes out.
- Branch off fresh `master`. For the S Pen work, develop on the feature branch the
  task assigns.
- **Do not open a PR unless explicitly asked.** Commit and push to the assigned
  branch; let the human open the PR.
- Commit messages: imperative, scoped, explain the *why* when non-obvious. One
  logical change per commit.
- Never push to a branch other than the one assigned without explicit permission.

---

## 8. Definition of done (every change)

- [ ] Behaviour change sits behind a pref with a safe default (if it alters UX).
- [ ] Addresses positions by **locator**; re-resolves after relayout.
- [ ] **Degrades to a no-op** without the hardware/API; finger + keyboard
      unchanged.
- [ ] **No new runtime/CDN dependency**; offline still works.
- [ ] Untrusted book content stays sanitized/inert.
- [ ] Unit + (where applicable) functional tests added; `node
      test/run-selftest.mjs` green.
- [ ] For an S Pen phase: the **measurable-better assertion** with its target
      number is present and green (`plans/spen-support.md` §3).
- [ ] Docs touched if behaviour or architecture changed (this dir + README table).

---

## 9. Where things live (map)

| Area | Path |
| --- | --- |
| Reader shell & wiring | `js/reader-app.js` |
| Paginated input (touch + pen) | `js/reader/input.js` |
| Selection / highlight render | `js/reader/selection.js`, `js/reader/highlight-render.js` |
| Highlight store | `js/core/highlights.js` |
| Word model & hit-testing | `js/model/doc-model.js`, `js/model/geometry.js`, `js/model/locator.js` |
| Position (canonical) | `js/core/position.js` |
| Prefs / settings table | `js/core/constants.js`, `js/settings/settings-screen.js` |
| Mode switching | `js/mode-switcher.js` |
| Tests | `js/test/selftest.js`, `test/run-selftest.mjs` |
| Plans (incl. S Pen) | `plans/`, `plans/spen/` |
| Developer docs | `docs/` |
