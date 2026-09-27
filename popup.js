/**
 * Popup UI: upload songs, show playlist, and control playback.
 * Talks to the background service worker via chrome.runtime.sendMessage.
 *
 * Performance note: this only polls a lightweight, IndexedDB-free
 * "GET_PLAYBACK" message (and only while something is actually playing) to
 * animate the progress bar. Everything else — playlist changes, play/pause,
 * mode, settings — arrives as a push from the background script, so the
 * popup does no needless work while idle.
 */

const fileInput = document.getElementById('fileInput');
const playlistEl = document.getElementById('playlist');
const emptyStateEl = document.getElementById('emptyState');
const nowPlayingNameEl = document.getElementById('nowPlayingName');
const progressEl = document.getElementById('progress');
const timeCurrentEl = document.getElementById('timeCurrent');
const timeDurationEl = document.getElementById('timeDuration');
const playPauseBtn = document.getElementById('playPauseBtn');
const iconPlay = playPauseBtn.querySelector('.icon-play');
const iconPause = playPauseBtn.querySelector('.icon-pause');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const modeBtn = document.getElementById('modeBtn');
const openOptionsBtn = document.getElementById('openOptions');

const MODE_ICONS = {
  sequential: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h16M14 6l6 6-6 6"/></svg>',
  loop: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>'
};

let state = {
  playlist: [],
  playback: { ...DEFAULT_PLAYBACK_STATE },
  currentTime: 0,
  duration: 0
};
let isSeeking = false;
let fastPollTimer = null;

function send(message) {
  return chrome.runtime.sendMessage({ target: 'background', ...message });
}

function baseName(fileName) {
  const idx = fileName.lastIndexOf('.');
  return idx === -1 ? fileName : fileName.slice(0, idx);
}

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function handleFiles(fileList) {
  const files = Array.from(fileList);
  const audioFiles = files.filter((f) => /\.(mp3|wav)$/i.test(f.name));
  const lrcFiles = files.filter((f) => /\.lrc$/i.test(f.name));
  const lrcMap = new Map(lrcFiles.map((f) => [baseName(f.name).toLowerCase(), f]));

  const added = [];
  for (const audioFile of audioFiles) {
    const key = baseName(audioFile.name).toLowerCase();
    const lrcFile = lrcMap.get(key);
    const lrcText = lrcFile ? await lrcFile.text() : '';
    const id = crypto.randomUUID();
    const song = {
      id,
      name: audioFile.name,
      lrcName: lrcFile ? lrcFile.name : '(no lyrics found)',
      mimeType: audioFile.type || (audioFile.name.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg'),
      audioBlob: audioFile,
      lrcText,
      duration: null,
      addedAt: Date.now()
    };
    await dbAddSong(song);
    added.push({ id, name: song.name, lrcName: song.lrcName });
  }

  if (added.length > 0) {
    state.playlist = state.playlist.concat(added.map((s) => ({ ...s, duration: null, addedAt: Date.now() })));
    renderPlaylist();
    await send({ type: 'SONGS_ADDED', songs: added });
  }
}

fileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) {
    handleFiles(e.target.files);
  }
  fileInput.value = '';
});

