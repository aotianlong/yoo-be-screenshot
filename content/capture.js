(function () {
  if (window.__yooScreenshotLoaded) {
    return;
  }
  window.__yooScreenshotLoaded = true;

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
      const sliceHeight = Math.min(
        Math.round(viewportHeight * dpr),
        canvas.height - destY
      );
      ctx.drawImage(
        img,
        0,
        0,
        img.width,
        sliceHeight,
        0,
        destY,
        img.width,
        sliceHeight
      );
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
    const maxSteps = Math.ceil(totalHeight / viewportHeight) + 2;
    let steps = 0;

    try {
      while (scrollY < totalHeight && steps < maxSteps) {
        window.scrollTo(0, scrollY);
        await sleep(200);
        const dataUrl = await requestVisibleCapture(fmt);
        tiles.push({ scrollY, dataUrl });
        if (scrollY + viewportHeight >= totalHeight) {
          break;
        }
        scrollY += viewportHeight;
        steps += 1;
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

  window.__yooScreenshotRunSelection = function () {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.id = 'yoo-screenshot-overlay';
      Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483646',
        cursor: 'crosshair',
        background: 'rgba(0,0,0,0.25)'
      });

      const box = document.createElement('div');
      Object.assign(box.style, {
        position: 'fixed',
        border: '2px solid #2563eb',
        background: 'rgba(37, 99, 235, 0.12)',
        display: 'none',
        pointerEvents: 'none',
        zIndex: '2147483647'
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

      document.documentElement.append(overlay, box, tip);

      let startX = 0;
      let startY = 0;
      let dragging = false;

      function cleanup(result) {
        overlay.remove();
        box.remove();
        tip.remove();
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }

      function onKey(e) {
        if (e.key === 'Escape') {
          cleanup({ cancelled: true });
        }
      }

      function setBox(x, y, w, h) {
        box.style.display = 'block';
        box.style.left = `${x}px`;
        box.style.top = `${y}px`;
        box.style.width = `${w}px`;
        box.style.height = `${h}px`;
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
        cleanup({
          rect: { x, y, width, height },
          devicePixelRatio: window.devicePixelRatio || 1
        });
      }

      overlay.addEventListener('mouseup', finish);
      document.addEventListener('keydown', onKey);
    });
  };
})();
