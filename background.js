/**
 * Background service worker.
 * Responsibilities:
 *  - Owns playlist/playback state and persists it across SW restarts.
 *  - Manages the offscreen document that actually plays audio.
 *  - Tracks the active tab and moves the lyrics overlay to it (with delay).
 *  - Parses LRC files and pushes the current lyric line to the overlay.
 *  - Routes messages between popup, offscreen document, and content scripts.
 */

importScripts('lib/constants.js', 'lib/db.js', 'lib/lrc-parser.js');

const OFFSCREEN_URL = 'offscreen.html';
const CONTENT_FILES = ['lib/constants.js', 'content.js'];

// ---- In-memory state (rebuilt on every SW wake via init()) ----
let settings = DEFAULT_SETTINGS;
let playback = { ...DEFAULT_PLAYBACK_STATE };
let currentLyrics = [];
let currentLineIndex = -1;
let currentTime = 0;
let duration = 0;

let activeOverlayTabId = null;
let pendingSwitchTimer = null;
const injectedTabs = new Set();

let initPromise = null;

function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.SETTINGS, STORAGE_KEYS.PLAYBACK]);
    settings = { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEYS.SETTINGS] || {}) };
    playback = { ...DEFAULT_PLAYBACK_STATE, ...(stored[STORAGE_KEYS.PLAYBACK] || {}) };
    // Never resume auto-playing after a browser restart; user presses play.
    playback.isPlaying = false;

    if (playback.currentSongId) {
      const song = await dbGetSong(playback.currentSongId);
      if (song) {
        currentLyrics = parseLRC(song.lrcText);
      }
    }
  })();
  return initPromise;
}

init();

// ---------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------
async function persistSettings() {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

async function persistPlayback() {
  await chrome.storage.local.set({ [STORAGE_KEYS.PLAYBACK]: playback });
}

// ---------------------------------------------------------------------
// Offscreen document management
// ---------------------------------------------------------------------
async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (existing.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Play uploaded local audio files in the background across tab switches.'
  });
}

async function sendToOffscreen(message) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ target: 'offscreen', ...message }).catch(() => {});
}

// ---------------------------------------------------------------------
// Content script / overlay tab management
// ---------------------------------------------------------------------
async function sendToTab(tabId, message) {
  if (tabId == null) return;
  try {
    await chrome.tabs.sendMessage(tabId, { target: 'content', ...message });
  } catch (e) {
    // Tab has no listener yet (not injected) or was closed; ignore.
  }
}

async function ensureContentScript(tabId) {
  if (injectedTabs.has(tabId)) return true;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !/^https?:|^file:/.test(tab.url)) return false; // can't inject into chrome:// etc.
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
    injectedTabs.add(tabId);
    return true;
  } catch (e) {
    return false;
  }
}

function currentLineText() {
  return currentLineIndex >= 0 ? currentLyrics[currentLineIndex].text : '';
}
function nextLineText() {
  return currentLineIndex + 1 < currentLyrics.length ? currentLyrics[currentLineIndex + 1].text : '';
}
// How long (seconds) the current line has on screen before the next cue,
// used by word-pop/vertical display modes to auto-pace individual words.
// Plain LRC has no word-level timing, so this is an estimate, clamped to a
// sane range.
function currentLineDuration() {
  if (currentLineIndex < 0) return 2.5;
  const start = currentLyrics[currentLineIndex].time;
  const end = currentLineIndex + 1 < currentLyrics.length ? currentLyrics[currentLineIndex + 1].time : start + 4;
  return Math.min(8, Math.max(0.8, end - start));
}

async function moveOverlayToTab(tabId) {
  const oldTabId = activeOverlayTabId;
  if (oldTabId === tabId) return;

  const ok = await ensureContentScript(tabId);
  activeOverlayTabId = ok ? tabId : null;

  if (ok) {
    await sendToTab(tabId, {
      type: 'INIT',
      settings,
      line: currentLineText(),
      nextLine: nextLineText(),
      duration: currentLineDuration(),
      visible: playback.isPlaying
    });
  }

  if (oldTabId && oldTabId !== tabId) {
    sendToTab(oldTabId, { type: 'HIDE_OVERLAY' });
  }
}

