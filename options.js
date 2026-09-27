/**
 * Options page: edit every overlay setting, with a live animated preview
 * (using the same three display modes and Web Animations presets as the
 * real overlay) and a draggable position pad. Pushes changes to the
 * background script, which forwards them to whichever tab is currently
 * showing the overlay.
 */

let settings = structuredClone(DEFAULT_SETTINGS);

const els = {
  displayModeRow: document.getElementById('displayModeRow'),
  animation: document.getElementById('animation'),
  fontChoice: document.getElementById('fontChoice'),

  fontSize: document.getElementById('fontSize'),
  fontSizeVal: document.getElementById('fontSizeVal'),
  fontWeight: document.getElementById('fontWeight'),
  fontStyle: document.getElementById('fontStyle'),

  textColor: document.getElementById('textColor'),
  outlineColor: document.getElementById('outlineColor'),
  outlineWidth: document.getElementById('outlineWidth'),
  outlineWidthVal: document.getElementById('outlineWidthVal'),
  shadowColor: document.getElementById('shadowColor'),
  shadowOpacity: document.getElementById('shadowOpacity'),
  shadowOpacityVal: document.getElementById('shadowOpacityVal'),
  textOpacity: document.getElementById('textOpacity'),
  textOpacityVal: document.getElementById('textOpacityVal'),

  bgColor: document.getElementById('bgColor'),
  bgOpacity: document.getElementById('bgOpacity'),
  bgOpacityVal: document.getElementById('bgOpacityVal'),

  alignment: document.getElementById('alignment'),
  lineSpacing: document.getElementById('lineSpacing'),
  lineSpacingVal: document.getElementById('lineSpacingVal'),
  visibleLines: document.getElementById('visibleLines'),
  visibleLinesField: document.getElementById('visibleLinesField'),
  highlightCurrent: document.getElementById('highlightCurrent'),

  timingOffset: document.getElementById('timingOffset'),
  timingOffsetVal: document.getElementById('timingOffsetVal'),

  posPad: document.getElementById('posPad'),
  posDot: document.getElementById('posDot'),
  posQuickBtns: Array.from(document.querySelectorAll('.pos-quick-btn')),
  previewMount: document.getElementById('previewMount'),

  resetBtn: document.getElementById('resetBtn')
};

// ---------------------------------------------------------------------
// Static option lists
// ---------------------------------------------------------------------
function populateSelect(select, items, valueKey, labelKey) {
  select.innerHTML = '';
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item[valueKey];
    opt.textContent = item[labelKey];
    select.appendChild(opt);
  }
}

function populateDisplayModePills() {
  els.displayModeRow.innerHTML = '';
  for (const mode of DISPLAY_MODE_OPTIONS) {
    const btn = document.createElement('button');
    btn.className = 'pill-btn';
    btn.dataset.mode = mode.id;
    btn.innerHTML = `${mode.label}<span class="pill-hint">${mode.hint}</span>`;
    btn.addEventListener('click', () => {
      settings.displayMode = mode.id;
      onFormChange({ skipRead: true });
    });
    els.displayModeRow.appendChild(btn);
  }
}

// ---------------------------------------------------------------------
// Preview: a lightweight stand-in for content.js's renderer, running in
// the options page's own light DOM (no shadow root needed here).
// ---------------------------------------------------------------------
const DEMO_LINES = [
  { text: 'Never gonna give you up', duration: 2.6 },
  { text: 'Never gonna let you down', duration: 2.6 },
  { text: 'Never gonna run around and desert you', duration: 3.4 }
];
let demoIndex = 0;
let demoTimer = null;
let wordTimers = [];
let typewriterTimer = null;

