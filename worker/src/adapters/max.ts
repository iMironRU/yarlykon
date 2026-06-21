/**
 * MAX — мессенджер от VK/МТС.
 *
 * TODO(adapter): полная реализация.
 *
 * Спецификация Bot API:
 *   https://dev.max.ru/ (актуально на момент проектирования)
 *
 * Особенности на момент написания скелета:
 *   - MAX Mini Apps относительно молодая часть платформы; формат initData
 *     ещё может меняться. Перед реализацией перечитать актуальную доку.
 *   - Подпись — HMAC, ключ — bot token, схожая с TG логика.
 *   - Автор форка (iMiron) имеет работающий модуль MAX Bot API на 1С —
 *     можно опираться на него как на референс структуры данных.
 */

export async function verifyMaxInitData(
  initData: string,
  botToken: string,
): Promise<{ id: string } | null> {
  if (!initData || !botToken) return null;

  // TODO(adapter): реализовать по спеке MAX.
  console.warn('MAX adapter not yet implemented');
  return null;
}