function renderPlaylist() {
  playlistEl.innerHTML = '';
  const { playlist } = state;
  emptyStateEl.style.display = playlist.length === 0 ? 'flex' : 'none';

  for (const song of playlist) {
    const li = document.createElement('li');
    const isActive = song.id === state.playback.currentSongId;
    li.className = 'playlist-item' + (isActive ? ' active' : '');

    const playBtn = document.createElement('button');
    playBtn.className = 'song-play-btn';
    const isActivePlaying = isActive && state.playback.isPlaying;
    if (isActivePlaying) {
      playBtn.innerHTML = '<span class="eq-bars"><span></span><span></span><span></span></span>';
    } else {
      playBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    }
    playBtn.addEventListener('click', () => {
      if (isActive) send({ type: 'TOGGLE_PLAY' });
      else send({ type: 'PLAY_SONG', id: song.id });
    });

    const info = document.createElement('div');
    info.className = 'song-info';
    const name = document.createElement('div');
    name.className = 'song-name';
    name.textContent = song.name;
    const lrc = document.createElement('div');
    lrc.className = 'song-lrc';
    lrc.textContent = song.lrcName;
    info.appendChild(name);
    info.appendChild(lrc);

    const delBtn = document.createElement('button');
    delBtn.className = 'song-delete-btn';
    delBtn.title = 'Remove';
    delBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    delBtn.addEventListener('click', () => {
      state.playlist = state.playlist.filter((s) => s.id !== song.id);
      renderPlaylist();
      send({ type: 'DELETE_SONG', id: song.id });
    });

    li.appendChild(playBtn);
    li.appendChild(info);
    li.appendChild(delBtn);
    playlistEl.appendChild(li);
  }
}

function renderPlayer() {
  const song = state.playlist.find((s) => s.id === state.playback.currentSongId);
  nowPlayingNameEl.textContent = song ? song.name : 'Nothing playing';

  iconPlay.style.display = state.playback.isPlaying ? 'none' : '';
  iconPause.style.display = state.playback.isPlaying ? '' : 'none';

  if (!isSeeking) {
    progressEl.max = state.duration || 0;
    progressEl.value = state.currentTime || 0;
  }
  timeCurrentEl.textContent = formatTime(state.currentTime);
  timeDurationEl.textContent = formatTime(state.duration);

  modeBtn.innerHTML = MODE_ICONS[state.playback.mode] || MODE_ICONS.sequential;
  modeBtn.classList.toggle('active', state.playback.mode !== PLAY_MODES.SEQUENTIAL);
  modeBtn.title = `Mode: ${state.playback.mode}`;

  manageFastPoll();
}

function render() {
  renderPlaylist();
  renderPlayer();
}

function manageFastPoll() {
  const shouldPoll = state.playback.isPlaying;
  if (shouldPoll && !fastPollTimer) {
    fastPollTimer = setInterval(async () => {
      if (isSeeking) return;
      const resp = await send({ type: 'GET_PLAYBACK' });
      if (!resp) return;
      state.playback = resp.playback;
      state.currentTime = resp.currentTime;
      state.duration = resp.duration;
      renderPlayer();
    }, 500);
  } else if (!shouldPoll && fastPollTimer) {
    clearInterval(fastPollTimer);
    fastPollTimer = null;
  }
}

async function loadInitialState() {
  const resp = await send({ type: 'GET_STATE' });
  if (!resp) return;
  state.playlist = resp.playlist;
  state.playback = resp.playback;
  state.currentTime = resp.currentTime;
  state.duration = resp.duration;
  render();
}

playPauseBtn.addEventListener('click', () => send({ type: 'TOGGLE_PLAY' }));
prevBtn.addEventListener('click', () => send({ type: 'PREV' }));
nextBtn.addEventListener('click', () => send({ type: 'NEXT' }));

modeBtn.addEventListener('click', () => {
  const order = [PLAY_MODES.SEQUENTIAL, PLAY_MODES.LOOP, PLAY_MODES.SHUFFLE];
  const idx = order.indexOf(state.playback.mode);
  const nextMode = order[(idx + 1) % order.length];
  send({ type: 'SET_MODE', mode: nextMode });
});

progressEl.addEventListener('input', () => {
  isSeeking = true;
  timeCurrentEl.textContent = formatTime(Number(progressEl.value));
});
progressEl.addEventListener('change', () => {
  send({ type: 'SEEK', time: Number(progressEl.value) });
  isSeeking = false;
});

openOptionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.target === 'popup' && msg.type === 'STATE_UPDATE') {
    state.playback = msg.state.playback;
    state.currentTime = msg.state.currentTime;
    state.duration = msg.state.duration;
    render();
  }
});

loadInitialState();
