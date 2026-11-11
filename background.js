const CAPTURE_FILE = 'content/capture.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'CAPTURE_VISIBLE_TAB') {
    captureVisible()
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
});

async function captureVisible(windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId ?? null, { format: 'png' }, (dataUrl) => {
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

async function injectCaptureScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CAPTURE_FILE]
  });
}

async function runCapture({ tabId, mode, addUrl, pageUrl }) {
  const tab = await chrome.tabs.get(tabId);
  const windowId = tab.windowId;

  if (mode === 'visible') {
    const dataUrl = await captureVisible(windowId);
    await saveImage(dataUrl, { addUrl, pageUrl, mode });
    return { ok: true };
  }

  await injectCaptureScript(tabId);

  if (mode === 'fullpage') {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (addUrl, pageUrl) => {
        return window.__yooScreenshotRunFullPage(addUrl, pageUrl);
      },
      args: [addUrl, pageUrl]
    });
    if (result?.result?.error) {
      throw new Error(result.result.error);
    }
    return { ok: true };
  }

  if (mode === 'selection') {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.__yooScreenshotRunSelection(),
      args: []
    });
    const payload = result?.result;
    if (payload?.cancelled) {
      return { ok: false, error: '已取消选区' };
    }
    if (payload?.error) {
      throw new Error(payload.error);
    }
    if (!payload?.rect) {
      throw new Error('未获取选区');
    }

    const dataUrl = await captureVisible(windowId);
    const cropped = await cropDataUrl(dataUrl, payload.rect, payload.devicePixelRatio || 1);
    await saveImage(cropped, { addUrl, pageUrl, mode });
    return { ok: true };
  }

  throw new Error(`未知模式: ${mode}`);
}

async function finishAndDownload(payload) {
  const { dataUrl, addUrl, pageUrl, mode } = payload;
  await saveImage(dataUrl, { addUrl, pageUrl, mode });
}

async function cropDataUrl(dataUrl, rect, dpr) {
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

  const outBlob = await canvas.convertToBlob({ type: 'image/png' });
  return blobToDataUrl(outBlob);
}

async function drawUrlBar(dataUrl, pageUrl) {
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

  const outBlob = await canvas.convertToBlob({ type: 'image/png' });
  return blobToDataUrl(outBlob);
}

async function saveImage(dataUrl, { addUrl, pageUrl, mode }) {
  let finalUrl = dataUrl;
  if (addUrl && pageUrl) {
    finalUrl = await drawUrlBar(dataUrl, pageUrl);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const modeLabel = { visible: 'visible', fullpage: 'full', selection: 'region' }[mode] || 'shot';
  const filename = `yoo-screenshot-${modeLabel}-${stamp}.png`;

  const blob = await (await fetch(finalUrl)).blob();
  const url = URL.createObjectURL(blob);

  await new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
      URL.revokeObjectURL(url);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (downloadId === undefined) {
        reject(new Error('下载失败'));
        return;
      }
      resolve(downloadId);
    });
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
