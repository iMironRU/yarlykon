/**
 * Атомарный батч-коммит в GitHub.
 *
 * Использует Git Trees API:
 *   1. GET /repos/{owner}/{repo}/git/refs/heads/{branch} → commit SHA
 *   2. GET /repos/{owner}/{repo}/git/commits/{sha}      → base tree SHA
 *   3. GET /repos/{owner}/{repo}/contents/index.json    → текущий index
 *   4. Генерируем slug'и (внутри одного батча — без коллизий)
 *   5. Создаём blob'ы: N страниц + новый index.json (через trees API inline)
 *   6. POST /repos/{owner}/{repo}/git/trees             → новый tree
 *   7. POST /repos/{owner}/{repo}/git/commits           → новый commit
 *   8. PATCH /repos/{owner}/{repo}/git/refs/heads/...   → переключаем ref
 *
 * Один батч = один коммит = одна пересборка Pages.
 */

import { generateSlug } from './slug';
import { fetchOg, OgSnapshot } from './og';
import type { Env } from './index';

interface IndexJson {
  version: number;
  links: LinkRecord[];
}

interface LinkRecord {
  slug: string;
  target: string;
  created_at: string;
  created_by: string;
  og: OgSnapshot;
}

interface BatchInput {
  creator: string;
  items: Array<{ target: string; og: OgSnapshot }>;
}

interface BatchResult {
  created: Array<{ slug: string; target: string }>;
  commit_sha: string;
}

export async function batchCommitLinks(env: Env, batch: BatchInput): Promise<BatchResult> {
  const gh = ghClient(env);
  const { GITHUB_OWNER: owner, GITHUB_REPO: repo, GITHUB_BRANCH: branch } = env;

  // 1. Current ref + commit + base tree
  const ref = await gh<{ object: { sha: string } }>(
    `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
  );
  const baseCommit = await gh<{ tree: { sha: string } }>(
    `/repos/${owner}/${repo}/git/commits/${ref.object.sha}`,
  );

  // 2. Current index.json
  const indexFile = await gh<{ content: string; encoding: 'base64' }>(
    `/repos/${owner}/${repo}/contents/index.json?ref=${branch}`,
  );
  const indexJson: IndexJson = JSON.parse(b64Decode(indexFile.content));
  const taken = new Set(indexJson.links.map(l => l.slug));

  // 3. Generate slugs (with collision checks inside batch)
  const slugMode = env.SLUG_MODE;
  const lenInit = parseInt(env.SLUG_LEN_INIT, 10) || 4;
  const lenMax = parseInt(env.SLUG_LEN_MAX, 10) || 8;

  const nowIso = new Date().toISOString();
  const newRecords: LinkRecord[] = [];

  for (const item of batch.items) {
    const slug = generateSlug({ mode: slugMode, lenInit, lenMax, taken });
    taken.add(slug);
    newRecords.push({
      slug,
      target: item.target,
      created_at: nowIso,
      created_by: batch.creator,
      og: item.og,
    });
  }

  // 4. Render link HTML pages
  const linkTemplate = await loadTemplate(env);
  const treeItems: TreeItem[] = [];

  for (const rec of newRecords) {
    const html = renderLink(linkTemplate, rec, env);
    treeItems.push({
      path: `l/${rec.slug}.html`,
      mode: '100644',
      type: 'blob',
      content: html,
    });
  }

  // 5. Updated index.json
  const updatedIndex: IndexJson = {
    version: indexJson.version || 1,
    links: [...indexJson.links, ...newRecords],
  };
  treeItems.push({
    path: 'index.json',
    mode: '100644',
    type: 'blob',
    content: JSON.stringify(updatedIndex, null, 2) + '\n',
  });

  // 6. Create tree
  const newTree = await gh<{ sha: string }>(`/repos/${owner}/${repo}/git/trees`, 'POST', {
    base_tree: baseCommit.tree.sha,
    tree: treeItems,
  });

  // 7. Create commit
  const commitMsg = buildCommitMessage(newRecords);
  const newCommit = await gh<{ sha: string }>(`/repos/${owner}/${repo}/git/commits`, 'POST', {
    message: commitMsg,
    tree: newTree.sha,
    parents: [ref.object.sha],
  });

  // 8. Update ref
  await gh(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, 'PATCH', {
    sha: newCommit.sha,
    force: false,
  });

  return {
    created: newRecords.map(r => ({ slug: r.slug, target: r.target })),
    commit_sha: newCommit.sha,
  };
}

export async function refreshLinkOg(
  env: Env,
  slug: string,
): Promise<{ og: OgSnapshot } | null> {
  const gh = ghClient(env);
  const { GITHUB_OWNER: owner, GITHUB_REPO: repo, GITHUB_BRANCH: branch } = env;

  // Load index
  const indexFile = await gh<{ content: string }>(
    `/repos/${owner}/${repo}/contents/index.json?ref=${branch}`,
  );
  const indexJson: IndexJson = JSON.parse(b64Decode(indexFile.content));
  const rec = indexJson.links.find(l => l.slug === slug);
  if (!rec) return null;

  // Refetch OG
  const newOg = await fetchOg(rec.target);
  rec.og = newOg;

  // Re-render page + update index — same batch-commit machinery, single item
  const ref = await gh<{ object: { sha: string } }>(
    `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
  );
  const baseCommit = await gh<{ tree: { sha: string } }>(
    `/repos/${owner}/${repo}/git/commits/${ref.object.sha}`,
  );

  const linkTemplate = await loadTemplate(env);
  const html = renderLink(linkTemplate, rec, env);

  const treeItems: TreeItem[] = [
    { path: `l/${slug}.html`, mode: '100644', type: 'blob', content: html },
    {
      path: 'index.json',
      mode: '100644',
      type: 'blob',
      content: JSON.stringify(indexJson, null, 2) + '\n',
    },
  ];

  const newTree = await gh<{ sha: string }>(`/repos/${owner}/${repo}/git/trees`, 'POST', {
    base_tree: baseCommit.tree.sha,
    tree: treeItems,
  });

  const newCommit = await gh<{ sha: string }>(`/repos/${owner}/${repo}/git/commits`, 'POST', {
    message: `refresh og: ${slug}`,
    tree: newTree.sha,
    parents: [ref.object.sha],
  });

  await gh(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, 'PATCH', {
    sha: newCommit.sha,
    force: false,
  });

  return { og: newOg };
}

