#!/usr/bin/env node
// Генерация admin/index.html из index.json.
// Запускается в rebuild workflow и локально.

import fs from 'node:fs/promises';

const idx = JSON.parse(await fs.readFile('index.json', 'utf-8'));
const links = (idx.links || []).slice().reverse();

const rows = links.map(l => `
  <tr>
    <td class="slug"><a href="../l/${escapeAttr(l.slug)}.html">${escapeHtml(l.slug)}</a></td>
    <td class="target">
      <div class="t-title">${escapeHtml(l.og?.title || '—')}</div>
      <a class="t-url" href="${escapeAttr(l.target)}" rel="noopener">${escapeHtml(l.target)}</a>
    </td>
    <td class="date">${escapeHtml((l.created_at || '').slice(0, 10))}</td>
    <td class="by">${escapeHtml(l.created_by || '')}</td>
  </tr>`).join('\n');

const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ярлыкон — журнал</title>
  <style>
    :root { color-scheme: light dark; --fg: #111; --bg: #fafafa; --muted: #6b7280; --border: #e5e7eb; --accent: #2563eb; }
    @media (prefers-color-scheme: dark) { :root { --fg: #e5e7eb; --bg: #0f172a; --muted: #94a3b8; --border: #1f2937; } }
    body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 24px; }
    .wrap { max-width: 1000px; margin: 0 auto; }
    h1 { font-size: 22px; margin: 0 0 4px; font-weight: 600; }
    .meta { color: var(--muted); font-size: 13px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 12px 8px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
    th { color: var(--muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
    .slug a { color: var(--accent); text-decoration: none; font-family: ui-monospace, monospace; }
    .t-title { font-weight: 500; }
    .t-url { color: var(--muted); font-size: 12px; word-break: break-all; }
    .date, .by { color: var(--muted); font-size: 13px; white-space: nowrap; }
    .empty { color: var(--muted); padding: 32px; text-align: center; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Ярлыкон</h1>
    <p class="meta">всего ссылок: ${links.length} · сгенерировано ${new Date().toISOString()}</p>
    ${links.length === 0
      ? '<div class="empty">Пока пусто. Создавай через Mini App или /shorten в боте.</div>'
      : `<table><thead><tr><th>slug</th><th>назначение</th><th>дата</th><th>автор</th></tr></thead><tbody>${rows}</tbody></table>`
    }
  </div>
</body>
</html>
`;

await fs.mkdir('admin', { recursive: true });
await fs.writeFile('admin/index.html', html, 'utf-8');
console.log(`admin/index.html generated (${links.length} links)`);

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }
