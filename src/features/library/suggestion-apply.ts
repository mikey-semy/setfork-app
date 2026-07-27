import type { Lang, LocaleText } from '@/shared/i18n'
import type { ProposedItem } from '@/shared/db'

/** Поля пункта, к которым можно предложить замену (совпадает с полями якоря). */
const TEXT_FIELDS = ['title', 'desc', 'why', 'section'] as const
type TextField = (typeof TEXT_FIELDS)[number]

const isTextField = (f: string): f is TextField => (TEXT_FIELDS as readonly string[]).includes(f)

/**
 * Подстановка предложенного текста в ОДНО поле пункта.
 *
 * Чистая функция в отдельном модуле — потому что её ошибка не падает, а тихо
 * теряет чужой текст: подставили не в то поле — и правка «применилась», затерев
 * соседнее. Такое проверяют примерами, а не на глаз.
 *
 * Язык. Заменяем ветку ТЕКУЩЕГО языка, остальные оставляем: у двуязычного списка
 * предложение на русском не должно стирать английский перевод. `command` —
 * единственное не-локализованное поле, оно строка.
 *
 * Неизвестное поле возвращает пункт как есть: лучше не применить ничего, чем
 * применить наугад.
 */
export function applyFieldValue(item: ProposedItem, field: string, value: string, lang: Lang): ProposedItem {
  if (field === 'command') return { ...item, command: value }
  if (!isTextField(field)) return item
  const prev = (item[field] ?? {}) as LocaleText
  return { ...item, [field]: { ...prev, [lang]: value } }
}
