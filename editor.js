const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const canvasWrap = document.getElementById('canvas-wrap');
const cropLayer = document.getElementById('crop-layer');
const cropBox = document.getElementById('crop-box');
const loadingEl = document.getElementById('loading');
const loadErrorEl = document.getElementById('load-error');
const metaLabel = document.getElementById('meta-label');
const brushOptions = document.getElementById('brush-options');
const textOptions = document.getElementById('text-options');
const applyCropBtn = document.getElementById('apply-crop');
const cancelCropBtn = document.getElementById('cancel-crop');
const textPopover = document.getElementById('text-popover');
const textInput = document.getElementById('text-input');

const MAX_HISTORY = 40;

let sessionMeta = null;
let currentTool = 'pointer';
let history = [];
let historyIndex = -1;
let restoringHistory = false;

let brushDrawing = false;
let lastBrush = null;

let cropRect = null;
let cropDrag = null;

let pendingText = null;

const params = new URLSearchParams(location.search);
const sessionId = params.get('session');

function setTool(tool) {
  currentTool = tool;
  document.querySelectorAll('.tool[data-tool]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-tool') === tool);
  });
  canvasWrap.className = `canvas-wrap tool-${tool}`;
  brushOptions.hidden = tool !== 'brush';
  textOptions.hidden = tool !== 'text';
  const inCrop = tool === 'crop';
  cropLayer.hidden = !inCrop;
  cropLayer.classList.toggle('is-active', inCrop);
  applyCropBtn.hidden = !inCrop;
  cancelCropBtn.hidden = !inCrop;
  if (inCrop) {
    initCropRect();
  } else {
    hideTextPopover();
  }
}

function updateHistoryButtons() {
  document.getElementById('undo').disabled = historyIndex <= 0;
  document.getElementById('redo').disabled = historyIndex < 0 || historyIndex >= history.length - 1;
}

async function pushHistory(dataUrl) {
  if (restoringHistory) {
    return;
  }
  history = history.slice(0, historyIndex + 1);
  history.push(dataUrl);
  if (history.length > MAX_HISTORY) {
    history.shift();
  } else {
    historyIndex += 1;
  }
  updateHistoryButtons();
}

async function loadImageToCanvas(dataUrl) {
  const img = await loadImage(dataUrl);
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  loadingEl.hidden = true;
  canvasWrap.hidden = false;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('无法加载图片'));
    img.src = src;
  });
}

async function snapshotFromCanvas() {
  const mime = sessionMeta?.imageFormat === 'png' ? 'image/png' : 'image/jpeg';
  const quality = mime === 'image/jpeg' ? 0.92 : undefined;
  return canvas.toDataURL(mime, quality);
}

async function commitCanvasState() {
  await pushHistory(await snapshotFromCanvas());
}

async function restoreHistory(index) {
  if (index < 0 || index >= history.length) {
    return;
  }
  restoringHistory = true;
  historyIndex = index;
  await loadImageToCanvas(history[index]);
  restoringHistory = false;
  updateHistoryButtons();
  if (currentTool === 'crop') {
    initCropRect();
  }
}

function canvasPointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  return { x, y };
}

function getBrushSize() {
  const display = Number(document.getElementById('brush-size').value) || 4;
  const rect = canvas.getBoundingClientRect();
  const scale = canvas.width / rect.width;
  return Math.max(1, display * scale);
}

function getTextFontSize() {
  const display = Number(document.getElementById('text-size').value) || 24;
  const rect = canvas.getBoundingClientRect();
  const scale = canvas.width / rect.width;
  return Math.max(12, Math.round(display * scale));
}

canvas.addEventListener('pointerdown', (event) => {
  if (currentTool === 'brush') {
    brushDrawing = true;
    const p = canvasPointFromEvent(event);
    lastBrush = p;
    ctx.strokeStyle = document.getElementById('brush-color').value;
    ctx.lineWidth = getBrushSize();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    canvas.setPointerCapture(event.pointerId);
  } else if (currentTool === 'text') {
    const p = canvasPointFromEvent(event);
    showTextPopover(p, event.clientX, event.clientY);
  }
});

canvas.addEventListener('pointermove', (event) => {
  if (!brushDrawing || currentTool !== 'brush') {
    return;
  }
  const p = canvasPointFromEvent(event);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  lastBrush = p;
});

async function endBrushStroke() {
  if (!brushDrawing) {
    return;
  }
  brushDrawing = false;
  lastBrush = null;
  ctx.closePath();
  await commitCanvasState();
}

canvas.addEventListener('pointerup', endBrushStroke);
canvas.addEventListener('pointercancel', endBrushStroke);

