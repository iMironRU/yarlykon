/**
 * Telegram Mini App — проверка initData.
 *
 * Спецификация:
 *   https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Алгоритм:
 *   1. Распарсить initData как querystring.
 *   2. Извлечь hash, остальные пары отсортировать по ключу.
 *   3. Склеить в data_check_string ("key=value\nkey=value...").
 *   4. secret_key = HMAC_SHA256("WebAppData", bot_token).
 *   5. computed = HMAC_SHA256(secret_key, data_check_string).
 *   6. Сравнить computed.hex с hash в постоянном времени.
 *   7. Проверить auth_date не старше 24 ч.
 */

export async function verifyTelegramInitData(
  initData: string,
  botToken: string,
): Promise<{ id: string } | null> {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  params.delete('hash');

  // data_check_string
  const pairs: string[] = [];
  const keys = Array.from(params.keys()).sort();
  for (const k of keys) {
    pairs.push(`${k}=${params.get(k)}`);
  }
  const dataCheckString = pairs.join('\n');

  // secret_key = HMAC_SHA256("WebAppData", botToken)
  const enc = new TextEncoder();
  const webAppDataKey = await crypto.subtle.importKey(
    'raw',
    enc.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const secretKeyBuf = await crypto.subtle.sign('HMAC', webAppDataKey, enc.encode(botToken));

  // computed = HMAC_SHA256(secretKey, dataCheckString)
  const secretKey = await crypto.subtle.importKey(
    'raw',
    secretKeyBuf,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const computedBuf = await crypto.subtle.sign('HMAC', secretKey, enc.encode(dataCheckString));
  const computedHex = bufToHex(computedBuf);

  if (!constantTimeEqual(computedHex, hash)) return null;

  // freshness
  const authDate = parseInt(params.get('auth_date') ?? '0', 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!authDate || nowSec - authDate > 24 * 60 * 60) return null;

  // user
  const userRaw = params.get('user');
  if (!userRaw) return null;
  try {
    const user = JSON.parse(userRaw);
    if (typeof user.id !== 'number') return null;
    return { id: String(user.id) };
  } catch {
    return null;
  }
}

function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