function animFor(id) {
  switch (id) {
    case 'fade': return { kf: [{ opacity: 0 }, { opacity: 1 }], opts: { duration: 320, easing: 'ease' } };
    case 'zoom-in': return { kf: [{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1)' }], opts: { duration: 320, easing: 'ease' } };
    case 'zoom-out': return { kf: [{ opacity: 0, transform: 'scale(1.6)' }, { opacity: 1, transform: 'scale(1)' }], opts: { duration: 320, easing: 'ease' } };
    case 'slide-up': return { kf: [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'translateY(0)' }], opts: { duration: 320, easing: 'ease' } };
    case 'slide-down': return { kf: [{ opacity: 0, transform: 'translateY(-24px)' }, { opacity: 1, transform: 'translateY(0)' }], opts: { duration: 320, easing: 'ease' } };
    case 'slide-left': return { kf: [{ opacity: 0, transform: 'translateX(32px)' }, { opacity: 1, transform: 'translateX(0)' }], opts: { duration: 320, easing: 'ease' } };
    case 'slide-right': return { kf: [{ opacity: 0, transform: 'translateX(-32px)' }, { opacity: 1, transform: 'translateX(0)' }], opts: { duration: 320, easing: 'ease' } };
    case 'bounce': return { kf: [{ opacity: 0, transform: 'translateY(20px) scale(0.9)', offset: 0 }, { opacity: 1, transform: 'translateY(-6px) scale(1.03)', offset: 0.6 }, { opacity: 1, transform: 'translateY(0) scale(1)', offset: 1 }], opts: { duration: 420, easing: 'cubic-bezier(.34,1.56,.64,1)' } };
    case 'fade-slide': return { kf: [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'translateY(0)' }], opts: { duration: 360, easing: 'ease' } };
    case 'fade-zoom': return { kf: [{ opacity: 0, transform: 'scale(0.85)' }, { opacity: 1, transform: 'scale(1)' }], opts: { duration: 360, easing: 'ease' } };
    case 'wave': return { kf: [{ transform: 'translateY(0)', offset: 0 }, { transform: 'translateY(-4px)', offset: 0.25 }, { transform: 'translateY(0)', offset: 0.5 }, { transform: 'translateY(4px)', offset: 0.75 }, { transform: 'translateY(0)', offset: 1 }], opts: { duration: 2200, easing: 'ease-in-out', iterations: Infinity } };
    case 'glow-pulse': return { kf: [{ textShadow: '0 0 6px currentColor, 0 0 2px currentColor' }, { textShadow: '0 0 18px currentColor, 0 0 8px currentColor' }, { textShadow: '0 0 6px currentColor, 0 0 2px currentColor' }], opts: { duration: 1800, easing: 'ease-in-out', iterations: Infinity } };
    case 'blur-in': return { kf: [{ opacity: 0, filter: 'blur(10px)' }, { opacity: 1, filter: 'blur(0px)' }], opts: { duration: 360, easing: 'ease-out' } };
    case 'flip': return { kf: [{ opacity: 0, transform: 'perspective(500px) rotateX(85deg)' }, { opacity: 1, transform: 'perspective(500px) rotateX(0deg)' }], opts: { duration: 380, easing: 'ease-out' } };
    case 'typewriter': return null;
    default: return { kf: [{ opacity: 0 }, { opacity: 1 }], opts: { duration: 300, easing: 'ease' } };
  }
}

function runAnim(el, id) {
  el.getAnimations().forEach((a) => a.cancel());
  const preset = animFor(id);
  if (!preset) return;
  el.animate(preset.kf, preset.opts);
}

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

