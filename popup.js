const addUrlEl = () => document.getElementById('add-url');
const captureBtn = () => document.getElementById('capture');
const statusEl = () => document.getElementById('status');
const hintEl = () => document.getElementById('hint');

let selectedModeValue = 'visible';
let selectedFormatValue = 'jpg';

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
  const hints = {
    visible: '截取后在编辑页中预览，可裁剪、标注后再下载。',
    fullpage: '将自动滚动并拼接整页，页面较长时请稍候。',
    selection: '将在页面上拖拽框选区域；按 Esc 可取消。'
  };
  hintEl().textContent = hints[selectedModeValue] || '';
}

function wireChoiceGroup(groupId, attr, onPick) {
  const group = document.getElementById(groupId);
  group.querySelectorAll('.choice').forEach((btn) => {
    btn.addEventListener('click', () => {
      group.querySelectorAll('.choice').forEach((el) => el.classList.remove('is-active'));
      btn.classList.add('is-active');
      onPick(btn.getAttribute(attr));
    });
  });
}

wireChoiceGroup('mode-group', 'data-mode', (value) => {
  selectedModeValue = value || 'visible';
  updateHint();
});

wireChoiceGroup('format-group', 'data-format', (value) => {
  selectedFormatValue = value === 'png' ? 'png' : 'jpg';
});

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
    if (
      tab.url?.startsWith('chrome://') ||
      tab.url?.startsWith('chrome-extension://') ||
      tab.url?.startsWith('edge://')
    ) {
      throw new Error('无法在浏览器内置页面上截图');
    }

    const payload = {
      type: 'START_CAPTURE',
      tabId: tab.id,
      mode: selectedModeValue,
      addUrl: addUrlEl().checked,
      pageUrl: tab.url || '',
      pageTitle: tab.title || '',
      imageFormat: selectedFormatValue
    };

    if (selectedModeValue === 'selection' || selectedModeValue === 'fullpage') {
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

    setStatus('已打开编辑页');
  } catch (err) {
    setStatus(err.message || String(err), true);
  } finally {
    btn.disabled = false;
  }
});
