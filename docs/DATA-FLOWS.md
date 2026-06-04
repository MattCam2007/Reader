# Data Flows

Step-by-step traces of how data moves through the application for every major operation. Understanding these flows is the fastest way to orient yourself in the codebase when debugging or adding features.

---

## 1. Application Boot

```
reader.html
  └─ <script type="module" src="js/mode-switcher.js">
```

**`mode-switcher.js` top-level execution (no function call — module-level code):**

1. Parse URL params: `new URLSearchParams(location.search)`
2. Determine initial mode:
   ```js
   const initialMode = modeParam === 'rsvp' ? 'rsvp'
                      : modeParam === 'tts'  ? 'tts'
                      : 'read';
   ```
3. Call `switchMode(initialMode)`

**`switchMode(targetMode, posInfo?)`:**

1. Close settings screen if open (idempotent)
2. If `currentHandle` exists, call `currentHandle.teardown()` (no-op on first boot)
3. If `currentController` exists, call `currentController.abort()`
4. Call `clearBodyClasses()` — removes all mode/theme classes from `document.body`
5. Clear `#app` innerHTML
6. Update URL: `url.searchParams.set('mode', targetMode)` + `history.replaceState`
7. Create new `AbortController`, extract `signal`
8. Branch on `targetMode`:

   **'rsvp':**
   ```js
   document.body.classList.add('rsvp', 'paused')
   appEl.innerHTML = rsvpTemplate()
   mod = await import('./rsvp-app.js')
   currentHandle = mod.init({ signal, onModeSwitch, onBookLoaded })
   ```

   **'tts':**
   ```js
   document.body.classList.add('tts')
   appEl.innerHTML = ttsTemplate()
   mod = await import('./tts-app.js')
   currentHandle = mod.init({ signal, onModeSwitch, onBookLoaded })
   ```

   **'read' (default):**
   ```js
   document.body.classList.add('chrome-hidden')
   appEl.innerHTML = readerTemplate()
   mod = await import('./reader-app.js')
   currentHandle = mod.init({ signal, onModeSwitch, onBookLoaded })
   ```

9. Set `currentMode = targetMode`
10. If `posInfo && cachedSession`: call `loadFromSession(cachedSession, posInfo.pos)`. The cached **`BookSession`** (already parsed + extracted by whichever mode loaded first) is reused, so the switch does **no re-parse / re-extract** — only render + paginate. The position is passed *into* the load; `loadFromSession` only resolves once the target mode has finished laying out (Reader/TTS paginate/segment inside a rAF) **and** applied the position. There is no separate rAF + `setTimeout(100ms)` seek and no second restore from localStorage — a single applier runs after layout, so the handoff is deterministic.

---

## 2. Loading an EPUB File

The mode-agnostic parse + extract + image-resolve runs **once** in
`BookSession.fromBuffer` (`core/book-session.js`); each mode then renders from
the session. RSVP derives its plain-text stream from `session.sections` rather
than running a separate extraction.

### 2a. File picker / drag-and-drop

```
User action
  → File input change OR dragover/drop event
  → reader-app.js: loadEpub(file: File)
    → file.arrayBuffer()
    → BookSession.fromBuffer(buffer, file.name, urlId)
    → loadFromSession(session)
```

### 2b. URL parameter (`?src=`)

```
reader-app.js init()
  → urlParams.get('src') !== null
  → fetch(src) → response.blob() → File
  → loadEpub(file)  → BookSession.fromBuffer → loadFromSession(session)
```

### 2c. `BookSession.fromBuffer(...)` then `loadFromSession(session)`

```
BookSession.fromBuffer(buffer, fileName, urlId)   [runs ONCE per book]
  │
  ├─ JSZip.loadAsync(buffer)           CDN: parse ZIP archive
  │
  ├─ epub.js: ePub(buffer)             CDN: parse OPF/NCX/NAV metadata
  │
  ├─ epub/toc.js: flattenToc(nav)      Read navigation → flat TocEntry[]
  │
  ├─ epub/extractor.js: extractSections(book)
  │      └─ For each spine item:
  │           spine item load()   → XHTML document
  │           Walk DOM with BLOCK_SEL/SKIP_SEL
  │           Build safe block frags → Section { blocks, href }
  │
  ├─ epub/images.js: resolveImageUrls(allImgUrls, book)
  │      └─ Resolve relative img src → blob: URLs (baked onto template frags)
  │
  ├─ derive bookId/title; book.destroy()
  └─ return BookSession { sections, toc, bookId, title, blobUrls }

loadFromSession(session, pos)         [per mode; re-run on every mode switch]
  │
  ├─ onBookLoaded({ session })
  │    → mode-switcher.js caches the session (disposes the previous one's blobs
  │      only if it's a different book)
  │
  ├─ renderBook(session.sections)
  │    └─ Build DOM:
  │         content.innerHTML = ''
  │         For each section:
  │           div.chap (data-href=href)
  │             For each block html:
  │               el.blk (inner HTML or textContent)
  │
  └─ Post-render:
       model/doc-model.js: buildDocModel(state, content)
       reader/chapters.js: buildChapterIndex(content)
       reader/pagination.js: paginate()
       core/storage.js: restorePos(...)
       epub/toc.js: renderToc(entries)   → fill TOC drawer
```