function hexToRgba(hex, alpha) {
  const h = (hex || '#000000').replace('#', '');
  const bigint = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function typographyStyle(el, sizeMultiplier, opacityMultiplier) {
  const f = settings.font, c = settings.color;
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
  el.style.whiteSpace = 'pre-wrap';
  el.style.wordBreak = 'break-word';
}

function clearWordTimers() {
  wordTimers.forEach((t) => clearTimeout(t));
  wordTimers = [];
}

function buildPreviewMount() {
  els.previewMount.innerHTML = '';
  els.previewMount.style.display = 'flex';
  els.previewMount.style.position = 'absolute';
  els.previewMount.style.flexDirection = 'column';
  els.previewMount.style.maxWidth = '90%';

  applyPreviewPosition();

  if (settings.displayMode === 'word-pop') {
    const word = document.createElement('div');
    word.id = 'pvWord';
    els.previewMount.appendChild(word);
    return { word };
  }
  if (settings.displayMode === 'vertical') {
    const col = document.createElement('div');
    col.id = 'pvCol';
    col.style.display = 'flex';
    col.style.flexDirection = 'column';
    els.previewMount.appendChild(col);
    return { col };
  }
  const cur = document.createElement('div');
  cur.id = 'pvCur';
  const next = document.createElement('div');
  next.id = 'pvNext';
  els.previewMount.appendChild(cur);
  els.previewMount.appendChild(next);
  return { cur, next };
}

function applyPreviewPosition() {
  const { mode, xPercent, yPercent } = settings.position;
  let top, left, transform;
  if (mode === 'top') { top = '8%'; left = '50%'; transform = 'translateX(-50%)'; }
  else if (mode === 'center') { top = '50%'; left = '50%'; transform = 'translate(-50%, -50%)'; }
  else if (mode === 'custom') { top = `${yPercent}%`; left = `${xPercent}%`; transform = 'translate(-50%, -50%)'; }
  else { top = `${yPercent || 88}%`; left = '50%'; transform = 'translateX(-50%)'; }
  els.previewMount.style.top = top;
  els.previewMount.style.left = left;
  els.previewMount.style.transform = transform;
  els.previewMount.style.alignItems =
    settings.alignment === 'left' ? 'flex-start' : settings.alignment === 'right' ? 'flex-end' : 'center';
  els.previewMount.style.textAlign = settings.alignment;
  els.previewMount.style.gap = `${settings.lineSpacing}px`;
}

function scheduleDemoWords(text, durationSec, onWord) {
  clearWordTimers();
  const words = text.trim().split(/\s+/).filter(Boolean);
  const totalMs = Math.max(300, durationSec * 1000);
  const perWordMs = Math.min(900, Math.max(150, totalMs / words.length));
  words.forEach((word, i) => {
    const t = setTimeout(() => onWord(word), i * perWordMs);
    wordTimers.push(t);
  });
}

function renderPreviewLine() {
  clearWordTimers();
  const line = DEMO_LINES[demoIndex];
  const next = DEMO_LINES[(demoIndex + 1) % DEMO_LINES.length];
  const parts = buildPreviewMount();

  if (settings.displayMode === 'word-pop') {
    typographyStyle(parts.word, 1.3, 1);
    scheduleDemoWords(line.text, line.duration, (word) => {
      if (settings.animation === 'typewriter') runTypewriter(parts.word, word);
      else { parts.word.textContent = word; runAnim(parts.word, settings.animation); }
    });
  } else if (settings.displayMode === 'vertical') {
    scheduleDemoWords(line.text, line.duration, (word) => {
      const el = document.createElement('div');
      typographyStyle(el, 1, 1);
      el.textContent = word;
      parts.col.appendChild(el);
      while (parts.col.children.length > 6) parts.col.removeChild(parts.col.firstChild);
      if (settings.animation === 'typewriter') runTypewriter(el, word);
      else runAnim(el, settings.animation);
    });
  } else {
    typographyStyle(parts.cur, 1, 1);
    typographyStyle(parts.next, 0.75, 0.6);
    parts.next.style.display = settings.visibleLines > 1 ? '' : 'none';
    if (!settings.highlightCurrent) parts.cur.style.opacity = parts.next.style.opacity;
    if (settings.animation === 'typewriter') runTypewriter(parts.cur, line.text);
    else { parts.cur.textContent = line.text; runAnim(parts.cur, settings.animation); }
    parts.next.textContent = settings.visibleLines > 1 ? next.text : '';
  }
}

function startPreviewLoop() {
  clearInterval(demoTimer);
  renderPreviewLine();
  demoTimer = setInterval(() => {
    demoIndex = (demoIndex + 1) % DEMO_LINES.length;
    renderPreviewLine();
  }, 3200);
}

// ---------------------------------------------------------------------
// Position pad (drag to set custom x/y)
// ---------------------------------------------------------------------
function updatePosDot() {
  const { mode, xPercent, yPercent } = settings.position;
  let x = xPercent, y = yPercent;
  if (mode === 'top') { x = 50; y = 8; }
  else if (mode === 'center') { x = 50; y = 50; }
  else if (mode === 'bottom') { x = 50; y = 88; }
  els.posDot.style.left = `${x}%`;
  els.posDot.style.top = `${y}%`;

  els.posQuickBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === mode));
}

