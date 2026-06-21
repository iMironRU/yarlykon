// Ярлыкон Mini App
// Платформо-агностичное ядро + адаптер по платформе.

const WORKER_URL = window.YARLYKON_WORKER_URL || 'https://yarlykon.example.workers.dev';
const BATCH_MAX = 5;

// -------------------- Platform adapter --------------------

function detectPlatform() {
  if (window.Telegram?.WebApp?.initData) return 'telegram';
  // TODO(adapter): VK Bridge detection
  // if (window.vkBridge) return 'vk';
  // TODO(adapter): MAX detection
  return 'telegram'; // fallback (отладка в браузере)
}

function makeAdapter(platform) {
  switch (platform) {
    case 'telegram': return telegramAdapter();
    case 'vk':       return vkAdapter();      // TODO(adapter)
    case 'max':      return maxAdapter();     // TODO(adapter)
    default:         return telegramAdapter();
  }
}

function telegramAdapter() {
  const tg = window.Telegram?.WebApp;
  return {
    name: 'telegram',
    getAuth() { return tg?.initData || ''; },
    getUser() { return { id: String(tg?.initDataUnsafe?.user?.id ?? '') }; },
    applyTheme() {
      if (!tg) return;
      tg.ready();
      tg.expand();
      // TG прокидывает CSS-переменные сам; читаем и нормализуем
      const root = document.documentElement;
      const tp = tg.themeParams || {};
      if (tp.bg_color) root.style.setProperty('--bg', tp.bg_color);
      if (tp.text_color) root.style.setProperty('--fg', tp.text_color);
      if (tp.hint_color) root.style.setProperty('--muted', tp.hint_color);
      if (tp.button_color) root.style.setProperty('--accent', tp.button_color);
      if (tp.button_text_color) root.style.setProperty('--accent-fg', tp.button_text_color);
    },
    haptic(kind = 'light') {
      try { tg?.HapticFeedback?.impactOccurred(kind); } catch {}
    },
    close() { try { tg?.close(); } catch {} },
  };
}

function vkAdapter() {
  // TODO(adapter): vkBridge.send('VKWebAppInit'), достать launch params из URL.
  return {
    name: 'vk',
    getAuth() { return new URLSearchParams(location.search).toString(); },
    getUser() { return { id: '' }; },
    applyTheme() {},
    haptic() {},
    close() {},
  };
}

function maxAdapter() {
  // TODO(adapter): актуализировать по доке MAX.
  return {
    name: 'max',
    getAuth() { return ''; },
    getUser() { return { id: '' }; },
    applyTheme() {},
    haptic() {},
    close() {},
  };
}

// -------------------- UI --------------------

const platform = detectPlatform();
const adapter = makeAdapter(platform);
adapter.applyTheme();

const inputsEl = document.getElementById('inputs');
const btnAdd = document.getElementById('btn-add');
const btnGo = document.getElementById('btn-go');
const resultsEl = document.getElementById('results');
const resultsListEl = document.getElementById('results-list');
const statusEl = document.getElementById('status');

let fieldCount = 0;

function addField(initial = '') {
  if (fieldCount >= BATCH_MAX) return;
  fieldCount++;

  const row = document.createElement('div');
  row.className = 'field';
  row.innerHTML = `
    <input type="url" inputmode="url" placeholder="https://..." class="field__url" value="${escapeAttr(initial)}">
    <div class="field__preview" hidden></div>
  `;
  inputsEl.appendChild(row);

  const input = row.querySelector('.field__url');
  const preview = row.querySelector('.field__preview');
  input.addEventListener('blur', () => previewOg(input.value, preview));

  if (fieldCount >= BATCH_MAX) btnAdd.disabled = true;
}

async function previewOg(url, target) {
  if (!url || !isValidUrl(url)) {
    target.hidden = true;
    return;
  }
  target.hidden = false;
  target.textContent = 'Подгружаем превью…';
  try {
    const resp = await fetch(`${WORKER_URL}/api/og?url=${encodeURIComponent(url)}`);
    const data = await resp.json();
    if (!data.ok) {
      target.textContent = 'Превью недоступно';
      return;
    }
    const og = data.og;
    target.innerHTML = `
      <div class="prev__title">${escapeHtml(og.title || '—')}</div>
      ${og.description ? `<div class="prev__desc">${escapeHtml(og.description)}</div>` : ''}
      <div class="prev__host">${escapeHtml(og.site_name || '')}</div>
    `;
  } catch {
    target.textContent = 'Не удалось получить превью';
  }
}

function isValidUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function setStatus(text, kind = 'info') {
  statusEl.hidden = !text;
  statusEl.textContent = text || '';
  statusEl.dataset.kind = kind;
}

btnAdd.addEventListener('click', () => { addField(); adapter.haptic('light'); });

btnGo.addEventListener('click', async () => {
  const urls = Array.from(document.querySelectorAll('.field__url'))
    .map(i => i.value.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    setStatus('Добавь хотя бы одну ссылку', 'warn');
    return;
  }
  for (const u of urls) {
    if (!isValidUrl(u)) {
      setStatus(`Невалидный URL: ${u}`, 'error');
      return;
    }
  }

  btnGo.disabled = true;
  adapter.haptic('medium');
  setStatus('Создаём…', 'info');

  try {
    const resp = await fetch(`${WORKER_URL}/api/shorten`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: adapter.name,
        auth: adapter.getAuth(),
        urls,
      }),
    });
    const data = await resp.json();
    if (!data.ok) {
      setStatus(`Ошибка: ${data.error}`, 'error');
      btnGo.disabled = false;
      return;
    }

    renderResults(data.created, data.build_eta_seconds || 60);
    setStatus(`Сборка ~${data.build_eta_seconds || 60}с. Ссылки заработают, когда Pages пересоберётся.`, 'info');
    adapter.haptic('rigid');
  } catch (err) {
    setStatus(`Сбой: ${err.message}`, 'error');
  } finally {
    btnGo.disabled = false;
  }
});

function renderResults(items, _etaSeconds) {
  resultsListEl.innerHTML = '';
  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'result';
    li.innerHTML = `
      <a class="result__short" href="${escapeAttr(it.short_url)}" target="_blank" rel="noopener">${escapeHtml(it.short_url)}</a>
      <div class="result__target">${escapeHtml(it.target)}</div>
      <button class="btn btn--small" type="button">Скопировать</button>
    `;
    li.querySelector('button').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(it.short_url);
        setStatus('Скопировано', 'info');
        adapter.haptic('light');
      } catch {
        setStatus('Скопируй вручную', 'warn');
      }
    });
    resultsListEl.appendChild(li);
  }
  resultsEl.hidden = false;
}

// Init: одно поле сразу
addField();
