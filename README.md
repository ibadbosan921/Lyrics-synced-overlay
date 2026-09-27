# Synced Lyrics Overlay

A Chrome extension (Manifest V3) that plays your local audio files in the
background and shows synced, animated lyrics as a caption overlay on
whichever tab you're currently looking at — like a Reels or TikTok caption,
running on top of any website you browse.

Built by [Ibad Bosan](https://github.com/ibadbosan921). Pairs naturally with
[Song-to-LRC-converter](https://github.com/ibadbosan921/Song-to-LRC-converter)
for generating the `.lrc` lyric files this extension reads.

## Features

- **Local playlist.** Upload `.mp3` / `.wav` files together with matching
  `.lrc` lyric files; they're paired automatically by filename and stored in
  IndexedDB, so they're still there the next time you open Chrome.
- **Keeps playing across tabs.** Audio runs in an offscreen document, so it
  doesn't stop when you switch tabs, minimize the window, or close the popup.
- **Follows your active tab.** The caption overlay appears only on the tab
  you're currently viewing, and moves there ~3 seconds after you switch, so
  it never sits on more than one tab at once.
- **Non-interactive by design.** The overlay never captures clicks — it sits
  in a closed shadow root with `pointer-events: none`, so it can't interfere
  with the page underneath or be styled by it.
- **Three caption styles.**
  - *Classic line* — the current line (and optionally the next line beneath
    it), karaoke-style.
  - *Word pop* — one big word at a time, popping in and out, Instagram/TikTok
    caption style.
  - *Vertical stack* — words stack top to bottom in a single column, one word
    per line.
- **15 animation presets** — Fade, Zoom In/Out, Slide (4 directions), Bounce,
  Typewriter, Fade+Slide, Fade+Zoom, Wave, Glow Pulse, Blur In, and Flip —
  applied globally, not per song.
- **4 bundled display fonts** (Poppins, Montserrat, Anton, Caveat) embedded
  directly in the extension so they render identically on every site, plus
  a handful of system fonts.
- **Full styling control** — size, weight, style, color, outline, shadow,
  background, alignment, line spacing, and a draggable position pad to place
  the caption anywhere on screen — all live in the options page.
- **Timing offset** to nudge lyrics earlier or later if your `.lrc` file is a
  touch out of sync.

## Screenshots

_Add your own screenshots here after loading the extension — a shot of the
popup playlist, the options page, and the overlay in action on a site._

```
docs/screenshot-popup.png
docs/screenshot-options.png
docs/screenshot-overlay.png
```

## Installation

This extension isn't on the Chrome Web Store — you load it directly from
this repository ("unpacked"), which takes about a minute.

1. **Download the code.**
   - Clone it:
     ```bash
     git clone https://github.com/ibadbosan921/synced-lyrics-overlay.git
     ```
   - Or click **Code → Download ZIP** on GitHub and unzip it somewhere on
     your computer.
2. **Open Chrome's extensions page.** Go to `chrome://extensions` in your
   address bar.
3. **Turn on Developer mode.** It's a toggle in the top-right corner of that
   page.
4. **Click "Load unpacked."** A file picker opens.
5. **Select the project folder** — the one containing `manifest.json`
   (`synced-lyrics-overlay`, or whatever you renamed it to).
6. **Approve the permission prompt.** Chrome will ask you to allow the
   extension to run on all sites. This is required so the overlay can follow
   you to whichever tab is active — see [Permissions](#permissions) below.
7. **Pin it.** Click the puzzle-piece icon in Chrome's toolbar and pin
   "Synced Lyrics Overlay" so it's always one click away.

That's it — no build step, no `npm install`. It's plain HTML/CSS/JS.

## How to use it

1. Click the extension icon to open the popup.
2. Click **Add songs** and, in the file picker, select your audio files
   together with their matching `.lrc` files (e.g. `song.mp3` and
   `song.lrc` — same name, different extension).
3. Click a song's play button. Audio starts, and the caption overlay appears
   on your current tab.
4. Browse normally. Switch tabs — after about 3 seconds, the captions follow
   you to the new tab.
5. Click the gear icon (or right-click the extension icon → **Options**) to
   open the settings page. Everything there — caption style, font,
   animation, color, position — updates the overlay live.
6. Drag inside the preview frame on the options page (or use the Top /
   Center / Bottom buttons) to place the captions exactly where you want
   them on screen.

## Updating your lyric files

Plain LRC format only: `[mm:ss.xx]Your lyric line here`. No word-level
timing tags. If you need to generate `.lrc` files from scratch, check out
[Song-to-LRC-converter](https://github.com/ibadbosan921/Song-to-LRC-converter).

## Project structure

```
synced-lyrics-overlay/
├── manifest.json          Manifest V3 config: permissions, background worker, popup, options
├── background.js          Service worker: playlist/playback state, tab tracking, LRC sync, routing
├── offscreen.html/.js     Offscreen document that actually plays the audio
├── content.js             Injected into the active tab only; renders the overlay
├── popup.html/.css/.js    Upload UI, playlist, playback controls
├── options.html/.css/.js  Settings page with a live animated preview + position pad
├── fonts.css              @font-face declarations for the popup/options pages
├── fonts/                 Bundled webfont files (see Licensing below)
├── lib/
│   ├── constants.js       Shared defaults/enums used everywhere
│   ├── db.js              IndexedDB wrapper (audio blobs + LRC text)
│   └── lrc-parser.js      Plain-LRC parser
└── icons/                 Toolbar/store icons
```

## Permissions, explained

| Permission | Why it's needed |
|---|---|
| `storage` | Save your settings and lightweight playback state. |
| `offscreen` | Play audio from a service worker, which can't play audio directly. |
| `scripting` | Inject the overlay into the active tab. |
| `tabs` | Detect which tab is active so the overlay can follow it. |
| `host_permissions: <all_urls>` | Without this, Chrome would block the overlay from being injected into most sites you visit. |

Nothing here talks to a server. All processing — playback, lyric parsing,
storage — happens entirely on your machine.

## Known limitations

- Word-pop and vertical caption modes estimate per-word timing by evenly
  dividing the gap until the next lyric line, since plain LRC has no
  word-level timestamps. It's a close approximation, not frame-accurate.
- Playback position isn't preserved mid-song across a full browser restart;
  your uploaded songs are still there, but you start fresh rather than
  resuming mid-track.
- The overlay can't be injected on `chrome://` pages, the Chrome Web Store,
  or other pages Chrome blocks extensions from running on.

## License

This project is licensed under the [MIT License](LICENSE) — you're free to
use, modify, and redistribute it, including commercially, as long as the
copyright notice is kept.

The four bundled fonts (Poppins, Montserrat, Anton, Caveat) are each
licensed separately under the [SIL Open Font License 1.1](fonts/OFL-LICENSE.txt),
which permits bundling and redistribution alongside this project.

## Author

**Ibad Bosan** — [github.com/ibadbosan921](https://github.com/ibadbosan921)

Contributions, issues, and forks are welcome.
