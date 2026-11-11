const CAPTURE_FILE = 'content/capture.js';
const OFFSCREEN_PATH = 'offscreen.html';
const EDITOR_PATH = 'editor.html';
const JPEG_QUALITY = 0.92;
const EDIT_SESSION_TTL_MS = 60 * 60 * 1000;
const CAPTURE_WINDOW_MS = 1000;
const CAPTURE_MAX_PER_WINDOW = 1;
const CAPTURE_RETRY_BASE_MS = 1300;
let creatingOffscreen;
let captureQueue = Promise.resolve();
const captureCallTimes = [];
/** @type {Map<string, { dataUrl: string, meta: object }>} */
const editSessions = new Map();

function editSessionKey(sessionId) {
  return `yoo-edit:${sessionId}`;
}

function pruneEditSessions() {
  const now = Date.now();
  for (const [id, entry] of editSessions) {
    if (now - (entry.createdAt || 0) > EDIT_SESSION_TTL_MS) {
      editSessions.delete(id);
      chrome.storage.session.remove(editSessionKey(id)).catch(() => {});
    }
  }
}

async function storeEditSession(sessionId, dataUrl, meta) {
  const payload = { dataUrl, meta, createdAt: Date.now() };
  editSessions.set(sessionId, payload);
  try {
    await chrome.storage.session.set({ [editSessionKey(sessionId)]: payload });
  } catch (err) {
    console.warn('[yoo-be-screenshot] session storage unavailable, using memory only', err);
  }
}

async function getEditSession(sessionId) {
  pruneEditSessions();
  const mem = editSessions.get(sessionId);
  if (mem) {
    return mem;
  }
  const stored = await chrome.storage.session.get(editSessionKey(sessionId));
  const entry = stored[editSessionKey(sessionId)];
  if (entry) {
    editSessions.set(sessionId, entry);
    return entry;
  }
  return null;
}

async function removeEditSession(sessionId) {
  editSessions.delete(sessionId);
  await chrome.storage.session.remove(editSessionKey(sessionId)).catch(() => {});
}

async function openEditorTab(dataUrl, meta) {
  const sessionId = crypto.randomUUID();
  await storeEditSession(sessionId, dataUrl, meta);
  const url = `${chrome.runtime.getURL(EDITOR_PATH)}?session=${encodeURIComponent(sessionId)}`;
  await chrome.tabs.create({ url, active: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCaptureQuotaError(message) {
  return /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota/i.test(message || '');
}

function pruneCaptureCallTimes(now) {
  while (captureCallTimes.length && captureCallTimes[0] <= now - CAPTURE_WINDOW_MS) {
    captureCallTimes.shift();
  }
}

async function acquireCaptureSlot() {
  for (;;) {
    const now = Date.now();
    pruneCaptureCallTimes(now);
    if (captureCallTimes.length < CAPTURE_MAX_PER_WINDOW) {
      captureCallTimes.push(now);
      return;
    }
    const waitMs = captureCallTimes[0] + CAPTURE_WINDOW_MS - now + 100;
    await sleep(Math.max(waitMs, 250));
  }
}

function resetCaptureQuotaWindow() {
  captureCallTimes.length = 0;
}

function normalizeFormat(imageFormat) {
  return imageFormat === 'png' ? 'png' : 'jpg';
}

function formatOptions(imageFormat) {
  const png = normalizeFormat(imageFormat) === 'png';
  return {
    ext: png ? 'png' : 'jpg',
    mime: png ? 'image/png' : 'image/jpeg',
    capture: png ? 'png' : 'jpeg',
    quality: png ? undefined : Math.round(JPEG_QUALITY * 100)
  };
}

function formatLocalTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function slugifySegment(text, maxLen) {
  return String(text)
    .trim()
    .replace(/[\s/\\]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen);
}

function buildFilename({ pageUrl, pageTitle, mode, imageFormat }) {
  const { ext } = formatOptions(imageFormat);
  const modeLabel = { visible: 'visible', fullpage: 'fullpage', selection: 'region' }[mode] || 'shot';
  const ts = formatLocalTimestamp();

  let slug = 'screenshot';
  try {
    const u = new URL(pageUrl);
    const host = slugifySegment(u.hostname, 40) || 'page';
    const port = u.port ? `-${u.port}` : '';
    let path = slugifySegment(u.pathname.replace(/^\/+|\/+$/g, '').split('/').join('-'), 40);
    if (!path && pageTitle) {
      path = slugifySegment(pageTitle, 40);
    }
    slug = slugifySegment(`${host}${port}${path ? `-${path}` : ''}`, 72) || host;
  } catch {
    if (pageTitle) {
      slug = slugifySegment(pageTitle, 48) || slug;
    }
  }

  let name = `yoo-${slug}-${modeLabel}-${ts}.${ext}`;
  name = name.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '-');
  return name.slice(0, 180) || `yoo-screenshot-${ts}.${ext}`;
}

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  if (chrome.runtime.getContexts) {
    const existing = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [url]
    });
    if (existing.length > 0) {
      return;
    }
  }
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  try {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['BLOBS'],
      justification: '创建 Blob URL，以便下载时使用自定义文件名'
    });
    await creatingOffscreen;
  } catch (err) {
    const duplicate =
      err?.message?.includes('Only a single offscreen') ||
      err?.message?.includes('already exists');
    if (!duplicate) {
      throw err;
    }
  } finally {
    creatingOffscreen = null;
  }
}

function sendOffscreenMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || '离屏页处理失败'));
        return;
      }
      resolve(response);
    });
  });
}

async function downloadViaOffscreen(dataUrl, filename) {
  await ensureOffscreenDocument();
  const { objectUrl } = await sendOffscreenMessage({ type: 'YOO_OFFSCREEN_BLOB', dataUrl });
  try {
    const downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download(
        {
          url: objectUrl,
          filename,
          saveAs: false,
          conflictAction: 'uniquify'
        },
        (id) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (id === undefined) {
            reject(new Error('下载失败'));
            return;
          }
          resolve(id);
        }
      );
    });
    return downloadId;
  } finally {
    sendOffscreenMessage({ type: 'YOO_OFFSCREEN_REVOKE', objectUrl }).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'YOO_OFFSCREEN_BLOB' || message?.type === 'YOO_OFFSCREEN_REVOKE') {
    return;
  }

  if (message?.type === 'CAPTURE_VISIBLE_TAB') {
    const windowId = sender.tab?.windowId;
    captureVisibleThrottled(windowId, message.imageFormat)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === 'START_CAPTURE') {
    const { mode } = message;
    if (mode === 'fullpage' || mode === 'selection') {
      runCapture(message).catch((err) => console.error('[yoo-be-screenshot]', err));
      sendResponse({ ok: true });
      return false;
    }
    runCapture(message)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === 'FINISH_CAPTURE') {
    finishAndDownload(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === 'EDITOR_LOAD_SESSION') {
    getEditSession(message.sessionId)
      .then((entry) => {
        if (!entry?.dataUrl) {
          sendResponse({ ok: false, error: '编辑会话已过期或不存在' });
          return;
        }
        sendResponse({ ok: true, dataUrl: entry.dataUrl, meta: entry.meta });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === 'EDITOR_DOWNLOAD') {
    finishEditorDownload(message.sessionId, message.dataUrl)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

async function captureVisible(windowId, imageFormat) {
  const { capture, quality } = formatOptions(imageFormat);
  const options = { format: capture };
  if (quality !== undefined) {
    options.quality = quality;
  }
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId ?? null, options, (dataUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!dataUrl) {
        reject(new Error('captureVisibleTab 未返回图像'));
        return;
      }
      resolve(dataUrl);
    });
  });
}

async function captureVisibleThrottled(windowId, imageFormat) {
  const task = async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      await acquireCaptureSlot();
      try {
        return await captureVisible(windowId, imageFormat);
      } catch (err) {
        if (isCaptureQuotaError(err.message) && attempt < 7) {
          resetCaptureQuotaWindow();
          await sleep(CAPTURE_RETRY_BASE_MS * (attempt + 1));
          continue;
        }
        throw err;
      }
    }
    throw new Error('captureVisibleTab 调用过于频繁');
  };

  const result = captureQueue.then(task, task);
  captureQueue = result.then(
    () => {},
    () => {}
  );
  return result;
}

async function injectCaptureScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CAPTURE_FILE]
  });
}

