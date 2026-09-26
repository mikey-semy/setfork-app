import { en, type DictKey } from './dict/en'
import { isContentLang, type ContentLang } from './iso639'
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

/**
 * Атрибуты куки языка — ОДНИ на всех, кто её пишет: переключатель в шапке и middleware
 * (переход со старого адреса `/ru/…`). Год — выбор не теряется при перезапуске браузера;
 * `Lax` — кука уходит и при переходе с чужого сайта (из выдачи поисковика), а без явного
 * атрибута Firefox и Safari её `Lax` не считают.
 */
export const LANG_COOKIE_OPTIONS = { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' } as const

/** Та же кука строкой — для `document.cookie` в браузере. */
export function langCookieString(lang: Lang): string {
  const o = LANG_COOKIE_OPTIONS
  return `${LANG_COOKIE}=${lang}; path=${o.path}; max-age=${o.maxAge}; samesite=${o.sameSite}`
}

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
 *  рендерился как голое «1.» без текста (видно было в диффе версий).
 *
 *  Запросить можно любой язык контента, не только язык интерфейса: MCP читает список на
 *  языке его оригинала (ADR-0030), а оригинал бывает белорусским. */
export function tr(text: LocaleText | null | undefined, lang: ContentLang): string {
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
export function trKey(text: LocaleText | null | undefined, lang: ContentLang): string | undefined {
  if (!text) return undefined
  if (text[lang]) return lang
  if (text.en) return 'en'
  return Object.keys(text).find((k) => text[k])
}

/** Язык, на котором ОТДАН текст: запрошенный, если есть перевод, иначе оригинал.
 *
 *  Метка языка наружу обязана говорить о тексте, а не о просьбе: `data.json` русского
 *  списка без перевода объявлял `en` (fe#968), а разметка с `lang="en"` читалась бы
 *  экранным диктором английским голосом. Языка в адресе нет (ADR-0029), и поисковик
 *  узнаёт язык страницы отсюда же. Порядок — тот же, что у `tr`, через `trKey`. */
export function servedLang(text: LocaleText | null | undefined, lang: Lang): string {
  return trKey(text, lang) ?? lang
}

/** Ключ, под который пишется ПРАВКА текста (ADR-0030) — одно правило на редактор, предложение
 *  правки и настройки: ключ ПОКАЗАННОГО текста (`trKey` — тот же порядок, что у `tr`, которым
 *  форма его показала); показывать нечего — язык оригинала, иначе язык интерфейса.
 *
 *  ⚠️ Именно показанного, а не «оригинала»: у белорусского списка с английским переводом русский
 *  интерфейс показывает английский текст, и запись под `be` затёрла бы оригинал переводом (ревью по
 *  линзам). А без правила вообще первая же правка белорусского списка из русского интерфейса
 *  уводила шаг под `ru`, и ключи смешивались. */
export function editKey(ui: Lang, stored: string | null | undefined, shown: LocaleText | null | undefined): ContentLang {
  const key = trKey(shown, ui)
  if (isContentLang(key)) return key
  return isContentLang(stored) ? stored : ui
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

/**
 * Категория числа по CLDR — у платформы, а не своей арифметикой (`Intl.PluralRules`).
 * Своё правило для русского («кончается на 1, но не на 11») было верным для целых, но
 * арифметику каждого нового языка пришлось бы писать руками — у CLDR она есть для всех.
 * Новому языку по-прежнему нужны формы в `PLURALS` и соответствие «категория → форма».
 * Экземпляр — НА ЯЗЫК: общий на всё кэш на сервере склонял бы английский экран по-русски
 * («21 comment»), если первый запрос после старта был русским.
 */
const pluralRules = new Map<Lang, Intl.PluralRules>()
function pluralCategory(n: number, lang: Lang): Intl.LDMLPluralRule {
  let rules = pluralRules.get(lang)
  if (!rules) pluralRules.set(lang, (rules = new Intl.PluralRules(lang)))
  return rules.select(n)
}

/**
 * Категория CLDR → номер формы в словаре. У русского форм три: «одна» (1, 21),
 * «несколько» (2–4, 22) и «много» (5, 11). `other` у русского — дробные (и NaN/Infinity,
 * которых счётчики не передают): при дроби существительному нужен родительный
 * единственного, «1,5 версии», как у «нескольких». Предложный `listsIn` при дроби выйдет
 * «в 1,5 списках» вместо «списка» — дробей в счётчиках нет, третьей формы ради них не
 * заводим. `zero`/`two` у русского не бывает, ключи — для полноты типа.
 */
const RU_FORM: Record<Intl.LDMLPluralRule, 0 | 1 | 2> = { zero: 2, one: 0, two: 1, few: 1, many: 2, other: 1 }

/** Форма слова при числе: `plural(1, 'branches', 'ru')` → «ветка». */
export function plural(n: number, key: PluralKey, lang: Lang): string {
  const forms = PLURALS[key]
  const category = pluralCategory(n, lang)
  if (lang === 'ru') return forms.ru[RU_FORM[category]]
  return forms.en[category === 'one' ? 0 : 1]
}
