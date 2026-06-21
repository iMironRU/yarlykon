/**
 * Ярлыкон — Cloudflare Worker
 *
 * Точка входа. Роутер.
 *
 * Эндпоинты:
 *   POST /api/shorten        — создать 1..N коротких ссылок (батч)
 *   POST /api/refresh-og     — перетянуть OG для существующего slug
 *   GET  /api/og             — предпросмотр OG по URL (для Mini App)
 *   POST /webhook/telegram   — команды бота
 *   POST /webhook/vk         — TODO(adapter)
 *   POST /webhook/max        — TODO(adapter)
 */

import { verifyTelegramInitData } from './adapters/telegram';
import { verifyVkLaunchParams } from './adapters/vk';
import { verifyMaxInitData } from './adapters/max';
import { fetchOg } from './og';
import { generateSlug } from './slug';
import { batchCommitLinks, refreshLinkOg } from './github';

export interface Env {
  // Bindings
  KV: KVNamespace;

  // Secrets
  GITHUB_TOKEN: string;
  TG_BOT_TOKEN: string;
  VK_APP_SECRET?: string;
  MAX_BOT_TOKEN?: string;

  // Config
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;       // 'main'
  PAGES_DOMAIN: string;        // 'short.example.com' or 'iMironRU.github.io/yarlykon'
  ALLOWED_USERS: string;       // comma-separated platform-prefixed: "tg:123,vk:456,max:789"
  SLUG_MODE: 'random' | 'counter';
  SLUG_LEN_INIT: string;       // '4'
  SLUG_LEN_MAX: string;        // '8'
  BATCH_MAX: string;           // '5'
  METRIKA_ID?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    try {
      // API
      if (url.pathname === '/api/shorten' && method === 'POST') {
        return await handleShorten(request, env, ctx);
      }
      if (url.pathname === '/api/refresh-og' && method === 'POST') {
        return await handleRefreshOg(request, env, ctx);
      }
      if (url.pathname === '/api/og' && method === 'GET') {
        return await handleOgPreview(request, env);
      }

      // Webhooks
      if (url.pathname === '/webhook/telegram' && method === 'POST') {
        return await handleTelegramWebhook(request, env, ctx);
      }
      if (url.pathname === '/webhook/vk' && method === 'POST') {
        // TODO(adapter): VK Bot Long Poll callback handler
        return json({ ok: false, error: 'not_implemented' }, 501);
      }
      if (url.pathname === '/webhook/max' && method === 'POST') {
        // TODO(adapter): MAX Bot webhook handler
        return json({ ok: false, error: 'not_implemented' }, 501);
      }

      // Health
      if (url.pathname === '/api/health') {
        return json({ ok: true, version: 1 });
      }

      return json({ ok: false, error: 'not_found' }, 404);
    } catch (err) {
      console.error('unhandled', err);
      return json({ ok: false, error: 'internal' }, 500);
    }
  },
};

// -------------------- handlers --------------------

interface ShortenRequest {
  platform: 'telegram' | 'vk' | 'max';
  auth: string;            // raw initData / launchParams / max equivalent
  urls: string[];          // 1..BATCH_MAX
}

async function handleShorten(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = (await request.json()) as ShortenRequest;

  // 1. Verify auth + allowlist
  const user = await verifyAuth(body.platform, body.auth, env);
  if (!user) return json({ ok: false, error: 'unauthorized' }, 401);

  const userKey = `${body.platform}:${user.id}`;
  const allowed = env.ALLOWED_USERS.split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.includes(userKey)) {
    return json({ ok: false, error: 'forbidden' }, 403);
  }

  // 2. Validate URLs
  const batchMax = parseInt(env.BATCH_MAX, 10) || 5;
  if (!Array.isArray(body.urls) || body.urls.length === 0 || body.urls.length > batchMax) {
    return json({ ok: false, error: 'invalid_batch_size' }, 400);
  }

  const targets: string[] = [];
  for (const raw of body.urls) {
    try {
      const u = new URL(raw);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
      targets.push(u.toString());
    } catch {
      return json({ ok: false, error: 'invalid_url', url: raw }, 400);
    }
  }

  // 3. Fetch OG for each (parallel)
  const ogResults = await Promise.all(targets.map(t => fetchOg(t)));

  // 4. Commit batch to GitHub (slug generation + collision check happens inside)
  const result = await batchCommitLinks(env, {
    creator: userKey,
    items: targets.map((target, i) => ({ target, og: ogResults[i] })),
  });

  return json({
    ok: true,
    created: result.created.map(({ slug, target }) => ({
      slug,
      target,
      short_url: `https://${env.PAGES_DOMAIN}/l/${slug}.html`,
    })),
    build_eta_seconds: 60,
  });
}

async function handleRefreshOg(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = (await request.json()) as { platform: ShortenRequest['platform']; auth: string; slug: string };

  const user = await verifyAuth(body.platform, body.auth, env);
  if (!user) return json({ ok: false, error: 'unauthorized' }, 401);

  const allowed = env.ALLOWED_USERS.split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.includes(`${body.platform}:${user.id}`)) {
    return json({ ok: false, error: 'forbidden' }, 403);
  }

  const updated = await refreshLinkOg(env, body.slug);
  if (!updated) return json({ ok: false, error: 'not_found' }, 404);

  return json({ ok: true, slug: body.slug, og: updated.og });
}

async function handleOgPreview(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const target = url.searchParams.get('url');
  if (!target) return json({ ok: false, error: 'missing_url' }, 400);

  try {
    new URL(target);
  } catch {
    return json({ ok: false, error: 'invalid_url' }, 400);
  }

  // Cache-friendly: KV first
  const cacheKey = `og:${target}`;
  const cached = await env.KV.get(cacheKey, 'json');
  if (cached) return json({ ok: true, og: cached, cached: true });

  const og = await fetchOg(target);
  await env.KV.put(cacheKey, JSON.stringify(og), { expirationTtl: 3600 });

  return json({ ok: true, og, cached: false });
}

async function handleTelegramWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // TODO(v1): parse Telegram Update, dispatch:
  //   /shorten <url> [<url>...]   → handleShorten internal
  //   /refresh <slug>             → handleRefreshOg internal
  //   /list                       → return last 10 from index.json
  //   /help                       → usage
  // Use TG_BOT_TOKEN to reply via Bot API.
  return json({ ok: true });
}

// -------------------- auth dispatch --------------------

async function verifyAuth(
  platform: ShortenRequest['platform'],
  raw: string,
  env: Env,
): Promise<{ id: string } | null> {
  switch (platform) {
    case 'telegram':
      return await verifyTelegramInitData(raw, env.TG_BOT_TOKEN);
    case 'vk':
      return env.VK_APP_SECRET ? await verifyVkLaunchParams(raw, env.VK_APP_SECRET) : null;
    case 'max':
      return env.MAX_BOT_TOKEN ? await verifyMaxInitData(raw, env.MAX_BOT_TOKEN) : null;
    default:
      return null;
  }
}

// -------------------- helpers --------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    },
  });
}
