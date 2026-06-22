#!/usr/bin/env node
/**
 * Ярлыкон Bootstrap.
 *
 * 8 идемпотентных стадий. Каждая может быть запущена отдельно через
 *   node bootstrap.mjs --stage=N
 * либо все по порядку:
 *   node bootstrap.mjs
 *
 * Источник конфигурации (по приоритету):
 *   1. CLI флаги:   --owner=... --repo=... ...
 *   2. ENV:         YARLYKON_OWNER, YARLYKON_REPO, ...
 *   3. Интерактивный ввод (только в TTY)
 *
 * Состояние пишется в .bootstrap-state.json — это позволяет
 * перезапускать с того места, где упало.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import * as gh from './lib/github.mjs';
import * as cf from './lib/cloudflare.mjs';
import * as tg from './lib/telegram.mjs';

const STATE_PATH = '.bootstrap-state.json';

const REQUIRED_FIELDS = [
  { key: 'github_owner',  prompt: 'GitHub owner (user/org)' },
  { key: 'github_repo',   prompt: 'GitHub repo name (default: yarlykon)' },
  { key: 'github_token',  prompt: 'GitHub PAT (repo, workflow scopes)', secret: true },
  { key: 'cf_account_id', prompt: 'Cloudflare Account ID' },
  { key: 'cf_api_token',  prompt: 'Cloudflare API Token (Workers + KV edit)', secret: true },
  { key: 'tg_bot_token',  prompt: 'Telegram Bot token (@BotFather)', secret: true },
  { key: 'pages_domain',  prompt: 'Pages domain (e.g. short.example.com or {owner}.github.io/{repo})' },
  { key: 'allowed_users', prompt: 'Allowed users CSV (tg:123,vk:456)' },
  { key: 'slug_mode',     prompt: 'Slug mode [random|counter] (default: random)' },
  { key: 'slug_len_init', prompt: 'Slug initial length (default: 4)' },
  { key: 'slug_len_max',  prompt: 'Slug max length (default: 8)' },
  { key: 'batch_max',     prompt: 'Batch max (default: 5)' },
  { key: 'metrika_id',    prompt: 'Yandex Metrika counter ID (empty to skip)', optional: true },
];

const DEFAULTS = {
  github_repo: 'yarlykon',
  slug_mode: 'random',
  slug_len_init: '4',
  slug_len_max: '8',
  batch_max: '5',
  metrika_id: '',
};

const STAGES = [
  { id: 1, name: 'verify tokens',          run: stage1_verifyTokens },
  { id: 2, name: 'write GitHub secrets',   run: stage2_writeSecrets },
  { id: 3, name: 'render wrangler.toml',   run: stage3_renderWrangler },
  { id: 4, name: 'create+bind KV',         run: stage4_createKv },
  { id: 5, name: 'deploy worker',          run: stage5_deployWorker },
  { id: 6, name: 'configure bot',          run: stage6_configureBot },
  { id: 7, name: 'enable GitHub Pages',    run: stage7_enablePages },
  { id: 8, name: 'seed repo',              run: stage8_seedRepo },
];

// -------------------- main --------------------

async function main() {
  const argv = parseArgv(process.argv.slice(2));
  const targetStage = argv.stage ? Number(argv.stage) : null;

  let config = await loadConfig(argv);
  const state = await loadState();

  for (const stage of STAGES) {
    if (targetStage && stage.id !== targetStage) continue;
    if (state.done?.includes(stage.id) && !argv.force) {
      console.log(`[${stage.id}/8] ${stage.name} — already done (use --force)`);
      continue;
    }
    console.log(`\n[${stage.id}/8] ${stage.name}…`);
    try {
      await stage.run(config, state);
      state.done = Array.from(new Set([...(state.done || []), stage.id]));
      await saveState(state);
      console.log(`[${stage.id}/8] ✓ done`);
    } catch (err) {
      console.error(`[${stage.id}/8] ✗ failed: ${err.message}`);
      throw err;
    }
  }

  console.log('\nBootstrap complete.');
  console.log(`Pages: https://${config.pages_domain}`);
  console.log(`Worker: see Cloudflare dashboard`);
  console.log(`Bot: try /shorten https://example.com`);
}

// -------------------- stages --------------------

async function stage1_verifyTokens(cfg) {
  await gh.verifyToken(cfg.github_token);
  await cf.verifyToken(cfg.cf_api_token, cfg.cf_account_id);
  await tg.verifyBot(cfg.tg_bot_token);
}

async function stage2_writeSecrets(cfg) {
  // GitHub Secrets для workflow_dispatch (если кто-то будет деплоить через Action позже)
  const secrets = {
    CF_API_TOKEN:   cfg.cf_api_token,
    CF_ACCOUNT_ID:  cfg.cf_account_id,
    TG_BOT_TOKEN:   cfg.tg_bot_token,
    METRIKA_ID:     cfg.metrika_id || '',
  };
  for (const [name, value] of Object.entries(secrets)) {
    if (!value) continue;
    try {
      await gh.setSecret(cfg.github_owner, cfg.github_repo, cfg.github_token, name, value);
      console.log(`  · ${name}`);
    } catch (err) {
      if (err.message?.includes('403')) {
        console.log(`  · ${name} — skipped (PAT lacks Secrets permission, set manually)`);
      } else {
        throw err;
      }
    }
  }
}

async function stage3_renderWrangler(cfg) {
  const tmplPath = path.join('worker', 'wrangler.toml.tmpl');
  const outPath = path.join('worker', 'wrangler.toml');
  let tmpl = await fs.readFile(tmplPath, 'utf-8');

  const vars = {
    WORKER_NAME: `yarlykon-${cfg.github_owner.toLowerCase()}`,
    API_DOMAIN: '',
    KV_NAMESPACE_ID: 'PLACEHOLDER_FILLED_IN_STAGE_5',
    GITHUB_OWNER: cfg.github_owner,
    GITHUB_REPO: cfg.github_repo,
    PAGES_DOMAIN: cfg.pages_domain,
    ALLOWED_USERS: cfg.allowed_users,
    SLUG_MODE: cfg.slug_mode,
    SLUG_LEN_INIT: cfg.slug_len_init,
    SLUG_LEN_MAX: cfg.slug_len_max,
    BATCH_MAX: cfg.batch_max,
    METRIKA_ID: cfg.metrika_id || '',
  };
  tmpl = tmpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
  await fs.writeFile(outPath, tmpl, 'utf-8');
  console.log(`  · ${outPath}`);
}

async function stage4_createKv(cfg, state) {
  const nsName = `yarlykon-${cfg.github_owner.toLowerCase()}`;
  const ns = await cf.ensureKvNamespace(cfg.cf_api_token, cfg.cf_account_id, nsName);
  state.kv_namespace_id = ns.id;

  // Подставить ID в wrangler.toml
  const tomlPath = path.join('worker', 'wrangler.toml');
  let toml = await fs.readFile(tomlPath, 'utf-8');
  toml = toml.replace('PLACEHOLDER_FILLED_IN_STAGE_5', ns.id);
  await fs.writeFile(tomlPath, toml, 'utf-8');
  console.log(`  · KV ${nsName} → ${ns.id}`);
}

async function stage5_deployWorker(cfg) {
  // Wrangler выкатывает по wrangler.toml. Секреты бэка ставим отдельно.
  await cf.wranglerSetSecret(cfg.cf_api_token, 'GITHUB_TOKEN', cfg.github_token);
  await cf.wranglerSetSecret(cfg.cf_api_token, 'TG_BOT_TOKEN', cfg.tg_bot_token);
  await cf.wranglerDeploy(cfg.cf_api_token);
  console.log(`  · worker deployed`);
}

async function stage6_configureBot(cfg, state) {
  // Worker URL не знаем без cf-инспекции; в простой схеме — используем
  // workers.dev сабдомен через cf API.
  const workerUrl = await cf.getWorkerUrl(cfg.cf_api_token, cfg.cf_account_id, `yarlykon-${cfg.github_owner.toLowerCase()}`);
  state.worker_url = workerUrl;

  await tg.setWebhook(cfg.tg_bot_token, `${workerUrl}/webhook/telegram`);
  await tg.setMenuButton(cfg.tg_bot_token, {
    type: 'web_app',
    text: 'Ярлыкон',
    web_app: { url: `https://${cfg.pages_domain}/miniapp/` },
  });
  console.log(`  · webhook → ${workerUrl}/webhook/telegram`);
  console.log(`  · menu button → https://${cfg.pages_domain}/miniapp/`);
}

async function stage7_enablePages(cfg) {
  await gh.enablePages(cfg.github_owner, cfg.github_repo, cfg.github_token, {
    branch: 'main',
    path: '/',
  });
  console.log(`  · Pages source: main /`);
}

async function stage8_seedRepo(cfg) {
  // Проверяем index.json — если нет, заливаем из seed/.
  const exists = await gh.fileExists(cfg.github_owner, cfg.github_repo, cfg.github_token, 'index.json');
  if (exists) {
    console.log(`  · index.json already exists, skipping seed`);
    return;
  }
  const seedIndex = await fs.readFile(path.join('seed', 'index.json'), 'utf-8');
  await gh.putFile(
    cfg.github_owner, cfg.github_repo, cfg.github_token,
    'index.json',
    seedIndex,
    'seed: empty index.json',
  );
  console.log(`  · index.json seeded`);
}

// -------------------- config + state --------------------

async function loadConfig(argv) {
  const cfg = { ...DEFAULTS };

  // Env
  for (const f of REQUIRED_FIELDS) {
    const envKey = 'YARLYKON_' + f.key.toUpperCase();
    if (process.env[envKey]) cfg[f.key] = process.env[envKey];
  }
  // CLI flags
  for (const k of Object.keys(argv)) {
    if (REQUIRED_FIELDS.find(f => f.key === k)) cfg[k] = argv[k];
  }

  // Interactive fill
  const missing = REQUIRED_FIELDS.filter(f => !f.optional && !cfg[f.key]);
  if (missing.length && input.isTTY) {
    const rl = readline.createInterface({ input, output });
    for (const f of missing) {
      const ans = await rl.question(`${f.prompt}: `);
      cfg[f.key] = ans.trim() || DEFAULTS[f.key] || '';
    }
    await rl.close();
  } else if (missing.length) {
    throw new Error(`Missing config: ${missing.map(f => f.key).join(', ')}. Pass via env or flags.`);
  }

  return cfg;
}

async function loadState() {
  try {
    return JSON.parse(await fs.readFile(STATE_PATH, 'utf-8'));
  } catch {
    return { done: [] };
  }
}

async function saveState(state) {
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

function parseArgv(args) {
  const out = {};
  for (const a of args) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1].replace(/-/g, '_')] = m[2] ?? 'true';
  }
  return out;
}

main().catch(err => { console.error(err); process.exit(1); });