function setupPositionPad() {
  let dragging = false;

  function setFromEvent(e) {
    const rect = els.posPad.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
    settings.position.mode = 'custom';
    settings.position.xPercent = Math.round(x);
    settings.position.yPercent = Math.round(y);
    updatePosDot();
    applyPreviewPosition();
  }

  els.posPad.addEventListener('pointerdown', (e) => {
    dragging = true;
    els.posPad.setPointerCapture(e.pointerId);
    setFromEvent(e);
  });
  els.posPad.addEventListener('pointermove', (e) => {
    if (dragging) setFromEvent(e);
  });
  els.posPad.addEventListener('pointerup', () => {
    if (dragging) {
      dragging = false;
      persistSettings();
    }
  });

  els.posQuickBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      settings.position.mode = btn.dataset.mode;
      updatePosDot();
      applyPreviewPosition();
      persistSettings();
    });
  });
}

// ---------------------------------------------------------------------
// Form <-> settings
// ---------------------------------------------------------------------
function loadFormFromSettings() {
  els.displayModeRow.querySelectorAll('.pill-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === settings.displayMode);
  });
  els.visibleLinesField.style.display = settings.displayMode === 'line' ? '' : 'none';

  els.animation.value = settings.animation;
  els.fontChoice.value = FONT_CHOICES.find((f) => f.family === settings.font.family)?.id || FONT_CHOICES[0].id;

  els.fontSize.value = settings.font.size;
  els.fontSizeVal.textContent = `${settings.font.size}px`;
  els.fontWeight.value = settings.font.weight;
  els.fontStyle.value = settings.font.style;

  els.textColor.value = settings.color.text;
  els.outlineColor.value = settings.color.outline;
  els.outlineWidth.value = settings.color.outlineWidth;
  els.outlineWidthVal.textContent = `${settings.color.outlineWidth}px`;
  els.shadowColor.value = settings.color.shadow;
  els.shadowOpacity.value = settings.color.shadowOpacity;
  els.shadowOpacityVal.textContent = settings.color.shadowOpacity.toFixed(2);
  els.textOpacity.value = settings.color.opacity;
  els.textOpacityVal.textContent = settings.color.opacity.toFixed(2);

  els.bgColor.value = settings.background.color;
  els.bgOpacity.value = settings.background.opacity;
  els.bgOpacityVal.textContent = settings.background.opacity.toFixed(2);

  els.alignment.value = settings.alignment;
  els.lineSpacing.value = settings.lineSpacing;
  els.lineSpacingVal.textContent = `${settings.lineSpacing}px`;
  els.visibleLines.value = String(settings.visibleLines);
  els.highlightCurrent.checked = settings.highlightCurrent;

  els.timingOffset.value = settings.timingOffsetMs;
  els.timingOffsetVal.textContent = `${settings.timingOffsetMs}ms`;

  updatePosDot();
  startPreviewLoop();
}