function scheduleOverlayMove(tabId) {
  if (pendingSwitchTimer) clearTimeout(pendingSwitchTimer);
  pendingSwitchTimer = setTimeout(() => {
    pendingSwitchTimer = null;
    moveOverlayToTab(tabId);
  }, OVERLAY_MOVE_DELAY_MS);
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  scheduleOverlayMove(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    injectedTabs.delete(tabId); // page navigated/reloaded, content script gone
    if (activeOverlayTabId === tabId) activeOverlayTabId = null;
    scheduleOverlayMove(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
  if (activeOverlayTabId === tabId) activeOverlayTabId = null;
});

// ---------------------------------------------------------------------
// Playback control
// ---------------------------------------------------------------------
function buildQueueFromPlaylist(playlist, mode) {
  const ids = playlist.map((s) => s.id);
  if (mode === PLAY_MODES.SHUFFLE) {
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
  }
  return ids;
}

async function loadAndPlay(songId) {
  await init();
  const song = await dbGetSong(songId);
  if (!song) return;

  const playlist = await dbGetAllSongsMeta();
  if (playback.queueOrder.length === 0 || !playback.queueOrder.includes(songId)) {
    playback.queueOrder = buildQueueFromPlaylist(playlist, playback.mode);
  }
  playback.currentIndex = playback.queueOrder.indexOf(songId);
  playback.currentSongId = songId;

  currentLyrics = parseLRC(song.lrcText);
  currentLineIndex = -1;
  currentTime = 0;
  duration = song.duration || 0;

  await sendToOffscreen({ type: 'LOAD_SONG', id: songId });
  await sendToOffscreen({ type: 'PLAY' });

  playback.isPlaying = true;
  await persistPlayback();
  broadcastState();

  if (activeOverlayTabId) {
    sendToTab(activeOverlayTabId, { type: 'SHOW_LYRICS', line: '', nextLine: '' });
  }
}

async function togglePlay() {
  await init();
  if (!playback.currentSongId) return;
  if (playback.isPlaying) {
    await sendToOffscreen({ type: 'PAUSE' });
    playback.isPlaying = false;
  } else {
    await sendToOffscreen({ type: 'RESUME' });
    playback.isPlaying = true;
  }
  await persistPlayback();
  broadcastState();
}

async function playNext(auto = false) {
  await init();
  const playlist = await dbGetAllSongsMeta();
  if (playlist.length === 0) return;

  if (playback.queueOrder.length === 0) {
    playback.queueOrder = buildQueueFromPlaylist(playlist, playback.mode);
    playback.currentIndex = -1;
  }

  let nextIndex = playback.currentIndex + 1;
  if (nextIndex >= playback.queueOrder.length) {
    if (playback.mode === PLAY_MODES.LOOP) {
      nextIndex = 0;
    } else if (playback.mode === PLAY_MODES.SHUFFLE) {
      playback.queueOrder = buildQueueFromPlaylist(playlist, playback.mode);
      nextIndex = 0;
    } else {
      // sequential: stop at end of playlist
      playback.isPlaying = false;
      await sendToOffscreen({ type: 'PAUSE' });
      await persistPlayback();
      broadcastState();
      return;
    }
  }
  const nextId = playback.queueOrder[nextIndex];
  await loadAndPlay(nextId);
}

async function playPrev() {
  await init();
  if (playback.currentIndex <= 0) {
    if (playback.currentSongId) await loadAndPlay(playback.currentSongId); // restart current
    return;
  }
  const prevId = playback.queueOrder[playback.currentIndex - 1];
  await loadAndPlay(prevId);
}

async function setMode(mode) {
  await init();
  playback.mode = mode;
  const playlist = await dbGetAllSongsMeta();
  playback.queueOrder = buildQueueFromPlaylist(playlist, mode);
  if (playback.currentSongId) {
    playback.currentIndex = playback.queueOrder.indexOf(playback.currentSongId);
  }
  await persistPlayback();
  broadcastState();
}

async function deleteSong(id) {
  await init();
  await dbDeleteSong(id);
  if (playback.currentSongId === id) {
    await sendToOffscreen({ type: 'STOP' });
    playback.currentSongId = null;
    playback.isPlaying = false;
    playback.currentIndex = -1;
    currentLyrics = [];
    currentLineIndex = -1;
    if (activeOverlayTabId) sendToTab(activeOverlayTabId, { type: 'SHOW_LYRICS', line: '', nextLine: '' });
  }
  playback.queueOrder = playback.queueOrder.filter((qid) => qid !== id);
  await persistPlayback();
  broadcastState();
}

async function seek(time) {
  await sendToOffscreen({ type: 'SEEK', time });
}

function updateLyricLine(time) {
  const adjusted = time + settings.timingOffsetMs / 1000;
  const idx = findCurrentLineIndex(currentLyrics, adjusted);
  if (idx !== currentLineIndex) {
    currentLineIndex = idx;
    if (activeOverlayTabId) {
      sendToTab(activeOverlayTabId, {
        type: 'SHOW_LYRICS',
        line: currentLineText(),
        nextLine: nextLineText(),
        duration: currentLineDuration()
      });
    }
  }
}

function broadcastState() {
  chrome.runtime
    .sendMessage({
      target: 'popup',
      type: 'STATE_UPDATE',
      state: {
        playback,
        currentTime,
        duration,
        settings
      }
    })
    .catch(() => {});
}

// ---------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || (msg.target && msg.target !== 'background')) return; // not for us

  (async () => {
    await init();
    switch (msg.type) {
      case 'GET_STATE': {
        const playlist = await dbGetAllSongsMeta();
        sendResponse({
          playlist,
          playback,
          settings,
          currentTime,
          duration,
          currentLine: currentLineText()
        });
        break;
      }
      case 'GET_PLAYBACK': {
        // Lighter than GET_STATE: no IndexedDB read, just the numbers the
        // popup needs to animate its progress bar while open.
        sendResponse({ playback, currentTime, duration });
        break;
      }
      case 'SONGS_ADDED': {
        // Popup already wrote songs to IndexedDB; just refresh the queue if idle.
        if (playback.queueOrder.length === 0) {
          const playlist = await dbGetAllSongsMeta();
          playback.queueOrder = buildQueueFromPlaylist(playlist, playback.mode);
          await persistPlayback();
        }
        broadcastState();
        sendResponse({ ok: true });
        break;
      }
      case 'PLAY_SONG':
        await loadAndPlay(msg.id);
        sendResponse({ ok: true });
        break;
      case 'TOGGLE_PLAY':
        await togglePlay();
        sendResponse({ ok: true });
        break;
      case 'NEXT':
        await playNext();
        sendResponse({ ok: true });
        break;
      case 'PREV':
        await playPrev();
        sendResponse({ ok: true });
        break;
      case 'SEEK':
        await seek(msg.time);
        sendResponse({ ok: true });
        break;
      case 'SET_MODE':
        await setMode(msg.mode);
        sendResponse({ ok: true });
        break;
      case 'DELETE_SONG':
        await deleteSong(msg.id);
        sendResponse({ ok: true });
        break;
      case 'UPDATE_SETTINGS':
        settings = { ...settings, ...msg.settings };
        await persistSettings();
        if (activeOverlayTabId) {
          sendToTab(activeOverlayTabId, { type: 'UPDATE_SETTINGS', settings });
        }
        broadcastState();
        sendResponse({ ok: true });
        break;

      // ---- messages coming from the offscreen document ----
      case 'TIME_UPDATE':
        currentTime = msg.time;
        updateLyricLine(currentTime);
        break;
      case 'LOADED_METADATA':
        duration = msg.duration;
        if (playback.currentSongId) dbUpdateSongDuration(playback.currentSongId, duration);
        broadcastState();
        break;
      case 'ENDED':
        await playNext(true);
        break;
      case 'PLAYBACK_ERROR':
        playback.isPlaying = false;
        await persistPlayback();
        broadcastState();
        break;

      default:
        break;
    }
  })();

  return true; // keep the message channel open for the async sendResponse
});
