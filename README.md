# RSVP Reader

A minimal, single-file speed reader. It uses **RSVP** (Rapid Serial Visual
Presentation) to flash one word at a time in a fixed position, so your eyes
stop hunting across lines and you can read faster. Each word is aligned on its
**Optimal Recognition Point (ORP)** — the highlighted letter your eye should
anchor on.

The whole app is a single `index.html` with no build step. Open it in a browser
and start reading. It ships with the opening of *Pride and Prejudice* as sample
text, and you can load any `.epub` file to read your own books.

## Features

- **One-word RSVP display** with a red ORP letter and alignment guides above,
  below, and to the side of the focus point.
- **Adjustable speed** from 100 to 800 WPM via a scrollable picker.
- **Smart pacing** that slows down for long words and pauses longer at commas,
  semicolons, colons, sentence endings, and paragraph breaks.
- **Ease-in on resume** — playback ramps from half speed back up to full over
  the first few words so you can re-orient.
- **Tap / Space to pause**, which opens a full-screen reading view showing the
  surrounding paragraphs with the current word highlighted.
- **Tap any word** in the paused view to jump the reading position there.
- **EPUB support** — load a local `.epub` and the text is extracted from the
  whole book in reading order.
- **Dark, mobile-friendly UI** with safe-area insets and touch-friendly
  controls.

## Usage

Because the EPUB libraries are loaded from a CDN, just open the file in a
browser:

1. Open `index.html` in any modern browser (or serve the folder and visit it).
2. Reading starts automatically with the sample text.
3. Use the bottom pickers to set **WPM** (reading speed) and **LENGTH**
   (how aggressively long words are slowed down).
4. **Tap the screen** or press **Space** to pause and see the surrounding text;
   tap a word to move there, then press **Resume** (or **Space**) to continue.
5. Tap **Open EPUB** to load your own `.epub` file.

If you prefer to run it from a local server:

```sh
python3 -m http.server
# then visit http://localhost:8000
```

## Controls

| Action            | Control                          |
| ----------------- | -------------------------------- |
| Pause / resume    | Tap the screen, or press `Space` |
| Set reading speed | Scroll the **WPM** picker        |
| Tune long-word pacing | Scroll the **LENGTH** picker |
| Jump to a word    | Tap a word in the paused view    |
| Load a book       | **Open EPUB** button             |

## How it works

- **Tokenizing** splits the text into words and tracks paragraph boundaries so
  the paused "context" view can rebuild readable paragraphs.
- **ORP** is chosen by word length, and the word is rendered in three pieces
  (before / ORP / after) so the focus letter always lands on the guide line.
- **Timing** starts from the base WPM interval and multiplies it for word
  length and trailing punctuation, with an extra pause on paragraph breaks.
- **EPUB parsing** uses [epub.js](https://github.com/futurepress/epub.js) and
  [JSZip](https://stuk.github.io/jszip/) (both via CDN) to walk each spine item
  and pull out clean, block-aware text.

## Dependencies

Loaded from a CDN at runtime — no install or build required:

- [epub.js](https://github.com/futurepress/epub.js)
- [JSZip](https://stuk.github.io/jszip/)

## License

No license file is currently included. Add one if you intend to share or
distribute this project.
