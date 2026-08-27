import { t, type Lang, type TKey } from '@/shared/i18n'

/**
 * Отказ зеркала: КОД от ядра → текст на языке человека.
 *
 * Решение И1 (владелец 31.07.2026): ядро отдаёт машинный код, текст подбирает фронт.
 * До 26.08.2026 ядро в двух местах слало готовую РУССКУЮ ПРОЗУ — `MirrorCheckResponse.error`
 * и статус через `record_mirror_result`, — то есть интерфейс на английском показал бы
 * русскую строку, а изменить формулировку без выкатки ядра было нельзя.
 *
 * ⚠️ Всё, что НЕ код из этой таблицы, показывается КАК ЕСТЬ и это осознанно: там вывод
 * git без кредов («repository not found», «authentication failed»), и он полезнее любого
 * нашего «не удалось». Подменять его общей фразой значит отобрать у владельца
 * единственную подсказку.
 */
const MIRROR_ERR: Record<string, TKey> = {
  'not-configured': 'mirror.errNotConfigured',
  // Ключ шифрования токенов не задан на сервере: чинит администратор, владелец списка
  // не может ничего — и текст обязан это сказать, иначе он будет искать ошибку у себя.
  'secret-missing': 'mirror.errSecretMissing',
  // А вот это чинит именно владелец: ключ сменился, токен надо ввести заново.
  'token-undecryptable': 'mirror.errTokenUndecryptable',
}

export function mirrorErrorText(error: string, lang: Lang): string {
  const key = MIRROR_ERR[error]
  return key ? t(key, lang) : error
}
