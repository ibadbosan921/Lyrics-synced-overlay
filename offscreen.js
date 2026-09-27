/**
 * Offscreen document: the only place actual audio playback happens
 * (MV3 service workers cannot play audio directly). Stays alive
 * independently of the service worker, so playback survives SW restarts.
 */

const audio = document.getElementById('player');
let currentObjectUrl = null;
let currentSongId = null;
let lastReportedTime = -1;

function post(message) {
  chrome.runtime.sendMessage({ target: 'background', ...message }).catch(() => {});
}

// Sampling on a steady timer (rather than reacting to every native
// "timeupdate" firing, which can be very frequent) keeps message traffic
// light and predictable regardless of playback engine quirks.
setInterval(() => {
  if (audio.paused || !Number.isFinite(audio.currentTime)) return;
  if (Math.abs(audio.currentTime - lastReportedTime) < 0.05) return;
  lastReportedTime = audio.currentTime;
  post({ type: 'TIME_UPDATE', time: audio.currentTime });
}, TIME_SYNC_INTERVAL_MS);

audio.addEventListener('loadedmetadata', () => {
  post({ type: 'LOADED_METADATA', duration: audio.duration });
});

audio.addEventListener('ended', () => {
  post({ type: 'ENDED' });
});

audio.addEventListener('error', () => {
  post({ type: 'PLAYBACK_ERROR', message: 'Audio failed to load or play.' });
});

async function loadSong(id) {
  const song = await dbGetSong(id);
  if (!song || !song.audioBlob) {
    post({ type: 'PLAYBACK_ERROR', message: 'Song not found.' });
    return;
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  currentSongId = id;
  currentObjectUrl = URL.createObjectURL(song.audioBlob);
  audio.src = currentObjectUrl;
  audio.currentTime = 0;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return;

  (async () => {
    switch (msg.type) {
      case 'LOAD_SONG':
        await loadSong(msg.id);
        sendResponse({ ok: true });
        break;
      case 'PLAY':
        try {
          await audio.play();
        } catch (e) {
          post({ type: 'PLAYBACK_ERROR', message: String(e) });
        }
        sendResponse({ ok: true });
        break;
      case 'RESUME':
        try {
          await audio.play();
        } catch (e) {
          post({ type: 'PLAYBACK_ERROR', message: String(e) });
        }
        sendResponse({ ok: true });
        break;
      case 'PAUSE':
        audio.pause();
        sendResponse({ ok: true });
        break;
      case 'STOP':
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        if (currentObjectUrl) {
          URL.revokeObjectURL(currentObjectUrl);
          currentObjectUrl = null;
        }
        currentSongId = null;
        sendResponse({ ok: true });
        break;
      case 'SEEK':
        if (Number.isFinite(msg.time)) audio.currentTime = msg.time;
        sendResponse({ ok: true });
        break;
      case 'GET_STATUS':
        sendResponse({
          songId: currentSongId,
          currentTime: audio.currentTime,
          duration: audio.duration || 0,
          paused: audio.paused
        });
        break;
      default:
        sendResponse({ ok: false });
        break;
    }
  })();

  return true;
});