// -------------------- helpers --------------------

interface TreeItem {
  path: string;
  mode: '100644' | '100755' | '040000' | '160000' | '120000';
  type: 'blob' | 'tree' | 'commit';
  content?: string;
  sha?: string | null;
}

function ghClient(env: Env) {
  return async function gh<T = unknown>(
    path: string,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' = 'GET',
    body?: unknown,
  ): Promise<T> {
    const resp = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        'authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'accept': 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'yarlykon-worker',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`gh ${method} ${path} → ${resp.status}: ${text.slice(0, 200)}`);
    }
    return (await resp.json()) as T;
  };
}

function buildCommitMessage(records: LinkRecord[]): string {
  if (records.length === 1) {
    return `add: ${records[0].slug} → ${records[0].target.slice(0, 60)}`;
  }
  const slugs = records.map(r => r.slug).join(', ');
  return `add batch: ${records.length} link(s) [${slugs}]`;
}

function b64Decode(s: string): string {
  // atob handles only ASCII safely; for UTF-8 we decode through Uint8Array.
  const bin = atob(s.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

let _cachedTemplate: string | null = null;
async function loadTemplate(env: Env): Promise<string> {
  if (_cachedTemplate) return _cachedTemplate;

  // Шаблон коммитится в репо и читается из него же — это единственный
  // источник правды для рендера. Изменил шаблон → следующий коммит будет
  // использовать новую версию автоматически.
  const gh = ghClient(env);
  const file = await gh<{ content: string }>(
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/template/link.html.tmpl?ref=${env.GITHUB_BRANCH}`,
  );
  _cachedTemplate = b64Decode(file.content);
  return _cachedTemplate;
}

function renderLink(tmpl: string, rec: LinkRecord, env: Env): string {
  const vars: Record<string, string> = {
    SLUG: rec.slug,
    TARGET: escapeHtml(rec.target),
    TARGET_RAW: rec.target,
    OG_TITLE: escapeHtml(rec.og.title || ''),
    OG_DESCRIPTION: escapeHtml(rec.og.description || ''),
    OG_IMAGE: escapeHtml(rec.og.image || ''),
    OG_SITE_NAME: escapeHtml(rec.og.site_name || ''),
    CREATED_AT: rec.created_at,
    METRIKA_ID: env.METRIKA_ID || '',
    METRIKA_BLOCK: env.METRIKA_ID ? metrikaSnippet(env.METRIKA_ID) : '',
    // Безопасные значения для встраивания в <script>
    TARGET_JSON: JSON.stringify(rec.target),
    METRIKA_ID_JS: env.METRIKA_ID ? JSON.stringify(env.METRIKA_ID) : 'null',
  };

  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function metrikaSnippet(id: string): string {
  // Стандартный счётчик. В шаблон вставляется как блок целиком.
  return `<script type="text/javascript">
(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
m[i].l=1*new Date();
for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
ym(${id}, "init", { defer:true, clickmap:true, trackLinks:true, accurateTrackBounce:true });
</script>
<noscript><div><img src="https://mc.yandex.ru/watch/${id}" style="position:absolute; left:-9999px;" alt="" /></div></noscript>`;
}
