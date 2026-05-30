# Double-Swipe Animation Bug

## Symptom
When page-turning with the **slide** animation mode, the content visually appears to animate through **two pages** of distance instead of one. The user ends up on the **correct page** — only the animation is wrong. Fade and None modes work correctly.

The user described it as: "it swipes the right way at first, then it LOOKS like it swipes back" (earlier observation), then revised to: "the second swipe always appears to advance the page" — i.e., the visual distance covered is 2x what it should be.

## Relevant Code
- **`goTo(p, animate)`** in `reader.html` — sets CSS transition + transform on `.content`
- **`paginate()`** — computes `stride` (viewport width + column gap) and page count
- **Touch handlers** — `touchstart`, `touchmove`, `touchend` on viewport
- **Click handler** — with 600ms guard against touch+click double-fire
- **`handleTap(x)`** — calls `next()`/`prev()` based on tap zone

### The slide animation in goTo
```js
content.style.transition = "transform 240ms cubic-bezier(0.22,0.61,0.36,1)";
content.style.transform = "translate3d(" + (-(page * stride)) + "px,0,0)";
```

### Stride calculation in paginate
```js
const vpW = content.clientWidth;
content.style.columnWidth = vpW + "px";
content.style.columnGap = COLUMN_GAP + "px"; // 40
stride = vpW + COLUMN_GAP;
```

## What We Have Ruled Out

### Not a double goTo call
- Added an `animating` lock that blocks a second animated `goTo` during an in-progress slide (250ms timeout). **No change in behavior.** This confirms `goTo` is not being called twice.

### Not a touch+click double-fire
- The click handler checks `Date.now() - lastTouchEnd < 600` and returns early if a recent touchend occurred. This guard was already in place.

### Not touchstart interfering with the animation
- `touchstart` was unconditionally setting `content.style.transition = "none"` even for taps (no drag). We moved this to only fire in `touchmove` when a horizontal drag is decided. **No change in behavior.**

## Diagnostic logging (current state)
A `console.log` is in `goTo` that prints:
```
goTo: prevPage → newPage stride: N tx: -M
```
**Awaiting user console output** to determine:
1. Is goTo called once or multiple times per tap?
2. Is the page increment always +1?
3. Is `stride` a reasonable value (should be ~viewport width + 40)?

## Remaining Hypotheses

### 1. Stride mismatch
The computed `stride` may not match the actual CSS column layout distance. If `stride` is correct for positioning but the browser renders columns at a different width, the animation would visually cover the wrong distance. Check: does `stride` in the log match `content.clientWidth + 40`?

### 2. Two-column auto mode
If `prefs.columns === "auto"` and the viewport is wider than 700px, two-column mode engages. In two-column mode, `stride = vpW + COLUMN_GAP` (full viewport width + gap). If the column count or stride is miscalculated, the animation distance would be wrong. Check: is the user on a wide screen where auto-columns might engage?

### 3. CSS transition from-value
The slide transition animates from the element's **current computed transform** to the new value. If the current transform is wrong (e.g., still at a previous page's position because a prior `transition: none` prevented visual update), the animation distance would be off.

### 4. columnWidth vs actual rendered width
Setting `columnWidth = clientWidth` tells CSS to use that as the *ideal* column width. The browser may adjust it. If the actual rendered column width differs from `stride`, page positions would drift.

### 5. scrollWidth rounding
`total = Math.round(content.scrollWidth / stride)` — if scrollWidth isn't an exact multiple of stride, page positions at the edges could be off, though this wouldn't explain a consistent 2x animation distance.

## Next Steps
1. Get the console log output from the user
2. If goTo is called once with correct values, the issue is CSS/layout — investigate stride vs actual column width
3. If on a wide screen, test with columns forced to "1" to rule out two-column math
4. Consider using `getComputedStyle(content).transform` before and after to verify actual pixel positions