async function runCapture({ tabId, mode, addUrl, pageUrl, pageTitle, imageFormat }) {
  const fmt = normalizeFormat(imageFormat);
  const tab = await chrome.tabs.get(tabId);
  const windowId = tab.windowId;
  const meta = {
    addUrl,
    pageUrl,
    pageTitle: pageTitle || tab.title || '',
    mode,
    imageFormat: fmt
  };

  if (mode === 'visible') {
    const dataUrl = await captureVisibleThrottled(windowId, fmt);
    await saveImage(dataUrl, meta);
    return { ok: true };
  }

  await injectCaptureScript(tabId);

  if (mode === 'fullpage') {
    const pageResult = await chrome.tabs.sendMessage(tabId, {
      type: 'YOO_START_FULLPAGE',
      addUrl,
      pageUrl,
      imageFormat: fmt
    });
    if (!pageResult?.ok) {
      throw new Error(pageResult?.error || '整页截图失败');
    }
    return { ok: true };
  }

  if (mode === 'selection') {
    const payload = await chrome.tabs.sendMessage(tabId, { type: 'YOO_START_SELECTION' });
    if (!payload?.ok && !payload?.cancelled) {
      throw new Error(payload?.error || '选区截图失败');
    }
    if (payload?.cancelled) {
      return { ok: false, error: '已取消选区' };
    }
    if (payload?.error) {
      throw new Error(payload.error);
    }
    if (!payload?.rect) {
      throw new Error('未获取选区');
    }

    const dataUrl = await captureVisibleThrottled(windowId, fmt);
    const cropped = await cropDataUrl(dataUrl, payload.rect, payload.devicePixelRatio || 1, fmt);
    await saveImage(cropped, meta);
    return { ok: true };
  }

  throw new Error(`未知模式: ${mode}`);
}

async function finishAndDownload(payload) {
  await saveImage(payload.dataUrl, {
    addUrl: payload.addUrl,
    pageUrl: payload.pageUrl,
    pageTitle: payload.pageTitle || '',
    mode: payload.mode,
    imageFormat: normalizeFormat(payload.imageFormat)
  });
}

async function cropDataUrl(dataUrl, rect, dpr, imageFormat) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const sx = Math.round(rect.x * dpr);
  const sy = Math.round(rect.y * dpr);
  const sw = Math.round(rect.width * dpr);
  const sh = Math.round(rect.height * dpr);

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

  const { mime, quality } = blobExportOptions(imageFormat);
  const outBlob = await canvas.convertToBlob({ type: mime, quality });
  return blobToDataUrl(outBlob);
}

async function drawUrlBar(dataUrl, pageUrl, imageFormat) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const barHeight = Math.max(28, Math.round(bitmap.height * 0.04));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height + barHeight);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(0, bitmap.height, bitmap.width, barHeight);
  ctx.fillStyle = '#ffffff';
  ctx.font = `${Math.round(barHeight * 0.45)}px system-ui, sans-serif`;
  const text = pageUrl.length > 120 ? `${pageUrl.slice(0, 117)}…` : pageUrl;
  ctx.fillText(text, 12, bitmap.height + barHeight * 0.68);

  const { mime, quality } = blobExportOptions(imageFormat);
  const outBlob = await canvas.convertToBlob({ type: mime, quality });
  return blobToDataUrl(outBlob);
}

function blobExportOptions(imageFormat) {
  const png = normalizeFormat(imageFormat) === 'png';
  return {
    mime: png ? 'image/png' : 'image/jpeg',
    quality: png ? undefined : JPEG_QUALITY
  };
}

async function saveImage(dataUrl, { addUrl, pageUrl, pageTitle, mode, imageFormat }) {
  const fmt = normalizeFormat(imageFormat);
  const finalUrl = await reencodeDataUrl(dataUrl, fmt);
  await openEditorTab(finalUrl, {
    addUrl: Boolean(addUrl && pageUrl),
    pageUrl: pageUrl || '',
    pageTitle: pageTitle || '',
    mode: mode || 'visible',
    imageFormat: fmt
  });
}

async function finishEditorDownload(sessionId, dataUrl) {
  const entry = await getEditSession(sessionId);
  if (!entry?.meta) {
    throw new Error('编辑会话已过期');
  }
  const { addUrl, pageUrl, pageTitle, mode, imageFormat } = entry.meta;
  const fmt = normalizeFormat(imageFormat);
  let finalUrl = dataUrl;
  if (addUrl && pageUrl) {
    finalUrl = await drawUrlBar(dataUrl, pageUrl, fmt);
  } else {
    finalUrl = await reencodeDataUrl(finalUrl, fmt);
  }
  const filename = buildFilename({ pageUrl, pageTitle, mode, imageFormat: fmt });
  await downloadViaOffscreen(finalUrl, filename);
}

async function reencodeDataUrl(dataUrl, imageFormat) {
  const { mime } = formatOptions(imageFormat);
  if (dataUrl.startsWith(`data:${mime}`)) {
    return dataUrl;
  }
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const { mime: outMime, quality } = blobExportOptions(imageFormat);
  const outBlob = await canvas.convertToBlob({ type: outMime, quality });
  return blobToDataUrl(outBlob);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