---

## 3. Paginated Reader — Page Turn Flow

### 3a. User swipes or taps

```
reader/input.js
  touchstart → record (startX, startY, startTime)
  touchend   → compute (deltaX, deltaY)
              → if |deltaX| > SWIPE_THRESHOLD and |deltaX| > |deltaY|:
                  swipe detected
                  deltaX < 0 → nextPage()
                  deltaX > 0 → prevPage()
              → else: classify as tap
                  x / viewportWidth < TAP_ZONE_LEFT  → prevPage()
                  x / viewportWidth > TAP_ZONE_RIGHT → nextPage()
                  otherwise                          → toggleChrome()
```

### 3b. `nextPage()` / `prevPage()`

```
reader-app.js: nextPage()
  │
  ├─ state.page = Math.min(state.page + 1, state.total - 1)
  │
  ├─ reader/pagination.js: goToPage(state.page)
  │    └─ content.style.transform = `translateX(${-state.page * state.stride}px)`
  │       (CSS transition animates the slide)
  │
  ├─ reader/chrome.js: update()
  │    └─ Find current chapter (binary search over chapters[] by word index)
  │    └─ Update topbar title, page counter, progress bar
  │
  └─ core/storage.js: savePos(getCanonicalPosition)
       └─ Debounced 500ms
       └─ pos = buildPosition(readerSections(), totalWords, firstWordOnPage)
       └─ localStorage.setItem('book:pos:{bookId}', JSON.stringify(pos))
```

---

## 4. Position Encoding and Restoration

Position is stored as a **canonical, mode-independent** object (`js/core/position.js`) anchored to the section's stable spine href and a word ordinal. All three modes write and read the same `book:pos:{bookId}` key. See [STATE.md → Canonical Position System](STATE.md#canonical-position-system).

### 4a. Encoding (save)

```
core/position.js: buildPosition(sections, totalWords, globalOrd, wordAt?)
  │  sections: [{ href, wordStart, wordCount }] in reading order
  ├─ find the section containing globalOrd
  ├─ wordInSec = globalOrd - section.wordStart
  ├─ t = normalised snippet of SNIPPET_WORDS words from globalOrd (via wordAt)
  └─ return { v, href, wordInSec, secWords, ord: globalOrd, words: totalWords, f, t }
```