function showTextPopover(canvasPoint, clientX, clientY) {
  pendingText = canvasPoint;
  textPopover.hidden = false;
  textInput.value = '';
  const pad = 8;
  let left = clientX;
  let top = clientY + 12;
  const w = textPopover.offsetWidth || 280;
  const h = textPopover.offsetHeight || 48;
  if (left + w > window.innerWidth - pad) {
    left = window.innerWidth - w - pad;
  }
  if (top + h > window.innerHeight - pad) {
    top = clientY - h - 12;
  }
  textPopover.style.left = `${Math.max(pad, left)}px`;
  textPopover.style.top = `${Math.max(pad, top)}px`;
  textInput.focus();
}

function hideTextPopover() {
  textPopover.hidden = true;
  pendingText = null;
  textInput.value = '';
}

async function confirmText() {
  const value = textInput.value.trim();
  if (!value || !pendingText) {
    hideTextPopover();
    return;
  }
  const size = getTextFontSize();
  ctx.fillStyle = document.getElementById('text-color').value;
  ctx.font = `${size}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(value, pendingText.x, pendingText.y);
  hideTextPopover();
  await commitCanvasState();
}

async function rotateCanvas(direction) {
  const src = await loadImage(await snapshotFromCanvas());
  const w = canvas.width;
  const h = canvas.height;
  const cw = h;
  const ch = w;
  const prev = document.createElement('canvas');
  prev.width = w;
  prev.height = h;
  const pctx = prev.getContext('2d');
  pctx.drawImage(src, 0, 0);

  canvas.width = cw;
  canvas.height = ch;
  ctx.save();
  if (direction === 'cw') {
    ctx.translate(cw, 0);
    ctx.rotate(Math.PI / 2);
  } else {
    ctx.translate(0, ch);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(prev, 0, 0);
  ctx.restore();
  await commitCanvasState();
  if (currentTool === 'crop') {
    initCropRect();
  }
}

function initCropRect() {
  const margin = Math.min(canvas.width, canvas.height) * 0.08;
  cropRect = {
    x: margin,
    y: margin,
    width: canvas.width - margin * 2,
    height: canvas.height - margin * 2
  };
  layoutCropOverlay();
}

function layoutCropOverlay() {
  if (!cropRect) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const sx = rect.width / canvas.width;
  const sy = rect.height / canvas.height;
  const left = cropRect.x * sx;
  const top = cropRect.y * sy;
  const width = cropRect.width * sx;
  const height = cropRect.height * sy;
  cropBox.style.left = `${left}px`;
  cropBox.style.top = `${top}px`;
  cropBox.style.width = `${width}px`;
  cropBox.style.height = `${height}px`;

  const wrap = canvasWrap.getBoundingClientRect();
  const box = cropBox.getBoundingClientRect();
  const relLeft = box.left - wrap.left;
  const relTop = box.top - wrap.top;
  const relRight = relLeft + width;
  const relBottom = relTop + height;
  const tw = wrap.width;
  const th = wrap.height;

  document.getElementById('crop-top').style.cssText =
    `left:0;top:0;width:100%;height:${Math.max(0, relTop)}px`;
  document.getElementById('crop-bottom').style.cssText =
    `left:0;top:${relBottom}px;width:100%;height:${Math.max(0, th - relBottom)}px`;
  document.getElementById('crop-left').style.cssText =
    `left:0;top:${relTop}px;width:${Math.max(0, relLeft)}px;height:${height}px`;
  document.getElementById('crop-right').style.cssText =
    `left:${relRight}px;top:${relTop}px;width:${Math.max(0, tw - relRight)}px;height:${height}px`;
}

function startCropDrag(kind, event) {
  event.preventDefault();
  cropDrag = {
    kind,
    startX: event.clientX,
    startY: event.clientY,
    startRect: { ...cropRect }
  };
  const onMove = (e) => {
    if (!cropDrag) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const dx = ((e.clientX - cropDrag.startX) / rect.width) * canvas.width;
    const dy = ((e.clientY - cropDrag.startY) / rect.height) * canvas.height;
  const r = cropDrag.startRect;
    let { x, y, width, height } = r;
    const minSize = 16;

    if (cropDrag.kind === 'move') {
      x = clamp(r.x + dx, 0, canvas.width - width);
      y = clamp(r.y + dy, 0, canvas.height - height);
    } else {
      if (cropDrag.kind.includes('e')) {
        width = clamp(r.width + dx, minSize, canvas.width - r.x);
      }
      if (cropDrag.kind.includes('w')) {
        const nw = clamp(r.width - dx, minSize, r.x + r.width);
        x = r.x + r.width - nw;
        width = nw;
      }
      if (cropDrag.kind.includes('s')) {
        height = clamp(r.height + dy, minSize, canvas.height - r.y);
      }
      if (cropDrag.kind.includes('n')) {
        const nh = clamp(r.height - dy, minSize, r.y + r.height);
        y = r.y + r.height - nh;
        height = nh;
      }
      x = clamp(x, 0, canvas.width - minSize);
      y = clamp(y, 0, canvas.height - minSize);
      width = Math.min(width, canvas.width - x);
      height = Math.min(height, canvas.height - y);
    }

    cropRect = { x, y, width, height };
    layoutCropOverlay();
  };
  const onUp = () => {
    cropDrag = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

cropBox.addEventListener('pointerdown', (event) => {
  if (event.target.classList.contains('crop-handle')) {
    const handle = [...event.target.classList].find((c) =>
      ['nw', 'ne', 'sw', 'se'].includes(c)
    );
    startCropDrag(handle, event);
  } else {
    startCropDrag('move', event);
  }
});

async function applyCrop() {
  if (!cropRect) {
    return;
  }
  const { x, y, width, height } = cropRect;
  const ix = Math.round(x);
  const iy = Math.round(y);
  const iw = Math.max(1, Math.round(width));
  const ih = Math.max(1, Math.round(height));
  const slice = ctx.getImageData(ix, iy, iw, ih);
  canvas.width = iw;
  canvas.height = ih;
  ctx.putImageData(slice, 0, 0);
  await commitCanvasState();
  setTool('pointer');
}

window.addEventListener('resize', () => {
  if (currentTool === 'crop') {
    layoutCropOverlay();
  }
});

async function loadSession() {
  if (!sessionId) {
    throw new Error('缺少编辑会话');
  }
  const response = await chrome.runtime.sendMessage({
    type: 'EDITOR_LOAD_SESSION',
    sessionId
  });
  if (!response?.ok) {
    throw new Error(response?.error || '无法加载截图');
  }
  sessionMeta = response.meta;
  canvasWrap.hidden = true;
  await loadImageToCanvas(response.dataUrl);
  history = [await snapshotFromCanvas()];
  historyIndex = 0;
  updateHistoryButtons();
  if (sessionMeta?.pageTitle) {
    metaLabel.hidden = false;
    metaLabel.textContent = sessionMeta.pageTitle;
  }
}

async function downloadEdited() {
  const dataUrl = await snapshotFromCanvas();
  const btn = document.getElementById('download-btn');
  btn.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'EDITOR_DOWNLOAD',
      sessionId,
      dataUrl
    });
    if (!response?.ok) {
      throw new Error(response?.error || '下载失败');
    }
    btn.textContent = '已下载';
    setTimeout(() => {
      btn.textContent = '下载';
    }, 2000);
  } catch (err) {
    alert(err.message || String(err));
  } finally {
    btn.disabled = false;
  }
}

async function copyToClipboard() {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    return;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    const btn = document.getElementById('copy-btn');
    const prev = btn.textContent;
    btn.textContent = '已复制';
    setTimeout(() => {
      btn.textContent = prev;
    }, 1500);
  } catch {
    alert('复制失败，请检查浏览器权限');
  }
}

document.querySelectorAll('.tool[data-tool]').forEach((btn) => {
  btn.addEventListener('click', () => setTool(btn.getAttribute('data-tool')));
});

document.getElementById('undo').addEventListener('click', () => restoreHistory(historyIndex - 1));
document.getElementById('redo').addEventListener('click', () => restoreHistory(historyIndex + 1));
document.getElementById('rotate-cw').addEventListener('click', () => rotateCanvas('cw'));
document.getElementById('rotate-ccw').addEventListener('click', () => rotateCanvas('ccw'));
document.getElementById('apply-crop').addEventListener('click', () => applyCrop());
document.getElementById('cancel-crop').addEventListener('click', () => setTool('pointer'));
document.getElementById('download-btn').addEventListener('click', downloadEdited);
document.getElementById('copy-btn').addEventListener('click', copyToClipboard);
document.getElementById('text-confirm').addEventListener('click', () => confirmText());
document.getElementById('text-cancel').addEventListener('click', () => hideTextPopover());
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    confirmText();
  }
  if (e.key === 'Escape') {
    hideTextPopover();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target === textInput) {
    return;
  }
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    restoreHistory(historyIndex - 1);
  }
  if (mod && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault();
    restoreHistory(historyIndex + 1);
  }
  if (e.key === 'Escape' && currentTool === 'crop') {
    setTool('pointer');
  }
});

setTool('pointer');

loadSession().catch((err) => {
  loadingEl.hidden = true;
  loadErrorEl.hidden = false;
  loadErrorEl.textContent = err.message || String(err);
});
