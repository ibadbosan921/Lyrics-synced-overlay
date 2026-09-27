/**
 * IndexedDB wrapper for storing uploaded audio + LRC files.
 * Works in the service worker, the offscreen document, and the popup/options
 * pages, since all are extension contexts with IndexedDB access.
 *
 * Object store "songs": { id, name, lrcName, mimeType, audioBlob, lrcText, addedAt }
 */

const DB_NAME = 'lyrics-overlay-db';
const DB_VERSION = 1;
const STORE_SONGS = 'songs';

function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SONGS)) {
        const store = db.createObjectStore(STORE_SONGS, { keyPath: 'id' });
        store.createIndex('addedAt', 'addedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbAddSong(song) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SONGS, 'readwrite');
    tx.objectStore(STORE_SONGS).put(song);
    tx.oncomplete = () => resolve(song.id);
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetSong(id) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SONGS, 'readonly');
    const req = tx.objectStore(STORE_SONGS).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function dbDeleteSong(id) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SONGS, 'readwrite');
    tx.objectStore(STORE_SONGS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetAllSongsMeta() {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SONGS, 'readonly');
    const req = tx.objectStore(STORE_SONGS).getAll();
    req.onsuccess = () => {
      const songs = (req.result || [])
        .sort((a, b) => a.addedAt - b.addedAt)
        .map((s) => ({
          id: s.id,
          name: s.name,
          lrcName: s.lrcName,
          duration: s.duration || null,
          addedAt: s.addedAt
        }));
      resolve(songs);
    };
    req.onerror = () => reject(req.error);
  });
}

async function dbUpdateSongDuration(id, duration) {
  const song = await dbGetSong(id);
  if (!song) return;
  song.duration = duration;
  await dbAddSong(song);
}

if (typeof self !== 'undefined') {
  self.dbOpen = dbOpen;
  self.dbAddSong = dbAddSong;
  self.dbGetSong = dbGetSong;
  self.dbDeleteSong = dbDeleteSong;
  self.dbGetAllSongsMeta = dbGetAllSongsMeta;
  self.dbUpdateSongDuration = dbUpdateSongDuration;
}
