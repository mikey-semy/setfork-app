import { en, type DictKey } from './dict/en'
import { ru } from './dict/ru'

// i18n SetFork. English-first (как GitHub), сейчас доступен русский.
// Контент (шаблоны/шаги/темы) хранится как locale-JSON (LocaleText), поэтому
// добавить язык = только данные, без миграций схемы. UI-строки — в dict/*.ts.

// Список локалей — ЕДИНСТВЕННЫЙ источник правды. Добавить язык = дописать код
// сюда + строку в LANG_META (+ переводы контента данными). Никаких бинарных
// en/ru-допущений в коде: LangSwitch, даты (Intl) и промпт генерации читают
// отсюда. Модель данных (LocaleText) уже держит любой код.
export const LOCALES = ['en', 'ru'] as const
export type Locale = (typeof LOCALES)[number]
export type Lang = Locale

export const DEFAULT_LANG: Lang = 'en'
export const LANG_COOKIE = 'lang'

/** Метаданные локали: endonym (само-название для UI) + English name (для
 *  промпта ИИ-генерации/перевода). BCP-47-код совпадает с самим ключом Lang,
 *  поэтому в Intl.* передаётся напрямую. */
export const LANG_META: Record<Lang, { endonym: string; enName: string }> = {
  en: { endonym: 'English', enName: 'English' },
  ru: { endonym: 'Русский', enName: 'Russian' },
}

/** English-название языка для промптов ИИ (напр. «All content MUST be in Russian»). */
export function langEnName(lang: Lang): string {
  return LANG_META[lang]?.enName ?? lang
}

/** Переводимый контент: { en: '…', ru: '…', … }. Ключ — код языка. */
export type LocaleText = Partial<Record<string, string>>

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v)
}

/** Резолв locale-текста с фолбэком: запрошенный → en → первый доступный.
 *  Фолбэк по ПУСТОТЕ, а не по nullish: `{ ru: '', en: 'Soak gelatin' }` должен
 *  дать английский. С `??` пустая строка не nullish и глушила фолбэк — пункт
 *  рендерился как голое «1.» без текста (видно было в диффе версий). */
export function tr(text: LocaleText | null | undefined, lang: Lang): string {
  if (!text) return ''
  return text[lang] || text.en || Object.values(text).find(Boolean) || ''
}

/** То же чтение, но терпимое к ЗНАЧЕНИЮ БЕЗ ЯЗЫКА — простой строке.
 *
 *  Так хранился markdown блоков до того, как перевод научился их видеть, и
 *  переписывать историю версий ради формы записи незачем: пишем строго, читаем
 *  терпимо. Живёт здесь, а не в features/library, потому что читают это и
 *  комментарии, и раскопка, а features друг друга не импортируют.
 *
 *  Без языка ведёт себя как tr(..., 'en'): английский, иначе первый доступный.
 *  Вызывающим, у которых языка зрителя под рукой нет — экспорт, дифф, выдача
 *  агенту, — передавать нечего, и они получают оригинал, а не пустоту. */
export function trLoose(v: unknown, lang: Lang = 'en'): string {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') return tr(v as LocaleText, lang)
  return ''
}

/** Ключ, ИЗ КОТОРОГО tr() возьмёт значение (undefined — брать нечего).
 *
 *  Нужен там, где правка кладётся поверх ПРОЧИТАННОГО: записать её в другой ключ
 *  значит обновить один перевод, а наружу продолжать отдавать прежний — правка
 *  выглядит применённой, но не видна. Порядок ОБЯЗАН повторять tr() выше, поэтому
 *  они и живут рядом. */
export function trKey(text: LocaleText | null | undefined, lang: Lang): string | undefined {
  if (!text) return undefined
  if (text[lang]) return lang
  if (text.en) return 'en'
  return Object.keys(text).find((k) => text[k as Lang])
}

// Словарь UI-строк живёт по языкам в dict/ (Ф1 трека i18n-extraction):
// en.ts — источник ключей (DictKey), остальные — Record<DictKey, string>,
// паритет держит компилятор. Новый язык = файл в dict/ + строка в DICTS
// (+ LOCALES и LANG_META выше).
const DICTS: Record<Locale, Record<DictKey, string>> = { en, ru }

export type TKey = DictKey

