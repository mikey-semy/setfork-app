import { DEFAULT_LANG, type Lang } from './index'

/**
 * Текущий язык интерфейса. Пока проект English-only (международная аудитория,
 * генерация на английском) — всегда 'en'. Инфраструктура i18n (t/tr, locale-JSON,
 * бинарный тип Lang) сохранена, чтобы позже включить выбор языков как на GitHub.
 */
export async function getLang(): Promise<Lang> {
  return DEFAULT_LANG
}
