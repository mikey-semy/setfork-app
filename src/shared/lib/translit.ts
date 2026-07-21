// Транслитерация кириллицы и детект языка текста — общие для слагов (library),
// хендлов (auth) и MCP-создания списков.

const RU_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

export function translitRu(s: string): string {
  return s
    .toLowerCase()
    .split('')
    .map((ch) => RU_LAT[ch] ?? ch)
    .join('')
}

/** Язык текста по доле кириллицы: ≥30% буквенных символов — русский. */
export function detectTextLang(text: string): 'ru' | 'en' {
  const letters = text.match(/[a-zA-Zа-яА-ЯёЁ]/g) ?? []
  if (!letters.length) return 'en'
  const cyr = letters.filter((ch) => /[а-яА-ЯёЁ]/.test(ch)).length
  return cyr / letters.length >= 0.3 ? 'ru' : 'en'
}
