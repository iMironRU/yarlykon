/**
 * Open Graph фетч и парсинг.
 *
 * Стратегия:
 *   1. GET с реалистичным User-Agent и Accept-Language.
 *   2. Ограничение на размер тела (читаем первые ~64 КБ — head обычно умещается).
 *   3. Парсим og:* мета через регулярки (HTMLRewriter был бы лучше,
 *      но требует точного потока; для head'а regex достаточен и быстрее).
 *   4. Fallback на <title> и <meta name="description">.
 *   5. Если ничего не нашли — partial=true с минимумом из URL.
 */

export interface OgSnapshot {
  title: string;
  description: string;
  image: string;
  site_name: string;
  fetched_at: string;
  partial?: boolean;
  error?: string;
}

const HEAD_BYTES_LIMIT = 64 * 1024;
const FETCH_TIMEOUT_MS = 5000;

export async function fetchOg(url: string): Promise<OgSnapshot> {
  const nowIso = new Date().toISOString();
  let html = '';

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (compatible; YarlykonBot/1.0; +https://github.com/iMironRU/yarlykon)',
        'accept': 'text/html,application/xhtml+xml',
        'accept-language': 'ru,en;q=0.9',
      },
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      return fallbackFromUrl(url, nowIso, `http_${resp.status}`);
    }

    // Read up to HEAD_BYTES_LIMIT
    const reader = resp.body?.getReader();
    if (!reader) return fallbackFromUrl(url, nowIso, 'no_body');

    const decoder = new TextDecoder('utf-8', { fatal: false });
    let total = 0;
    while (total < HEAD_BYTES_LIMIT) {
      const { value, done } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      total += value.byteLength;
      // Stop early if </head> already in stream
      if (html.toLowerCase().includes('</head>')) break;
    }
    try { reader.cancel(); } catch {}
  } catch (err) {
    return fallbackFromUrl(url, nowIso, errorName(err));
  }

  const og = parseOg(html);

  if (!og.title && !og.description && !og.image) {
    return { ...fallbackFromUrl(url, nowIso, 'no_meta'), ...nonEmpty(og) };
  }

  return {
    title: og.title || urlTitleFallback(url),
    description: og.description || '',
    image: og.image || '',
    site_name: og.site_name || new URL(url).hostname,
    fetched_at: nowIso,
  };
}

function parseOg(html: string): Partial<OgSnapshot> {
  const result: Partial<OgSnapshot> = {};

  // og:* tags
  result.title = metaProp(html, 'og:title') || tagInner(html, 'title');
  result.description =
    metaProp(html, 'og:description') || metaName(html, 'description');
  result.image = metaProp(html, 'og:image');
  result.site_name = metaProp(html, 'og:site_name');

  return result;
}

function metaProp(html: string, prop: string): string {
  // <meta property="og:title" content="...">  (any attr order)
  const re = new RegExp(
    `<meta[^>]+property=["']${escapeRe(prop)}["'][^>]*content=["']([^"']*)["']`,
    'i',
  );
  const m = html.match(re);
  if (m) return decodeEntities(m[1].trim());

  // content before property
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${escapeRe(prop)}["']`,
    'i',
  );
  const m2 = html.match(re2);
  return m2 ? decodeEntities(m2[1].trim()) : '';
}

function metaName(html: string, name: string): string {
  const re = new RegExp(
    `<meta[^>]+name=["']${escapeRe(name)}["'][^>]*content=["']([^"']*)["']`,
    'i',
  );
  const m = html.match(re);
  if (m) return decodeEntities(m[1].trim());

  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${escapeRe(name)}["']`,
    'i',
  );
  const m2 = html.match(re2);
  return m2 ? decodeEntities(m2[1].trim()) : '';
}

function tagInner(html: string, tag: string): string {
  const re = new RegExp(`<${escapeRe(tag)}[^>]*>([\\s\\S]*?)</${escapeRe(tag)}>`, 'i');
  const m = html.match(re);
  return m ? decodeEntities(m[1].trim()) : '';
}

function fallbackFromUrl(url: string, nowIso: string, reason: string): OgSnapshot {
  return {
    title: urlTitleFallback(url),
    description: '',
    image: '',
    site_name: safeHostname(url),
    fetched_at: nowIso,
    partial: true,
    error: reason,
  };
}

function urlTitleFallback(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() || u.hostname;
    return decodeURIComponent(last);
  } catch {
    return url;
  }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function nonEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(obj) as (keyof T)[]) {
    if (obj[k]) out[k] = obj[k];
  }
  return out;
}

function errorName(err: unknown): string {
  if (err instanceof Error) return err.name || 'error';
  return 'unknown';
}
