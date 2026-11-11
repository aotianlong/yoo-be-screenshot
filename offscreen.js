chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'YOO_OFFSCREEN_BLOB') {
    (async () => {
      try {
        const response = await fetch(message.dataUrl);
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        sendResponse({ ok: true, objectUrl });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();
    return true;
  }

  if (message?.type === 'YOO_OFFSCREEN_REVOKE') {
    if (message.objectUrl) {
      URL.revokeObjectURL(message.objectUrl);
    }
    sendResponse({ ok: true });
    return true;
  }
});
