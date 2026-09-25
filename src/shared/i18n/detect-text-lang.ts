import type { Lang } from './index'

// Язык ТЕКСТА (а не интерфейса) — для генерации: запрос «Brewing a proper cup of tea»
// при русском интерфейсе должен давать английский список, и наоборот.
//
// Правило НЕСИММЕТРИЧНОЕ, и это намеренно. Считать «каких букв больше» нельзя:
// в русском запросе латинские ТЕРМИНЫ почти всегда есть и легко перевешивают
// («настроить nginx reverse proxy с TLS» — латиницы больше, а запрос русский),
// тогда как кириллица в английском запросе не встречается практически никогда.
// Поэтому: написал хоть что-то кириллицей — значит русский, сколько бы рядом ни
// стояло технических терминов латиницей.
export function detectTextLang(text: string, fallback: Lang): Lang {
  const hasCyrillic = /[Ѐ-ӿ]/.test(text)
  if (hasCyrillic) return 'ru'
  const hasLatin = /[A-Za-z]/.test(text)
  if (hasLatin) return 'en'
  return fallback // только цифры/символы — угадывать нечего, берём язык интерфейса
}

// Язык ДЛИННОГО контента (весь список: заголовки, описания, шаги) — для
// садовника и рефайна. Здесь правило «хоть одна кириллица → ru» опасно уже в
// обратную сторону: английский список с одной русской цитатой в шаге — не
// русский. Поэтому порог: кириллица ≥ трети букв → ru (русские технические
// списки полны латинских команд — треть остаётся надёжным сигналом; ключам
// LocaleText верить нельзя — createTemplate кладёт текст под язык интерфейса
// автора). Расширение LOCALES потребует настоящей детекции, пока алфавитов два.
export function textLang(texts: (string | null | undefined)[]): Lang {
  let cyr = 0
  let lat = 0
  for (const v of texts) {
    if (!v) continue
    cyr += (v.match(/[а-яё]/gi) ?? []).length
    lat += (v.match(/[a-z]/gi) ?? []).length
  }
  return cyr > 0 && cyr >= (cyr + lat) / 3 ? 'ru' : 'en'
}

/**
 * Язык ОРИГИНАЛА списка: записанный (ADR-0030), а у списков до него — по алфавиту названия.
 * Одно правило на страницу для робота и на кнопку «Перевести»: две разные эвристики расходились
 * (одна считала «nginx reverse proxy с TLS» английским, другая — русским).
 */
export function listSourceLang(stored: string | null | undefined, title: Partial<Record<string, string>> | null | undefined): string {
  return stored || textLang(Object.values(title ?? {}))
}

/**
 * Показывать ли кнопку «Перевести»: у названия нет ключа языка зрителя И оригинал не на нём.
 * Оригинал — `listSourceLang` (записанный, иначе по алфавиту): русский список «Docker Compose»
 * по алфавиту сошёл бы за английский, а записанный язык говорит правду.
 */
export function isTitleForeign(title: Partial<Record<string, string>>, stored: string | null | undefined, viewer: string): boolean {
  return !title[viewer] && listSourceLang(stored, title) !== viewer
}

/** Кириллица, которой нет в русском алфавите: украинская, белорусская, казахская, сербская. */
const OTHER_CYRILLIC = /[іїєґўәғқңөұүһђјљњћџ]/i
/** Латиница с диакритикой — немецкий, испанский, французский, польский, чешский… */
const LATIN_DIACRITICS = /[à-öø-ÿßœæąćęłńśźżčďěňřšťůžőű]/i

/**
 * Язык оригинала списка при ЗАПОЛНЕНИИ старых списков (ADR-0030) — только там, где уверены.
 *
 * По алфавиту уверенно отличаются лишь русский и английский. Всё остальное — `mixed`, то есть
 * «не писать, показать человеку»: записанное значение дальше считается авторским, и догадку
 * скрипта уже никто не отличит от выбора автора.
 *  • `multiKey` — у текста первой версии больше одного языка: это копия переведённого списка
 *    (форк и «как шаблон» копируют шаги вместе с переводом), оригинал по ней не определить;
 *  • кириллица не из русского алфавита, латиница с диакритикой — другой язык;
 *  • кириллицы меньше трети букв — смесь (правило `textLang`: русские технические списки полны
 *    латинских команд, и треть остаётся надёжным сигналом).
 */
export function classifyListLang(texts: string[], multiKey: boolean): 'ru' | 'en' | 'mixed' | 'empty' {
  const joined = texts.join('\n')
  const cyr = (joined.match(/[а-яё]/gi) ?? []).length
  const lat = (joined.match(/[a-z]/gi) ?? []).length
  if (cyr + lat === 0 && !OTHER_CYRILLIC.test(joined) && !LATIN_DIACRITICS.test(joined)) return 'empty'
  if (multiKey || OTHER_CYRILLIC.test(joined) || LATIN_DIACRITICS.test(joined)) return 'mixed'
  if (cyr > 0) return cyr / (cyr + lat) >= 1 / 3 ? 'ru' : 'mixed'
  return 'en'
}
