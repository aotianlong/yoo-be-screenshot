chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'YOO_OFFSCREEN_DOWNLOAD') {
    return;
  }

  (async () => {
    let objectUrl;
    try {
      const response = await fetch(message.dataUrl);
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      const downloadId = await new Promise((resolve, reject) => {
        chrome.downloads.download(
          {
            url: objectUrl,
            filename: message.filename,
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
      sendResponse({ ok: true, downloadId });
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    } finally {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    }
  })();

  return true;
});
