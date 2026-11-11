(function () {
  function exportCanvasDataUrl(canvas, imageFormat) {
    if (imageFormat === 'png') {
      return canvas.toDataURL('image/png');
    }
    return canvas.toDataURL('image/jpeg', 0.92);
  }

  function requestVisibleCapture(imageFormat) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB', imageFormat }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || '截图失败'));
          return;
        }
        resolve(response.dataUrl);
      });
    });
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function scrollToAndWait(targetY) {
    window.scrollTo(0, targetY);
    for (let i = 0; i < 40; i++) {
      await sleep(50);
      if (Math.abs(window.scrollY - targetY) <= 2) {
        break;
      }
    }
    await sleep(150);
  }

  async function stitchTiles(tiles, totalWidth, totalHeight, viewportWidth, viewportHeight, dpr, imageFormat) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(totalWidth * dpr);
    canvas.height = Math.round(totalHeight * dpr);
    const ctx = canvas.getContext('2d');

    for (const tile of tiles) {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = tile.dataUrl;
      });

      const destY = Math.round(tile.scrollY * dpr);
      const remain = canvas.height - destY;
      if (remain <= 0) {
        continue;
      }

      const sliceCss = Math.min(viewportHeight, totalHeight - tile.scrollY);
      const slicePx = Math.min(Math.round(sliceCss * dpr), remain, img.height);

      ctx.drawImage(img, 0, 0, img.width, slicePx, 0, destY, img.width, slicePx);
    }

    return exportCanvasDataUrl(canvas, imageFormat);
  }

  window.__yooScreenshotRunFullPage = async function (addUrl, pageUrl, imageFormat) {
    const fmt = imageFormat === 'png' ? 'png' : 'jpg';
    const html = document.documentElement;
    const body = document.body;
    const totalWidth = Math.max(
      body.scrollWidth,
      body.offsetWidth,
      html.clientWidth,
      html.scrollWidth,
      html.offsetWidth
    );
    const totalHeight = Math.max(
      body.scrollHeight,
      body.offsetHeight,
      html.clientHeight,
      html.scrollHeight,
      html.offsetHeight
    );
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    const originalX = window.scrollX;
    const originalY = window.scrollY;

    const tiles = [];
    let scrollY = 0;
    const maxSteps = Math.max(1, Math.ceil(totalHeight / Math.max(1, viewportHeight))) + 3;
    let steps = 0;

    try {
      while (scrollY < totalHeight - 1 && steps < maxSteps) {
        await scrollToAndWait(scrollY);
        await sleep(300);
        const dataUrl = await requestVisibleCapture(fmt);
        tiles.push({ scrollY: window.scrollY, dataUrl });
        if (window.scrollY + viewportHeight >= totalHeight - 1) {
          break;
        }
        scrollY += viewportHeight;
        steps += 1;
      }

      if (tiles.length === 0) {
        throw new Error('未采集到页面分块');
      }

      const dataUrl = await stitchTiles(
        tiles,
        totalWidth,
        totalHeight,
        viewportWidth,
        viewportHeight,
        dpr,
        fmt
      );

      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: 'FINISH_CAPTURE',
            payload: { dataUrl, addUrl, pageUrl, pageTitle: document.title, mode: 'fullpage', imageFormat: fmt }
          },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!response?.ok) {
              reject(new Error(response?.error || '保存失败'));
              return;
            }
            resolve();
          }
        );
      });

      return { ok: true };
    } catch (err) {
      return { error: err.message || String(err) };
    } finally {
      window.scrollTo(originalX, originalY);
    }
  };

  function waitForPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }

  window.__yooScreenshotRunSelection = function () {
    return new Promise((resolve) => {
      const root = document.createElement('div');
      root.id = 'yoo-screenshot-overlay';
      Object.assign(root.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483646',
        cursor: 'crosshair'
      });

      const shadeStyle = {
        position: 'fixed',
        background: 'rgba(0, 0, 0, 0.35)',
        pointerEvents: 'none',
        zIndex: '2147483646'
      };
      const shadeTop = document.createElement('div');
      const shadeLeft = document.createElement('div');
      const shadeRight = document.createElement('div');
      const shadeBottom = document.createElement('div');
      [shadeTop, shadeLeft, shadeRight, shadeBottom].forEach((el) => {
        Object.assign(el.style, shadeStyle);
      });

      const overlay = document.createElement('div');
      Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647',
        cursor: 'crosshair',
        background: 'transparent'
      });

      const box = document.createElement('div');
      Object.assign(box.style, {
        position: 'fixed',
        border: '2px solid #2563eb',
        background: 'transparent',
        boxSizing: 'border-box',
        display: 'none',
        pointerEvents: 'none',
        zIndex: '2147483648'
      });

      const tip = document.createElement('div');
      tip.textContent = '拖拽选择区域，Esc 取消';
      Object.assign(tip.style, {
        position: 'fixed',
        top: '12px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '6px 12px',
        borderRadius: '8px',
        background: 'rgba(0,0,0,0.75)',
        color: '#fff',
        fontSize: '13px',
        fontFamily: 'system-ui, sans-serif',
        zIndex: '2147483647'
      });

      root.append(shadeTop, shadeLeft, shadeRight, shadeBottom, overlay, box);
      document.documentElement.append(root, tip);

      let startX = 0;
      let startY = 0;
      let dragging = false;

      function hideUi() {
        root.style.display = 'none';
        tip.style.display = 'none';
      }

      async function cleanup(result) {
        hideUi();
        await waitForPaint();
        await sleep(80);
        root.remove();
        tip.remove();
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }

      function onKey(e) {
        if (e.key === 'Escape') {
          cleanup({ cancelled: true });
        }
      }

      function layoutShades(x, y, w, h) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const base =
          'position:fixed;background:rgba(0,0,0,0.35);pointer-events:none;z-index:2147483646';
        if (w < 1 || h < 1) {
          shadeTop.style.cssText = `${base};left:0;top:0;width:100%;height:100%`;
          shadeLeft.style.cssText = `${base};width:0;height:0`;
          shadeRight.style.cssText = `${base};width:0;height:0`;
          shadeBottom.style.cssText = `${base};width:0;height:0`;
          return;
        }
        shadeTop.style.cssText = `position:fixed;left:0;top:0;width:100%;height:${Math.max(0, y)}px;background:rgba(0,0,0,0.35);pointer-events:none;z-index:2147483646`;
        shadeBottom.style.cssText = `position:fixed;left:0;top:${y + h}px;width:100%;height:${Math.max(
          0,
          vh - (y + h)
        )}px;background:rgba(0,0,0,0.35);pointer-events:none;z-index:2147483646`;
        shadeLeft.style.cssText = `position:fixed;left:0;top:${y}px;width:${Math.max(0, x)}px;height:${h}px;background:rgba(0,0,0,0.35);pointer-events:none;z-index:2147483646`;
        shadeRight.style.cssText = `position:fixed;left:${x + w}px;top:${y}px;width:${Math.max(
          0,
          vw - (x + w)
        )}px;height:${h}px;background:rgba(0,0,0,0.35);pointer-events:none;z-index:2147483646`;
      }

      function setBox(x, y, w, h) {
        box.style.display = 'block';
        box.style.left = `${x}px`;
        box.style.top = `${y}px`;
        box.style.width = `${w}px`;
        box.style.height = `${h}px`;
        layoutShades(x, y, w, h);
      }

      overlay.addEventListener('mousedown', (e) => {
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        setBox(startX, startY, 0, 0);
        e.preventDefault();
      });

      overlay.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const x = Math.min(startX, e.clientX);
        const y = Math.min(startY, e.clientY);
        const w = Math.abs(e.clientX - startX);
        const h = Math.abs(e.clientY - startY);
        setBox(x, y, w, h);
      });

      function finish(e) {
        if (!dragging) return;
        dragging = false;
        const x = Math.min(startX, e.clientX);
        const y = Math.min(startY, e.clientY);
        const width = Math.abs(e.clientX - startX);
        const height = Math.abs(e.clientY - startY);
        if (width < 4 || height < 4) {
          cleanup({ error: '选区太小' });
          return;
        }
        void cleanup({
          rect: { x, y, width, height },
          devicePixelRatio: window.devicePixelRatio || 1
        });
      }

      overlay.addEventListener('mouseup', finish);
      layoutShades(0, 0, 0, 0);
      document.addEventListener('keydown', onKey);
    });
  };

  if (window.__yooScreenshotMessageReady) {
    return;
  }
  window.__yooScreenshotMessageReady = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'YOO_START_FULLPAGE') {
      window
        .__yooScreenshotRunFullPage(message.addUrl, message.pageUrl, message.imageFormat)
        .then((result) => {
          if (result?.error) {
            sendResponse({ ok: false, error: result.error });
            return;
          }
          sendResponse({ ok: true });
        })
        .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
      return true;
    }

    if (message?.type === 'YOO_START_SELECTION') {
      window
        .__yooScreenshotRunSelection()
        .then((result) => {
          if (result?.cancelled) {
            sendResponse({ ok: false, cancelled: true });
            return;
          }
          if (result?.error) {
            sendResponse({ ok: false, error: result.error });
            return;
          }
          sendResponse({ ok: true, ...result });
        })
        .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
      return true;
    }
  });
})();