function readFormIntoSettings() {
  settings.animation = els.animation.value;
  const fontChoice = FONT_CHOICES.find((f) => f.id === els.fontChoice.value) || FONT_CHOICES[0];
  settings.font.family = fontChoice.family;
  settings.font.size = Number(els.fontSize.value);
  settings.font.weight = els.fontWeight.value;
  settings.font.style = els.fontStyle.value;

  settings.color.text = els.textColor.value;
  settings.color.outline = els.outlineColor.value;
  settings.color.outlineWidth = Number(els.outlineWidth.value);
  settings.color.shadow = els.shadowColor.value;
  settings.color.shadowOpacity = Number(els.shadowOpacity.value);
  settings.color.opacity = Number(els.textOpacity.value);

  settings.background.color = els.bgColor.value;
  settings.background.opacity = Number(els.bgOpacity.value);

  settings.alignment = els.alignment.value;
  settings.lineSpacing = Number(els.lineSpacing.value);
  settings.visibleLines = Number(els.visibleLines.value);
  settings.highlightCurrent = els.highlightCurrent.checked;

  settings.timingOffsetMs = Number(els.timingOffset.value);
}

let saveDebounce = null;
function persistSettings() {
  clearTimeout(saveDebounce);
  saveDebounce = setTimeout(() => {
    chrome.runtime.sendMessage({ target: 'background', type: 'UPDATE_SETTINGS', settings });
  }, 120);
}

function onFormChange(opts = {}) {
  if (!opts.skipRead) readFormIntoSettings();

  els.displayModeRow.querySelectorAll('.pill-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === settings.displayMode);
  });
  els.visibleLinesField.style.display = settings.displayMode === 'line' ? '' : 'none';

  els.fontSizeVal.textContent = `${settings.font.size}px`;
  els.outlineWidthVal.textContent = `${settings.color.outlineWidth}px`;
  els.shadowOpacityVal.textContent = settings.color.shadowOpacity.toFixed(2);
  els.textOpacityVal.textContent = settings.color.opacity.toFixed(2);
  els.bgOpacityVal.textContent = settings.background.opacity.toFixed(2);
  els.lineSpacingVal.textContent = `${settings.lineSpacing}px`;
  els.timingOffsetVal.textContent = `${settings.timingOffsetMs}ms`;

  startPreviewLoop();
  persistSettings();
}

async function init() {
  populateDisplayModePills();
  populateSelect(els.animation, ANIMATION_PRESETS, 'id', 'label');
  populateSelect(els.fontChoice, FONT_CHOICES, 'id', 'label');
  setupPositionPad();

  const stored = await chrome.storage.local.get([STORAGE_KEYS.SETTINGS]);
  const saved = stored[STORAGE_KEYS.SETTINGS] || {};
  settings = structuredClone(DEFAULT_SETTINGS);
  Object.assign(settings, saved);
  settings.font = { ...DEFAULT_SETTINGS.font, ...(saved.font || {}) };
  settings.color = { ...DEFAULT_SETTINGS.color, ...(saved.color || {}) };
  settings.background = { ...DEFAULT_SETTINGS.background, ...(saved.background || {}) };
  settings.position = { ...DEFAULT_SETTINGS.position, ...(saved.position || {}) };

  loadFormFromSettings();

  const controls = [
    els.animation, els.fontChoice, els.fontSize, els.fontWeight, els.fontStyle,
    els.textColor, els.outlineColor, els.outlineWidth, els.shadowColor, els.shadowOpacity, els.textOpacity,
    els.bgColor, els.bgOpacity,
    els.alignment, els.lineSpacing, els.visibleLines, els.highlightCurrent,
    els.timingOffset
  ];
  controls.forEach((el) => {
    el.addEventListener('input', () => onFormChange());
    el.addEventListener('change', () => onFormChange());
  });

  els.resetBtn.addEventListener('click', () => {
    settings = structuredClone(DEFAULT_SETTINGS);
    loadFormFromSettings();
    persistSettings();
  });
}

init();
