/**
 * VK Mini App — проверка launch params.
 *
 * TODO(adapter): полная реализация.
 *
 * Спецификация:
 *   https://dev.vk.com/ru/mini-apps/development/launch-params
 *
 * Алгоритм:
 *   1. launch_params приходит как querystring.
 *   2. Берутся параметры с префиксом 'vk_', сортируются по ключу.
 *   3. Склеиваются как querystring (без префиксов? см. доку — там есть нюансы).
 *   4. HMAC_SHA256(secret_key=secure_token, data) -> base64url-нормализованный.
 *   5. Сравнить с параметром 'sign'.
 *
 * Особенности:
 *   - VK App нужен в типе "Mini App", не "iframe app" (там другая схема).
 *   - secret выдаётся в кабинете разработчика VK.
 *   - user.id берётся из 'vk_user_id'.
 */

export async function verifyVkLaunchParams(
  launchParams: string,
  appSecret: string,
): Promise<{ id: string } | null> {
  if (!launchParams || !appSecret) return null;

  // TODO(adapter): реализовать по спеке.
  // Заглушка: возвращает null, чтобы система оставалась безопасной по умолчанию.
  console.warn('VK adapter not yet implemented');
  return null;
}
