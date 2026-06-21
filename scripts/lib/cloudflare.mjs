// Cloudflare API + wrangler adapter.

import { spawn } from 'node:child_process';

const API = 'https://api.cloudflare.com/client/v4';

async function cf(token, path, method = 'GET', body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!data.success) {
    throw new Error(`cf ${method} ${path}: ${JSON.stringify(data.errors)}`);
  }
  return data.result;
}

export async function verifyToken(token, accountId) {
  const r = await cf(token, `/accounts/${accountId}`);
  if (!r.id) throw new Error('invalid CF token or account');
}

export async function ensureKvNamespace(token, accountId, title) {
  // List, see if exists
  const list = await cf(token, `/accounts/${accountId}/storage/kv/namespaces`);
  const existing = list.find(n => n.title === title);
  if (existing) return existing;
  return await cf(token, `/accounts/${accountId}/storage/kv/namespaces`, 'POST', { title });
}

export async function getWorkerUrl(token, accountId, workerName) {
  // Try workers.dev subdomain
  const sub = await cf(token, `/accounts/${accountId}/workers/subdomain`);
  if (sub?.subdomain) {
    return `https://${workerName}.${sub.subdomain}.workers.dev`;
  }
  throw new Error('cannot determine worker URL');
}

// -------------------- wrangler shellouts --------------------

export async function wranglerDeploy(token) {
  await runWrangler(token, ['deploy'], { cwd: 'worker' });
}

export async function wranglerSetSecret(token, name, value) {
  await runWrangler(token, ['secret', 'put', name], {
    cwd: 'worker',
    stdin: value + '\n',
  });
}

function runWrangler(token, args, { cwd, stdin } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, CLOUDFLARE_API_TOKEN: token };
    const child = spawn('npx', ['wrangler', ...args], {
      cwd, env, stdio: stdin ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    });
    if (stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`wrangler ${args.join(' ')} exited ${code}`));
    });
  });
}
