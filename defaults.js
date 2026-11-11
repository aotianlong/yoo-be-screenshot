const YOO_STORAGE_KEY = 'yooUserDefaults';

const YOO_BUILTIN_DEFAULTS = {
  mode: 'visible',
  imageFormat: 'jpg',
  addUrl: true
};

function yooNormalizeSettings(raw) {
  const modes = ['visible', 'fullpage', 'selection'];
  const mode = modes.includes(raw?.mode) ? raw.mode : YOO_BUILTIN_DEFAULTS.mode;
  const imageFormat = raw?.imageFormat === 'png' ? 'png' : 'jpg';
  const addUrl = raw?.addUrl !== false;
  return { mode, imageFormat, addUrl };
}

async function yooLoadUserDefaults() {
  try {
    const stored = await chrome.storage.sync.get(YOO_STORAGE_KEY);
    if (stored[YOO_STORAGE_KEY]) {
      return yooNormalizeSettings(stored[YOO_STORAGE_KEY]);
    }
  } catch {
    /* fall through */
  }
  try {
    const stored = await chrome.storage.local.get(YOO_STORAGE_KEY);
    return yooNormalizeSettings(stored[YOO_STORAGE_KEY]);
  } catch {
    return { ...YOO_BUILTIN_DEFAULTS };
  }
}

async function yooSaveUserDefaults(settings) {
  const normalized = yooNormalizeSettings(settings);
  try {
    await chrome.storage.sync.set({ [YOO_STORAGE_KEY]: normalized });
  } catch {
    await chrome.storage.local.set({ [YOO_STORAGE_KEY]: normalized });
  }
  return normalized;
}

function yooApplyModeChoice(mode) {
  const group = document.getElementById('mode-group');
  if (!group) {
    return;
  }
  group.querySelectorAll('.choice').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-mode') === mode);
  });
}

function yooApplyFormatChoice(imageFormat) {
  const group = document.getElementById('format-group');
  if (!group) {
    return;
  }
  group.querySelectorAll('.choice').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-format') === imageFormat);
  });
}

function yooApplyAddUrl(checked) {
  const el = document.getElementById('add-url');
  if (el) {
    el.checked = checked;
  }
}

function yooApplySettingsToForm(settings) {
  yooApplyModeChoice(settings.mode);
  yooApplyFormatChoice(settings.imageFormat);
  yooApplyAddUrl(settings.addUrl);
}
