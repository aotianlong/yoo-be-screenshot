let selectedModeValue = 'visible';
let selectedFormatValue = 'jpg';

function setStatus(text, isError = false) {
  const el = document.getElementById('status');
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

function readFormSettings() {
  return yooNormalizeSettings({
    mode: selectedModeValue,
    imageFormat: selectedFormatValue,
    addUrl: document.getElementById('add-url').checked
  });
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
});

wireChoiceGroup('format-group', 'data-format', (value) => {
  selectedFormatValue = value === 'png' ? 'png' : 'jpg';
});

async function loadIntoForm() {
  const settings = await yooLoadUserDefaults();
  selectedModeValue = settings.mode;
  selectedFormatValue = settings.imageFormat;
  yooApplySettingsToForm(settings);
}

document.getElementById('save').addEventListener('click', async () => {
  const btn = document.getElementById('save');
  btn.disabled = true;
  setStatus('保存中…');
  try {
    await yooSaveUserDefaults(readFormSettings());
    setStatus('已保存');
    setTimeout(() => setStatus(''), 2000);
  } catch (err) {
    setStatus(err.message || String(err), true);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('reset').addEventListener('click', async () => {
  selectedModeValue = YOO_BUILTIN_DEFAULTS.mode;
  selectedFormatValue = YOO_BUILTIN_DEFAULTS.imageFormat;
  yooApplySettingsToForm(YOO_BUILTIN_DEFAULTS);
  try {
    await yooSaveUserDefaults(YOO_BUILTIN_DEFAULTS);
    setStatus('已恢复默认');
    setTimeout(() => setStatus(''), 2000);
  } catch (err) {
    setStatus(err.message || String(err), true);
  }
});

loadIntoForm().catch((err) => setStatus(err.message || String(err), true));