export function t(key: TKey, lang: Lang): string {
  // Как у tr(): фолбэк по пустоте — запрошенный язык → en.
  return DICTS[lang]?.[key] || DICTS.en[key] || ''
}

/** Строка словаря с подстановкой: `fill('digest.newVersions', lang, { n: 3, versions: … })`.
 *  Плейсхолдеры в словаре — `{имя}`; подставляются ВСЕ вхождения. */
export function fill(key: TKey, lang: Lang, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((s, [name, value]) => s.split(`{${name}}`).join(String(value)), t(key, lang))
}

// ── Склонения при числах ────────────────────────────────────────────────
// «1 веток» — брак, который видно сразу. У русского три формы (1 ветка,
// 2 ветки, 5 веток) и свои правила для 11–14; у английского две. Отдельный
// словарь, а не строки в DICT: там одна форма на ключ, склонение туда не лезет.
const PLURALS = {
  stars: { ru: ['звезда', 'звезды', 'звёзд'], en: ['star', 'stars'] },
  forks: { ru: ['форк', 'форка', 'форков'], en: ['fork', 'forks'] },
  views: { ru: ['просмотр', 'просмотра', 'просмотров'], en: ['view', 'views'] },
  watchers: { ru: ['наблюдатель', 'наблюдателя', 'наблюдателей'], en: ['watcher', 'watchers'] },
  branches: { ru: ['ветка', 'ветки', 'веток'], en: ['branch', 'branches'] },
  versions: { ru: ['версия', 'версии', 'версий'], en: ['version', 'versions'] },
  edits: { ru: ['правка', 'правки', 'правок'], en: ['edit', 'edits'] },
  runs: { ru: ['прогон', 'прогона', 'прогонов'], en: ['run', 'runs'] },
  lists: { ru: ['список', 'списка', 'списков'], en: ['list', 'lists'] },
  // Предложный падеж («в 1 списке», «в 5 списках»): у русского это ДРУГИЕ формы,
  // чем именительный выше, и без них выходит «в 5 списков».
  listsIn: { ru: ['списке', 'списках', 'списках'], en: ['list', 'lists'] },
  issues: { ru: ['задача', 'задачи', 'задач'], en: ['issue', 'issues'] },
  contributions: { ru: ['вклад', 'вклада', 'вкладов'], en: ['contribution', 'contributions'] },
  suggestions: { ru: ['предложение', 'предложения', 'предложений'], en: ['suggestion', 'suggestions'] },
  contributors: { ru: ['участник', 'участника', 'участников'], en: ['contributor', 'contributors'] },
  // Шаги отчёта о прогоне: «1/1 шагов» читалось как обрывок. Ключ жил в пространстве
  // имён (`report.steps`), и архитектурная проверка склонений его не видела.
  steps: { ru: ['шаг', 'шага', 'шагов'], en: ['step', 'steps'] },
  // Реплики в задаче. Раньше рядом с числом подставлялась подпись КНОПКИ
  // («Комментировать»), и в шапке задачи стояло «0 комментировать».
  comments: { ru: ['комментарий', 'комментария', 'комментариев'], en: ['comment', 'comments'] },
  followers: { ru: ['подписчик', 'подписчика', 'подписчиков'], en: ['follower', 'followers'] },
  rows: { ru: ['строка', 'строки', 'строк'], en: ['row', 'rows'] },
  // Прилагательные при числе склоняются так же, как существительные: «1 открытая»,
  // «2 открытые», «5 открытых». По-английски форма одна — поэтому дефект и переживал
  // проверку на английском экране.
  openIssues: { ru: ['открытая', 'открытые', 'открытых'], en: ['open', 'open'] },
  closedIssues: { ru: ['закрытая', 'закрытые', 'закрытых'], en: ['closed', 'closed'] },
} as const

export type PluralKey = keyof typeof PLURALS

/** Форма слова при числе: `plural(1, 'branches', 'ru')` → «ветка». */
export function plural(n: number, key: PluralKey, lang: Lang): string {
  const forms = PLURALS[key]
  if (lang !== 'ru') return forms.en[n === 1 ? 0 : 1]
  const abs = Math.abs(n) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return forms.ru[2]
  if (last === 1) return forms.ru[0]
  if (last >= 2 && last <= 4) return forms.ru[1]
  return forms.ru[2]
}