The source mode may also set `pos.hl` = how many words the Reader should
highlight on arrival (RSVP sets 1; TTS sets the current sentence's word count).
The Reader paints a `reader-resume` CSS highlight over those words after
seeking, and clears it on the next page turn / scroll.

Each mode supplies its own `sections` table, `globalOrd`, and a `wordAt(ord)`
that returns the raw word string at a global ordinal:
- Reader: `state.doc.sections` (whitespace-word counts), `currentWsOrdinal()`, `wsWordText`
- RSVP: `rsvpSections()`, `currentOrdinal()`, `tokens[wordTokenIndices[o]]`
- TTS: `segmentContent()` section table, `sentences[idx].wordOffset`, `ttsWords[o]`

> **Word counting must match across modes.** All three count *whitespace-delimited*
> words (the Reader bridges its punctuation-split render tokens to whitespace
> words via `doc.tokenToWs`/`doc.wsToToken`). Matching counts make step 1 below
> exact; the snippet (`t`) is the final exact snap for any residual.

### 4b. Decoding (restore)

```
core/position.js: resolvePosition(pos, sections, totalWords, wordAt?) → global word ordinal
  │
  ├─ 1. Match section by stable href; reconcile wordInSec if this mode counted
  │       that section's words differently  → section.wordStart + wordInSec'
  ├─ 2. Else scale the global ordinal:  round(pos.ord * (words-1)/(pos.words-1))
  ├─ 3. Else the fraction fallback:     round(pos.f * (words-1))
  │                                     (also reads the legacy { f } format)
  └─ 4. Text snap (if pos.t and wordAt): search ±REFINE_WINDOW words around the
        prediction for the snippet; require a 60% word-match and break ties
        toward the prediction → land on the exact word.
```

### 4c. Position restoration on book load

```
core/storage.js: restorePos(applyCanonicalPosition)
  │
  ├─ pos = JSON.parse(localStorage.getItem('book:pos:{bookId}'))
  └─ applyCanonicalPosition(pos):
       wi = resolvePosition(pos, readerSections(), totalWords)
       isScrollMode ? pagination.scrollToWord(wi)
                    : pagination.goTo(pageOfWord(wi))
```

> The Reader's `{ s, b, w }` locator (`model/locator.js`, `toLocator`/`resolveLocator`) is still used internally to preserve position across live re-pagination and for search-result jumps, but is no longer persisted.

---

## 5. RSVP Playback Loop

### 5a. Initial tokenization (once, after book load)

```
rsvp-app.js: loadPlainText(sections)
  │
  └─ rsvp/tokenizer.js: tokenize(sections)
       │
       ├─ For each section (chapter):
       │    Split text by '\n\n' → paragraphs
       │    For each paragraph:
       │      Split by whitespace → words
       │      For each word:
       │        orpIdx = orpIndex(word)     ← where to align the eye
       │        isSentenceStart = (prev word ended with . ! ?)
       │        push { kind:'word', text, orpIdx, isSentenceStart }
       │      push { kind:'break' }         ← paragraph separator
       │
       ├─ Build parallel indices:
       │    wordTokenIndices[]    ← indices of word tokens only
       │    tokenToWordOrdinal[]  ← maps any token → word count up to that point
       │    sentenceStarts[]      ← token indices of sentence-starting words
       │    paragraphs[]          ← [startTokenIdx, endTokenIdx] per paragraph
       │
       └─ chapters[] = [{ title, tokenIdx }] per spine section
```

### 5b. Play/pause

```
User: tap or Space
  │
  └─ rsvp-app.js: togglePlay()
       │
       ├─ if paused:
       │    state.rampRemaining = RAMP_WORDS   ← arm ease-in
       │    playback.js: PlaybackEngine.play()
       │      → countdown sequence (3, 2, 1) via setTimeout
       │      → after countdown: _tick()
       │
       └─ if playing:
            playback.js: PlaybackEngine.pause()
              → clearTimeout(_tickTimer)
              → navigation.js: rewindWords(state, REWIND_WORDS)
              → state.playState = 'paused'
```

### 5c. Playback tick loop

```
PlaybackEngine._tick()
  │
  ├─ Collect chunk:
  │    chunkTokens = []
  │    for i in range(chunkSize):
  │      advance state.currentIdx past any 'break' tokens
  │      push next word token to chunkTokens
  │      if next token is 'break': stop chunk early (paragraph pause)
  │
  ├─ Emit 'renderChunk' → rsvp/display.js: RsvpDisplay.renderChunk(chunkTokens)
  │    └─ For each token:
  │         split text at orpIdx:
  │           pre = text.slice(0, orpIdx)
  │           orp = text[orpIdx]
  │           post = text.slice(orpIdx + 1)
  │         render: <span class="pre">pre</span>
  │                 <span class="orp">orp</span>
  │                 <span class="post">post</span>
  │
  ├─ Calculate duration:
  │    lastToken = chunkTokens[chunkTokens.length - 1]
  │    baseMs = 60000 / wpm
  │    mult = timing.js: durationMultiplier(lastToken)
  │    factor = timing.js: rampSpeedFactor(state.rampRemaining)
  │    if isParagraphBreak: mult *= PARA_MULT
  │    duration = baseMs * mult / factor
  │
  ├─ Decrement state.rampRemaining (min 0)
  │
  ├─ Update stats: stats.js: StatsTracker.onTick(wordCount, duration)
  ├─ Check training: training.js: TrainingManager.onWordsRead(totalWordsRead)
  │
  ├─ Advance state.currentIdx by chunkTokens.length
  │
  └─ Schedule next tick: _tickTimer = setTimeout(_tick, duration)
```

---

## 6. TTS Playback Flow

### 6a. Content segmentation (once, after book load)

```
tts-app.js: segmentContent(content)
  │
  └─ Walk all .blk elements in .chap elements
       For each block:
         Split textContent into sentences using period/!/? + space rules
         For each sentence:
           Wrap text node slice in <span class="tts-sent" data-idx="N">
  → All sentences are now addressable DOM elements
```

### 6b. Playing a sentence

```
tts-app.js: playSentence(idx)
  │
  ├─ tts/highlighter.js: TtsHighlighter.highlightSentence(sentenceEl)
  │    → sentenceEl.classList.add('tts-active')
  │    → sentenceEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
  │
  └─ tts/engine.js: TtsEngine.speak(sentence.textContent, onBoundary, onEnd)
       │
       ├─ utterance = new SpeechSynthesisUtterance(text)
       ├─ utterance.voice = selectedVoice
       ├─ utterance.rate = selectedRate
       ├─ utterance.onboundary = (e) →
       │    if e.name === 'word':
       │      tts/highlighter.js: TtsHighlighter.highlightWord(sentenceEl,
       │                                          e.charIndex, e.charLength)
       │
       └─ utterance.onend = () →
            tts/highlighter.js: TtsHighlighter.clearHighlight()
            playSentence(idx + 1)   ← advance to next sentence
```

### 6c. Position save (TTS)

```
On pause / sentence change / teardown:
  pos = getCanonicalPosition()   ← from sentences[currentSentenceIdx].wordOffset
  localStorage.setItem('book:pos:{bookId}', JSON.stringify(pos))
```

---

## 7. Mode Switching (with Book Transfer)

User taps the mode-switch button while reading. The current mode hands off its exact **canonical position** (section href + word ordinal), not a rounded fraction.

```
reader-app.js: mode-switch button click
  → onModeSwitch('rsvp', { pos: getCanonicalPosition(), bookId })
    → mode-switcher.js: switchMode('rsvp', { pos, bookId })
```

**In mode-switcher.js:**

```
1. closeSettingsScreen()
2. currentHandle.teardown()        ← reader-app cleans up timers, listeners
3. currentController.abort()       ← abort signal kills any in-flight fetches
4. clearBodyClasses()              ← remove 'chrome-hidden' etc. from body
5. appEl.innerHTML = ''            ← clear the DOM
6. currentMode = null

7. Update URL: ?mode=rsvp

8. currentController = new AbortController()
9. document.body.classList.add('rsvp', 'paused')
10. appEl.innerHTML = rsvpTemplate()
11. mod = await import('./rsvp-app.js')
12. currentHandle = mod.init({ signal, onModeSwitch, onBookLoaded })

13. cachedBook exists (was stored when book was first loaded):
    // Position is handed in; the promise resolves only after layout + seek.
    await currentHandle.loadFromBuffer(
      cachedBook.buffer.slice(0), cachedBook.fileName, posInfo.pos)
```

**Why no `setTimeout(100ms)` guess any more:** `loadFromBuffer` resolved *before* the target mode finished paginating (Reader/TTS do that work inside a `requestAnimationFrame` that fires after the awaited promise). The old code waited a fixed 100 ms and then seeked, racing against pagination, and *also* let the app restore from localStorage — two appliers with different rounding, nondeterministic last-writer, landing off by a page. Now the awaited `loadFromBuffer` only resolves once paginate/segment **and** the seek have run, and the handed-off position is the single source of truth (the localStorage restore is skipped when a position is passed in).

**In rsvp-app.js `applyPosition(pos)`:**

```
applyPosition(pos)
  → ord = resolvePosition(pos, rsvpSections(), state.totalWords)  ← global word ordinal
  → playback.seekTo(state.ordinalToIdx(ord))
  → display.renderChunk([tokens[...]])   ← show current word
```

---

## 8. Settings Change Flow

User opens settings and changes the font from Serif to Sans.

```
settings/settings-screen.js
  → user taps 'Sans' segment button
  → prefs.set('font', 'sans')
```

**In PrefsManager.set():**

```
prefs.set('font', 'sans')
  → this.data.font = 'sans'
  → emit('font', 'sans', 'serif')    ← fires all 'font' listeners
  → emit('change', 'font', 'sans', 'serif')
```

**In reader-app.js (subscribed to prefs):**

```
prefs.on('font', (newFont) => {
  const stack = FONT_MAP[newFont]
  document.documentElement.style.setProperty('--reader-font', stack)
  repaginate()   ← font change may alter line breaks → recalculate pages
})
```

**`repaginate()`:**

```
repaginate()
  → firstWordOnCurrentPage = getFirstWordOnPage(state, state.page)
  → pagination.paginateQuick()
       → detach content from DOM
       → measure content.scrollWidth
       → calculate new state.total and state.stride
       → reattach content
  → goToWord(firstWordOnCurrentPage)   ← restore position in new layout
  → chrome.update()                    ← refresh page counter
  → storage.savePos(...)               ← save new position
```

**Theme change (no repagination):**

```
prefs.set('theme', 'sepia')
  → emit('theme', 'sepia', 'dark')
  → reader-app.js listener:
       document.body.classList.remove(...ALL_THEME_NAMES.map(t => 'theme-' + t))
       document.body.classList.add('theme-sepia')
       const metaThemeColor = document.querySelector('meta[name=theme-color]')
       metaThemeColor.content = THEME_COLORS.sepia
```

---

## 9. Full-Text Search Flow

```
User: types "Darcy" in search input
  → search/search.js: SearchManager.search('darcy')
```

**`search(query)` internals:**

```
1. q = 'darcy' (lowercased)
2. text = state.doc.text   ← full concatenated text (all words, spaces between)
3. Find all occurrences of q in text using lastIndexOf loop:
     positions = []
     let i = -1
     while ((i = text.indexOf(q, i + 1)) !== -1) positions.push(i)
4. For each position:
     Binary search doc.wordCharStart[] to find which word index owns that char offset
     That word index is a search hit
5. Build Range objects:
     For each hit wordIndex:
       word = state.doc.words[wordIndex]
       range = new Range()
       range.setStart(word.node, word.start)
       range.setEnd(word.node, word.end)
       ranges.push(range)
6. Register with CSS Highlight API:
     CSS.highlights.set('reader-search', new Highlight(...ranges))
     (CSS rule: ::highlight(reader-search) { background: yellow })
7. Build result list:
     For each hit, extract 5 words of context before and after
     Return { hits, snippets }
```

**Navigating to a result:**

```
User taps result #3
  → search.navigateToHit(2)   ← 0-based
  → pagination.goToWord(hits[2].wordIndex)
       → getPageForWord(state, wordIndex)   ← which page holds this word?
       → goToPage(pageN)
```

---

## 10. Bookmark Add Flow

```
User: taps bookmark button in toolbar
  │
  ├─ reader-app.js: addBookmark()
  │    → currentLocator = toLocator(state, getFirstWordOnPage(state, state.page))
  │    → fraction = state.page / (state.total - 1)
  │    → bookmarks.add(currentLocator, fraction, optionalNote)
  │         → push new bookmark object with UUID and timestamp
  │         → bookmarks.save()
  │              → localStorage.setItem('reader:bookmarks:{bookId}', JSON.stringify([...]))
  │
  └─ Update bookmark panel UI (if open)
       → bookmarks/panel.js: renderBookmarks(bookmarks.getAll(), onJump, onDelete)
```

**Jumping to a bookmark:**

```
User: taps a bookmark in the panel
  → onJump(bookmark)
  → reader-app.js: jumpToBookmark(bookmark)
       → wi = resolveLocator(state, bookmark.loc)
       → if wi >= 0: goToWord(wi)
       → else: goToPage(Math.round(bookmark.fraction * (total - 1)))
```

---

## 11. Resize / Repagination Flow

Window resize events are common (rotation, browser resize, font scaling). The app must repaginate while preserving the reading position.

```
window resize event
  → debounce 150ms (RESIZE_DEBOUNCE_MS)
  → reader-app.js: onResize()
       │
       ├─ Capture current word: firstWord = getFirstWordOnPage(state, state.page)
       │
       ├─ pagination.js: paginateQuick()
       │    → Re-measure column layout
       │    → Update state.total, state.stride
       │
       ├─ goToWord(firstWord)
       │    → page = getPageForWord(state, firstWord)
       │    → goToPage(page)
       │
       └─ chrome.update()
```

---

## 12. Document Model Build Flow

Called once after the book DOM is rendered and after every content change.

```
model/doc-model.js: buildDocModel(state, content)
  │
  ├─ Reset: state.doc.words=[], blocks=[], sections=[], text='', wordCharStart=[]
  ├─ state.sectionBlockStart = []
  │
  ├─ Query all .chap elements (one per EPUB spine item):
  │    For each chap (si = section index):
  │      sections.push({ href, el, wordStart: words.length, wordEnd: words.length })
  │      sectionBlockStart.push(blocks.length)
  │
  │      Query all .blk elements within chap:
  │        For each blk (bi = block index):
  │          blocks.push({ el, type, section: si, wordStart: words.length, wordEnd })
  │
  │          TreeWalker over blk (text nodes only):
  │            For each text node:
  │              Regex /\S+/g to find all non-whitespace tokens:
  │                For each match (word):
  │                  wordCharStart.push(charOffset)
  │                  words.push({ node, start, end, block: bi, section: si })
  │                  charOffset += word.length + 1
  │
  │          blocks[bi].wordEnd = words.length
  │      sections[si].wordEnd = words.length
  │
  └─ state.doc.text = words joined by ' '
```

After this runs, every word in the book has a stable index that can be encoded as a locator, searched in `doc.text`, highlighted via CSS ranges, or spoken via TTS.
