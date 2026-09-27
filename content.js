/**
 * Content script: renders a fixed, non-interactive lyrics overlay on the
 * page. Injected programmatically by the background script only into the
 * currently active tab. Uses a closed shadow root so page CSS can never
 * affect the overlay (and the overlay never affects the page).
 *
 * This file is idempotent: if it is executed twice in the same tab
 * (e.g. background re-injects defensively), the second run is a no-op.
 *
 * Animation is done with the Web Animations API (el.animate()) rather than
 * toggling CSS classes + forcing a layout reflow: it is cheaper, it can be
 * cancelled and restarted cleanly, and it gives precise per-word timing for
 * the word-pop / vertical display modes.
 */

(function () {
  if (window.__lyricsOverlayInitialized) return;
  window.__lyricsOverlayInitialized = true;

  let hostEl = null;
  let shadow = null;
  let wrapEl = null;
  let lineCurrentEl = null;
  let lineNextEl = null;
  let wordEl = null;      // word-pop mode: single reused element
  let columnEl = null;    // vertical mode: stacked word container
  let settings = (typeof DEFAULT_SETTINGS !== 'undefined') ? DEFAULT_SETTINGS : null;

  let wordTimers = [];
  let lastLineKey = null; // dedupes re-scheduling when a message repeats

  const MAX_STACKED_WORDS = 6;

  // ---------------------------------------------------------------------
  // Animations (Web Animations API keyframes, keyed by preset id)
  // ---------------------------------------------------------------------
  function animFor(id) {
    switch (id) {
      case 'fade':
        return { kf: [{ opacity: 0 }, { opacity: 1 }], opts: { duration: 320, easing: 'ease' } };
      case 'zoom-in':
        return { kf: [{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1)' }], opts: { duration: 320, easing: 'ease' } };
      case 'zoom-out':
        return { kf: [{ opacity: 0, transform: 'scale(1.6)' }, { opacity: 1, transform: 'scale(1)' }], opts: { duration: 320, easing: 'ease' } };
      case 'slide-up':
        return { kf: [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'translateY(0)' }], opts: { duration: 320, easing: 'ease' } };
      case 'slide-down':
        return { kf: [{ opacity: 0, transform: 'translateY(-24px)' }, { opacity: 1, transform: 'translateY(0)' }], opts: { duration: 320, easing: 'ease' } };
      case 'slide-left':
        return { kf: [{ opacity: 0, transform: 'translateX(32px)' }, { opacity: 1, transform: 'translateX(0)' }], opts: { duration: 320, easing: 'ease' } };
      case 'slide-right':
        return { kf: [{ opacity: 0, transform: 'translateX(-32px)' }, { opacity: 1, transform: 'translateX(0)' }], opts: { duration: 320, easing: 'ease' } };
      case 'bounce':
        return {
          kf: [
            { opacity: 0, transform: 'translateY(20px) scale(0.9)', offset: 0 },
            { opacity: 1, transform: 'translateY(-6px) scale(1.03)', offset: 0.6 },
            { opacity: 1, transform: 'translateY(0) scale(1)', offset: 1 }
          ],
          opts: { duration: 420, easing: 'cubic-bezier(.34,1.56,.64,1)' }
        };
      case 'fade-slide':
        return { kf: [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'translateY(0)' }], opts: { duration: 360, easing: 'ease' } };
      case 'fade-zoom':
        return { kf: [{ opacity: 0, transform: 'scale(0.85)' }, { opacity: 1, transform: 'scale(1)' }], opts: { duration: 360, easing: 'ease' } };
      case 'wave':
        return {
          kf: [
            { transform: 'translateY(0)', offset: 0 },
            { transform: 'translateY(-4px)', offset: 0.25 },
            { transform: 'translateY(0)', offset: 0.5 },
            { transform: 'translateY(4px)', offset: 0.75 },
            { transform: 'translateY(0)', offset: 1 }
          ],
          opts: { duration: 2200, easing: 'ease-in-out', iterations: Infinity }
        };
      case 'glow-pulse':
        return {
          kf: [
            { textShadow: '0 0 6px currentColor, 0 0 2px currentColor' },
            { textShadow: '0 0 18px currentColor, 0 0 8px currentColor' },
            { textShadow: '0 0 6px currentColor, 0 0 2px currentColor' }
          ],
          opts: { duration: 1800, easing: 'ease-in-out', iterations: Infinity }
        };
      case 'blur-in':
        return { kf: [{ opacity: 0, filter: 'blur(10px)' }, { opacity: 1, filter: 'blur(0px)' }], opts: { duration: 360, easing: 'ease-out' } };
      case 'flip':
        return {
          kf: [
            { opacity: 0, transform: 'perspective(500px) rotateX(85deg)' },
            { opacity: 1, transform: 'perspective(500px) rotateX(0deg)' }
          ],
          opts: { duration: 380, easing: 'ease-out' }
        };
      case 'typewriter':
        return null; // handled separately, char-by-char
      default:
        return { kf: [{ opacity: 0 }, { opacity: 1 }], opts: { duration: 300, easing: 'ease' } };
    }
  }

  function runAnimation(el, presetId) {
    el.getAnimations().forEach((a) => a.cancel());
    const preset = animFor(presetId);
    if (!preset) return; // typewriter: caller handles reveal itself
    el.animate(preset.kf, preset.opts);
  }

  let typewriterTimer = null;
  function runTypewriter(el, text) {
    clearInterval(typewriterTimer);
    el.textContent = '';
    let i = 0;
    typewriterTimer = setInterval(() => {
      i++;
      el.textContent = text.slice(0, i);
      if (i >= text.length) clearInterval(typewriterTimer);
    }, 32);
  }

  // ---------------------------------------------------------------------
  // Shadow DOM setup (rebuilt whenever displayMode changes)
  // ---------------------------------------------------------------------
  function fontFaceCss() {
    if (typeof EMBEDDED_FONT_FILES === 'undefined') return '';
    return EMBEDDED_FONT_FILES.map(
      (f) => `
      @font-face {
        font-family: '${f.family}';
        src: url('${chrome.runtime.getURL(f.file)}') format('woff2');
        font-weight: ${f.weight};
        font-style: ${f.style};
        font-display: swap;
      }`
    ).join('\n');
  }

  function baseStyles() {
    return `
      :host { all: initial; }
      * { box-sizing: border-box; }
      .lyrics-wrap {
        position: fixed;
        pointer-events: none;
        display: flex;
        flex-direction: column;
        max-width: 90vw;
        transition: top 0.25s ease, left 0.25s ease, transform 0.25s ease;
      }
      .lyric-line, .word-pop-el, .stack-word {
        pointer-events: none;
        user-select: none;
        white-space: pre-wrap;
        word-break: break-word;
        will-change: transform, opacity;
      }
      .lyric-line.next { }
      .stack-col {
        display: flex;
        flex-direction: column;
      }
      .anim-typewriter {
        display: inline-block;
        overflow: hidden;
        white-space: nowrap;
        border-right: 2px solid currentColor;
      }
      ${fontFaceCss()}
    `;
  }

  function ensureHost() {
    if (hostEl) return;
    hostEl = document.createElement('div');
    hostEl.id = '__ext_lyrics_overlay_host__';
    hostEl.style.cssText =
      'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    (document.documentElement || document.body).appendChild(hostEl);

    shadow = hostEl.attachShadow({ mode: 'closed' });
    const styleEl = document.createElement('style');
    styleEl.textContent = baseStyles();
    shadow.appendChild(styleEl);

    wrapEl = document.createElement('div');
    wrapEl.className = 'lyrics-wrap';
    shadow.appendChild(wrapEl);

    buildModeElements();
  }

  function buildModeElements() {
    wrapEl.innerHTML = '';
    if (settings.displayMode === 'word-pop') {
      wordEl = document.createElement('div');
      wordEl.className = 'word-pop-el';
      wrapEl.appendChild(wordEl);
      lineCurrentEl = null;
      lineNextEl = null;
      columnEl = null;
    } else if (settings.displayMode === 'vertical') {
      columnEl = document.createElement('div');
      columnEl.className = 'stack-col';
      wrapEl.appendChild(columnEl);
      lineCurrentEl = null;
      lineNextEl = null;
      wordEl = null;
    } else {
      lineCurrentEl = document.createElement('div');
      lineCurrentEl.className = 'lyric-line current';
      lineNextEl = document.createElement('div');
      lineNextEl.className = 'lyric-line next';
      wrapEl.appendChild(lineCurrentEl);
      wrapEl.appendChild(lineNextEl);
      wordEl = null;
      columnEl = null;
    }
  }

  // ---------------------------------------------------------------------
  // Style application
  // ---------------------------------------------------------------------
  function hexToRgba(hex, alpha) {
    const h = (hex || '#000000').replace('#', '');
    const bigint = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function applyPosition() {
    const { mode, xPercent, yPercent } = settings.position;
    let top, left, transform;
    if (mode === 'top') {
      top = '6%'; left = '50%'; transform = 'translateX(-50%)';
    } else if (mode === 'center') {
      top = '50%'; left = '50%'; transform = 'translate(-50%, -50%)';
    } else if (mode === 'custom') {
      top = `${yPercent != null ? yPercent : 50}%`;
      left = `${xPercent != null ? xPercent : 50}%`;
      transform = 'translate(-50%, -50%)';
    } else {
      top = `${yPercent || 88}%`; left = '50%'; transform = 'translateX(-50%)';
    }
    wrapEl.style.top = top;
    wrapEl.style.left = left;
    wrapEl.style.transform = transform;
    wrapEl.style.alignItems =
      settings.alignment === 'left' ? 'flex-start' : settings.alignment === 'right' ? 'flex-end' : 'center';
    wrapEl.style.textAlign = settings.alignment;
    wrapEl.style.gap = `${settings.lineSpacing}px`;
  }

  function typographyStyle(el, sizeMultiplier, opacityMultiplier) {
    const f = settings.font;
    const c = settings.color;
    el.style.fontFamily = f.family;
    el.style.fontSize = `${f.size * sizeMultiplier}px`;
    el.style.fontWeight = f.weight;
    el.style.fontStyle = f.style;
    el.style.color = c.text;
    el.style.opacity = c.opacity * opacityMultiplier;
    el.style.webkitTextStroke = `${c.outlineWidth}px ${c.outline}`;
    el.style.textShadow = `0 2px ${c.shadowBlur}px ${hexToRgba(c.shadow, c.shadowOpacity)}`;
    el.style.backgroundColor = hexToRgba(settings.background.color, settings.background.opacity);
    el.style.padding = settings.background.opacity > 0 ? '4px 10px' : '0';
    el.style.borderRadius = '6px';
  }

  function applySettings(newSettings) {
    const modeChanged = !settings || settings.displayMode !== newSettings.displayMode;
    settings = newSettings;
    ensureHost();
    hostEl.style.display = '';
    if (modeChanged) buildModeElements();
    applyPosition();

    if (settings.displayMode === 'word-pop') {
      typographyStyle(wordEl, 1.3, 1);
      wordEl.style.display = 'inline-block';
    } else if (settings.displayMode === 'vertical') {
      // per-word typography applied when each word is created
    } else {
      typographyStyle(lineCurrentEl, 1, 1);
      typographyStyle(lineNextEl, 0.75, 0.6);
      lineNextEl.style.display = settings.visibleLines > 1 ? '' : 'none';
      if (!settings.highlightCurrent) lineCurrentEl.style.opacity = lineNextEl.style.opacity;
    }
  }

  // ---------------------------------------------------------------------
  // Word scheduling (word-pop / vertical modes)
  // ---------------------------------------------------------------------
  function clearWordTimers() {
    wordTimers.forEach((t) => clearTimeout(t));
    wordTimers = [];
  }

  function revealWordPop(word) {
    if (settings.animation === 'typewriter') {
      runTypewriter(wordEl, word);
    } else {
      wordEl.textContent = word;
      runAnimation(wordEl, settings.animation);
    }
  }

  function revealStackWord(word) {
    const el = document.createElement('div');
    el.className = 'stack-word';
    typographyStyle(el, 1, 1);
    el.textContent = word;
    columnEl.appendChild(el);
    while (columnEl.children.length > MAX_STACKED_WORDS) {
      columnEl.removeChild(columnEl.firstChild);
    }
    if (settings.animation === 'typewriter') {
      runTypewriter(el, word);
    } else {
      runAnimation(el, settings.animation);
    }
  }

  function scheduleWords(line, durationSec) {
    clearWordTimers();
    const words = (line || '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return;
    const totalMs = Math.max(300, (durationSec || 2.5) * 1000);
    const perWordMs = Math.min(900, Math.max(150, totalMs / words.length));

    words.forEach((word, i) => {
      const t = setTimeout(() => {
        if (settings.displayMode === 'word-pop') revealWordPop(word);
        else if (settings.displayMode === 'vertical') revealStackWord(word);
      }, i * perWordMs);
      wordTimers.push(t);
    });
  }

  // ---------------------------------------------------------------------
  // Line-mode display
  // ---------------------------------------------------------------------
  function showLineMode(line, nextLine) {
    if (settings.animation === 'typewriter') {
      runTypewriter(lineCurrentEl, line || '');
    } else {
      lineCurrentEl.textContent = line || '';
      runAnimation(lineCurrentEl, settings.animation);
    }
    lineNextEl.textContent = settings.visibleLines > 1 ? (nextLine || '') : '';
  }

  function showLine(line, nextLine, duration) {
    ensureHost();
    const key = `${line}||${nextLine}`;
    if (key === lastLineKey && settings.displayMode !== 'line') return; // avoid re-scheduling on duplicate pushes
    lastLineKey = key;

    if (settings.displayMode === 'word-pop') {
      scheduleWords(line, duration);
    } else if (settings.displayMode === 'vertical') {
      columnEl.innerHTML = '';
      scheduleWords(line, duration);
    } else {
      clearWordTimers();
      showLineMode(line, nextLine);
    }
  }

  function hide() {
    if (hostEl) hostEl.style.display = 'none';
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.target !== 'content') return;
    switch (msg.type) {
      case 'PING':
        sendResponse({ ok: true });
        break;
      case 'INIT':
        applySettings(msg.settings);
        showLine(msg.line, msg.nextLine, msg.duration);
        if (!msg.visible) hide();
        sendResponse({ ok: true });
        break;
      case 'UPDATE_SETTINGS':
        applySettings(msg.settings);
        sendResponse({ ok: true });
        break;
      case 'SHOW_LYRICS':
        if (!settings) break;
        ensureHost();
        hostEl.style.display = '';
        showLine(msg.line, msg.nextLine, msg.duration);
        sendResponse({ ok: true });
        break;
      case 'HIDE_OVERLAY':
        hide();
        sendResponse({ ok: true });
        break;
      default:
        break;
    }
    return true;
  });
})();
