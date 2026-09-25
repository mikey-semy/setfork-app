/**
 * ЧТО АДМИНКА ВПРАВЕ ПЕРЕКРЫТЬ НА ЛЕНДИНГЕ — общий контракт сервера и формы.
 *
 * Список — ровно белый список `OVERRIDABLE` лендинга (`setfork-about/src/content.ts`,
 * ветка `claude/setfork-capabilities-wn6pye`, коммит `8aaaf25`) без `stats`, у которых своя
 * форма. Не все строки словаря: метаданные, бренд, копирайт и служебные подписи лендинг
 * перекрывать не даёт — заголовок и превью ссылок, собранные на сервере, обязаны совпадать
 * с тем, что видит посетитель. Ключ вне этого списка лендинг проигнорирует, и правка в
 * админке «сохранилась» бы впустую — поэтому формы для него нет. Меняя `OVERRIDABLE`,
 * обнови и этот список.
 *
 * Без `server-only`: перечень и лимиты нужны и форме, и серверу — одним источником.
 */
export const LANDING_KEYS = [
  'navHow', 'navSkills', 'navAgents', 'navExplore', 'signIn', 'startFree',
  'eyebrow', 'heroTitle', 'heroSub', 'searchPlaceholder', 'searchBtn',
  'howKicker', 'howTitle', 'howSub',
  'skillsKicker', 'skillsTitle', 'skillsSub',
  'aiKicker', 'aiTitle', 'aiSub', 'aiPanelTitle', 'aiPrompt', 'aiPanelBtn',
  'gitKicker', 'gitTitle', 'gitSub',
  'mcpKicker', 'mcpTitle', 'mcpSub', 'mcpRegistry',
  'listsKicker', 'listsTitle', 'listsLink', 'usedLabel',
  'commKicker', 'commTitle',
  'ctaTitle', 'ctaSub', 'ctaPrimary', 'ctaSecondary',
  'footerBlurb', 'footerNote',
] as const
export type LandingKey = (typeof LANDING_KEYS)[number]

/** Абзацы (подзаголовки, описания, промпт) — длиннее, остальное — заголовки и подписи. */
export const isLongKey = (key: string) => /Sub$|Blurb$|Prompt$/.test(key)

/**
 * Лимит длины строки — на сервере, а не только в форме: правки уходят всем через публичный
 * `/api/landing`, и мегабайт текста в поле ломал бы вёрстку лендинга у каждого посетителя.
 */
export const landingMaxLength = (key: string) => (isLongKey(key) ? 400 : 120)

/** Полоса доверия у лендинга — четыре плитки. */
export const LANDING_MAX_STATS = 4
export const STAT_MAX = { num: 12, label: 40, source: 200 } as const
