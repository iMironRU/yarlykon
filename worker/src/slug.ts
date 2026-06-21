/**
 * Генерация slug'ов.
 *
 * Два режима:
 *   - random:  case-sensitive base62, длина растёт от SLUG_LEN_INIT к SLUG_LEN_MAX при коллизиях.
 *   - counter: a, b, ..., z, A, ..., Z, 0, ..., 9, aa, ab, ...
 *
 * Контракт:
 *   generateSlug({ mode, lenInit, lenMax, taken }) → string
 *   taken — Set уже занятых slug'ов (включая те, что только что сгенерированы в текущей пачке).
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export interface SlugOptions {
  mode: 'random' | 'counter';
  lenInit: number;
  lenMax: number;
  taken: Set<string>;
}

export function generateSlug(opts: SlugOptions): string {
  if (opts.mode === 'counter') {
    return generateCounter(opts.taken);
  }
  return generateRandom(opts.lenInit, opts.lenMax, opts.taken);
}

function generateRandom(lenInit: number, lenMax: number, taken: Set<string>): string {
  const maxAttempts = 16;
  for (let len = lenInit; len <= lenMax; len++) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const s = randomString(len);
      if (!taken.has(s)) return s;
    }
  }
  throw new Error(`slug_pool_exhausted: tried up to length ${lenMax}`);
}

function randomString(len: number): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[arr[i] % ALPHABET.length];
  }
  return out;
}

function generateCounter(taken: Set<string>): string {
  // Брутфорсный, но эффективный: считаем максимальный counter-slug в taken
  // и берём следующий. taken может содержать random-slug'и из прошлого —
  // их игнорируем (counter генерирует только из allowed set).

  let next = 0;
  for (const s of taken) {
    if (isCounterSlug(s)) {
      const n = counterToInt(s);
      if (n >= next) next = n + 1;
    }
  }

  let candidate = intToCounter(next);
  while (taken.has(candidate)) {
    next++;
    candidate = intToCounter(next);
  }
  return candidate;
}

function isCounterSlug(s: string): boolean {
  if (!s) return false;
  for (const ch of s) {
    if (!ALPHABET.includes(ch)) return false;
  }
  return true;
}

function counterToInt(s: string): number {
  // bijective base-62
  let n = 0;
  for (const ch of s) {
    n = n * ALPHABET.length + (ALPHABET.indexOf(ch) + 1);
  }
  return n - 1;
}

function intToCounter(n: number): string {
  // bijective base-62
  let v = n + 1;
  let out = '';
  while (v > 0) {
    v--;
    out = ALPHABET[v % ALPHABET.length] + out;
    v = Math.floor(v / ALPHABET.length);
  }
  return out || 'a';
}
