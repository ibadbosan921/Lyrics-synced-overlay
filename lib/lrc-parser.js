/**
 * Plain LRC parser: [mm:ss.xx]Lyric text
 * No enhanced/word-by-word LRC. Supports multiple timestamps on one line.
 */

const LRC_TIME_TAG = /\[(\d{1,2}):(\d{2}(?:[.:]\d{1,3})?)\]/g;

/**
 * Parses LRC text into a sorted array of { time (seconds), text } entries.
 * Metadata tags like [ti:], [ar:], [al:] are ignored (no numeric time to parse).
 */
function parseLRC(lrcText) {
  if (!lrcText) return [];
  const lines = lrcText.split(/\r?\n/);
  const entries = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    LRC_TIME_TAG.lastIndex = 0;
    const tags = [...line.matchAll(LRC_TIME_TAG)];
    if (tags.length === 0) continue; // not a timed lyric line (metadata or malformed)

    const text = line.replace(LRC_TIME_TAG, '').trim();

    for (const tag of tags) {
      const minutes = parseInt(tag[1], 10);
      const seconds = parseFloat(tag[2].replace(':', '.'));
      const time = minutes * 60 + seconds;
      entries.push({ time, text });
    }
  }

  entries.sort((a, b) => a.time - b.time);
  return entries;
}

/**
 * Finds the index of the lyric line active at `currentTime` (seconds).
 * Returns -1 if before the first line.
 */
function findCurrentLineIndex(lyrics, currentTime) {
  if (!lyrics || lyrics.length === 0) return -1;
  let lo = 0;
  let hi = lyrics.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lyrics[mid].time <= currentTime) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

if (typeof self !== 'undefined') {
  self.parseLRC = parseLRC;
  self.findCurrentLineIndex = findCurrentLineIndex;
}
