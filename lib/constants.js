/**
 * Shared constants used across background, popup, options, and content scripts.
 * Loaded as a classic (non-module) script everywhere so its globals are
 * visible to whichever file runs after it (importScripts order in the
 * service worker, <script> order in HTML pages, and file order when
 * injected via chrome.scripting.executeScript).
 */

// How long to wait after a tab becomes active before moving the overlay to it.
const OVERLAY_MOVE_DELAY_MS = 3000;

// How often the offscreen document samples audio.currentTime and reports it.
// Sampling on a fixed timer (instead of the native "timeupdate" event, which
// can fire very frequently) keeps message traffic light and steady.
const TIME_SYNC_INTERVAL_MS = 200;

// Playlist playback modes.
const PLAY_MODES = {
  SEQUENTIAL: 'sequential',
  LOOP: 'loop',
  SHUFFLE: 'shuffle'
};

// How a lyric line is laid out on screen.
const DISPLAY_MODES = {
  LINE: 'line',         // classic: current line (+ optional next line beneath)
  WORD_POP: 'word-pop',   // Instagram/TikTok style: one big word at a time
  VERTICAL: 'vertical'    // words stack top-to-bottom in a single column
};

const DISPLAY_MODE_OPTIONS = [
  { id: DISPLAY_MODES.LINE, label: 'Classic line', hint: 'Full line, karaoke-style' },
  { id: DISPLAY_MODES.WORD_POP, label: 'Word pop', hint: 'One big word at a time, Reels-style' },
  { id: DISPLAY_MODES.VERTICAL, label: 'Vertical stack', hint: 'Words stack top to bottom' }
];

// All supported entrance/exit animation presets, applied to whichever unit
// is on screen (a full line in "line" mode, a single word in "word-pop" and
// "vertical" modes).
const ANIMATION_PRESETS = [
  { id: 'fade', label: 'Fade' },
  { id: 'zoom-in', label: 'Zoom In' },
  { id: 'zoom-out', label: 'Zoom Out' },
  { id: 'slide-up', label: 'Slide Up' },
  { id: 'slide-down', label: 'Slide Down' },
  { id: 'slide-left', label: 'Slide Left' },
  { id: 'slide-right', label: 'Slide Right' },
  { id: 'bounce', label: 'Bounce' },
  { id: 'typewriter', label: 'Typewriter' },
  { id: 'fade-slide', label: 'Fade + Slide' },
  { id: 'fade-zoom', label: 'Fade + Zoom' },
  { id: 'wave', label: 'Wave' },
  { id: 'glow-pulse', label: 'Glow Pulse' },
  { id: 'blur-in', label: 'Blur In' },
  { id: 'flip', label: 'Flip' }
];

// Curated font set. The first four are real webfonts bundled with the
// extension (SIL Open Font License) and embedded via @font-face so they
// render identically on every site, regardless of what the visitor has
// installed. The rest are common system fonts used as-is.
const FONT_CHOICES = [
  { id: 'poppins', label: 'Poppins', family: "'Lyrics Poppins', 'Segoe UI', Arial, sans-serif", embedded: true },
  { id: 'montserrat', label: 'Montserrat', family: "'Lyrics Montserrat', Arial, sans-serif", embedded: true },
  { id: 'anton', label: 'Anton (caption style)', family: "'Lyrics Anton', Impact, sans-serif", embedded: true },
  { id: 'caveat', label: 'Caveat (handwritten)', family: "'Lyrics Caveat', 'Brush Script MT', cursive", embedded: true },
  { id: 'impact', label: 'Impact', family: "Impact, Haettenschweiler, 'Franklin Gothic Bold', sans-serif", embedded: false },
  { id: 'georgia', label: 'Georgia', family: "Georgia, 'Times New Roman', serif", embedded: false },
  { id: 'courier', label: 'Courier New', family: "'Courier New', monospace", embedded: false },
  { id: 'comic', label: 'Comic Sans', family: "'Comic Sans MS', 'Comic Sans', cursive", embedded: false }
];

const EMBEDDED_FONT_FILES = [
  { family: 'Lyrics Poppins', weight: 400, style: 'normal', file: 'fonts/poppins-400.woff2' },
  { family: 'Lyrics Poppins', weight: 700, style: 'normal', file: 'fonts/poppins-700.woff2' },
  { family: 'Lyrics Montserrat', weight: 800, style: 'normal', file: 'fonts/montserrat-800.woff2' },
  { family: 'Lyrics Anton', weight: 400, style: 'normal', file: 'fonts/anton-400.woff2' },
  { family: 'Lyrics Caveat', weight: 700, style: 'normal', file: 'fonts/caveat-700.woff2' }
];

// Default overlay/lyric display settings. Persisted to chrome.storage.local
// under the key "lyricsOverlaySettings" and merged with any saved values.
const DEFAULT_SETTINGS = {
  displayMode: DISPLAY_MODES.LINE,
  font: {
    family: FONT_CHOICES[0].family,
    size: 30,
    weight: '700',
    style: 'normal'
  },
  color: {
    text: '#ffffff',
    outline: '#000000',
    outlineWidth: 2,
    shadow: '#000000',
    shadowOpacity: 0.6,
    shadowBlur: 8,
    opacity: 1
  },
  background: {
    color: '#000000',
    opacity: 0
  },
  position: {
    mode: 'bottom', // 'top' | 'center' | 'bottom' | 'custom'
    xPercent: 50,
    yPercent: 88
  },
  alignment: 'center', // 'left' | 'center' | 'right'
  lineSpacing: 10,
  visibleLines: 2, // 1 or 2, only used in "line" display mode
  highlightCurrent: true,
  timingOffsetMs: 0,
  animation: 'fade-slide'
};

const STORAGE_KEYS = {
  SETTINGS: 'lyricsOverlaySettings',
  PLAYBACK: 'lyricsOverlayPlayback'
};

// Default persisted playback state (survives service worker restarts).
const DEFAULT_PLAYBACK_STATE = {
  queueOrder: [],     // array of song ids, in play order
  currentIndex: -1,
  currentSongId: null,
  mode: PLAY_MODES.SEQUENTIAL,
  isPlaying: false
};

// Allow use in service worker (importScripts) and normal script contexts alike.
if (typeof self !== 'undefined') {
  self.OVERLAY_MOVE_DELAY_MS = OVERLAY_MOVE_DELAY_MS;
  self.TIME_SYNC_INTERVAL_MS = TIME_SYNC_INTERVAL_MS;
  self.PLAY_MODES = PLAY_MODES;
  self.DISPLAY_MODES = DISPLAY_MODES;
  self.DISPLAY_MODE_OPTIONS = DISPLAY_MODE_OPTIONS;
  self.ANIMATION_PRESETS = ANIMATION_PRESETS;
  self.FONT_CHOICES = FONT_CHOICES;
  self.EMBEDDED_FONT_FILES = EMBEDDED_FONT_FILES;
  self.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  self.STORAGE_KEYS = STORAGE_KEYS;
  self.DEFAULT_PLAYBACK_STATE = DEFAULT_PLAYBACK_STATE;
}
