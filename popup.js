const modeInputs = () => document.querySelectorAll('input[name="mode"]');
const addUrlEl = () => document.getElementById('add-url');
const captureBtn = () => document.getElementById('capture');
const statusEl = () => document.getElementById('status');
const hintEl = () => document.getElementById('hint');

function selectedMode() {
  const checked = document.querySelector('input[name="mode"]:checked');
  return checked ? checked.value : 'visible';
}

function selectedFormat() {
  const checked = document.querySelector('input[name="format"]:checked');
  return checked?.value === 'png' ? 'png' : 'jpg';
}

function setStatus(text, isError = false) {
  const el = statusEl();
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    el.classList.remove('error');
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function updateHint() {
  const mode = selectedMode();
  const hints = {
    visible: '立即保存当前标签页中可见的部分。',
    fullpage: '将自动滚动并拼接整页，页面较长时请稍候。',
    selection: '将在页面上拖拽框选区域；按 Esc 可取消。'
  };
  hintEl().textContent = hints[mode] || '';
}

modeInputs().forEach((input) => input.addEventListener('change', updateHint));
updateHint();

captureBtn().addEventListener('click', async () => {
  const btn = captureBtn();
  btn.disabled = true;
  setStatus('处理中…');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error('未找到当前标签页');
    }
    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://') || tab.url?.startsWith('edge://')) {
      throw new Error('无法在浏览器内置页面上截图');
    }

    const mode = selectedMode();
    const payload = {
      type: 'START_CAPTURE',
      tabId: tab.id,
      mode,
      addUrl: addUrlEl().checked,
      pageUrl: tab.url || '',
      pageTitle: tab.title || '',
      imageFormat: selectedFormat()
    };

    if (mode === 'selection' || mode === 'fullpage') {
      const response = await chrome.runtime.sendMessage(payload);
      if (!response?.ok) {
        throw new Error(response?.error || '无法开始截图');
      }
      window.close();
      return;
    }

    const response = await chrome.runtime.sendMessage(payload);

    if (!response?.ok) {
      throw new Error(response?.error || '截图失败');
    }

    setStatus('已保存截图');
  } catch (err) {
    setStatus(err.message || String(err), true);
  } finally {
    btn.disabled = false;
  }
});
