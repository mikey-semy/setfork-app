import type { Lang } from './index'

// Язык ТЕКСТА (а не интерфейса) — по преобладанию алфавита. Нужен генерации: запрос
// «Brewing a proper cup of tea» при русском UI должен давать английский список.
// Намеренно тупая эвристика: считаем буквы, а не подключаем детектор — запросы короткие,
// а алфавиты ru/en не пересекаются, так что этого достаточно.
export function detectTextLang(text: string, fallback: Lang): Lang {
  const cyrillic = (text.match(/[Ѐ-ӿ]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  if (cyrillic === 0 && latin === 0) return fallback // цифры/símболы — не угадать
  if (cyrillic > latin) return 'ru'
  if (latin > cyrillic) return 'en'
  return fallback // поровну (смешанный запрос) — не спорим с выбором интерфейса
}
