// GitHub API adapter — минимум, нужный для bootstrap.

import sodium from './sodium-stub.mjs'; // TODO(v1): заменить на libsodium-wrappers npm; пока есть рекомендация

const API = 'https://api.github.com';

async function gh(token, path, method = 'GET', body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'yarlykon-bootstrap',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`gh ${method} ${path} → ${r.status}: ${text.slice(0, 200)}`);
  }
  if (r.status === 204) return null;
  return await r.json();
}

export async function verifyToken(token) {
  const me = await gh(token, '/user');
  if (!me.login) throw new Error('invalid token');
}

export async function setSecret(owner, repo, token, name, value) {
  // 1. Получить публичный ключ репо
  const pk = await gh(token, `/repos/${owner}/${repo}/actions/secrets/public-key`);

  // 2. Зашифровать sealed box на ключе (требует libsodium).
  const encrypted = await sodium.sealedBox(value, pk.key);

  // 3. PUT секрет
  await gh(token, `/repos/${owner}/${repo}/actions/secrets/${name}`, 'PUT', {
    encrypted_value: encrypted,
    key_id: pk.key_id,
  });
}

export async function enablePages(owner, repo, token, { branch = 'main', path = '/' } = {}) {
  try {
    await gh(token, `/repos/${owner}/${repo}/pages`, 'POST', {
      source: { branch, path },
    });
  } catch (e) {
    // Уже включён — обновим source
    if (String(e.message).includes('409')) {
      await gh(token, `/repos/${owner}/${repo}/pages`, 'PUT', {
        source: { branch, path },
      });
    } else {
      throw e;
    }
  }
}

export async function fileExists(owner, repo, token, path) {
  try {
    await gh(token, `/repos/${owner}/${repo}/contents/${path}`);
    return true;
  } catch (e) {
    if (String(e.message).includes('404')) return false;
    throw e;
  }
}

export async function putFile(owner, repo, token, path, content, message) {
  const b64 = Buffer.from(content, 'utf-8').toString('base64');
  await gh(token, `/repos/${owner}/${repo}/contents/${path}`, 'PUT', {
    message,
    content: b64,
  });
}
