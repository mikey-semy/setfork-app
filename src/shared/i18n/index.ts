// Минимальная i18n EN/RU. Язык хранится в cookie `lang` и в <html lang>.
// Контент (шаблоны/шаги) двуязычен в БД (поля *_en/*_ru) — здесь только UI-строки.

export type Lang = 'en' | 'ru'

export const LANGS: Lang[] = ['en', 'ru']
export const DEFAULT_LANG: Lang = 'en'
export const LANG_COOKIE = 'lang'

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'ru'
}

/** Выбор двуязычного поля объекта: pick(t, 'title', lang) → t.titleEn | t.titleRu */
export function pick<T extends object>(obj: T, base: string, lang: Lang): string {
  const key = base + (lang === 'ru' ? 'Ru' : 'En')
  return ((obj as Record<string, unknown>)[key] as string) ?? ''
}

type Dict = Record<string, { en: string; ru: string }>

const DICT = {
  explore: { en: 'Explore', ru: 'Обзор' },
  myLists: { en: 'My lists', ru: 'Мои списки' },
  runs: { en: 'Runs', ru: 'Прогоны' },
  newList: { en: 'New list', ru: 'Новый список' },
  searchLists: { en: 'Search lists, topics or people…', ru: 'Поиск списков, тем, людей…' },
  heroSub: { en: 'Find a runnable checklist — or create one', ru: 'Найди запускаемый чек-лист — или создай' },
  searchPh: { en: 'Describe what you need to do…', ru: 'Опиши, что нужно сделать…' },
  topics: { en: 'Topics', ru: 'Темы' },
  trending: { en: 'Trending', ru: 'В тренде' },
  newest: { en: 'Newest', ru: 'Новые' },
  mostRun: { en: 'Most run', ru: 'Чаще прогоняют' },
  run: { en: 'Run', ru: 'Прогон' },
  fork: { en: 'Fork', ru: 'Форк' },
  forkTemplate: { en: 'Fork template', ru: 'Форкнуть шаблон' },
  history: { en: 'history', ru: 'история' },
  updated: { en: 'updated', ru: 'обновлён' },
  detailed: { en: 'Detailed', ru: 'Подробно' },
  compact: { en: 'Compact', ru: 'Кратко' },
  markDone: { en: 'Mark done', ru: 'Отметить' },
  collapse: { en: 'Collapse', ru: 'Свернуть' },
  subTasks: { en: 'Sub-tasks', ru: 'Подшаги' },
  references: { en: 'References', ru: 'Ссылки' },
  notePh: { en: '✎ add a note for this step…', ru: '✎ заметка к шагу…' },
  stateSaved: { en: 'State saved · run on', ru: 'Сохранено · прогон на' },
  now: { en: 'now', ru: 'сейчас' },
  done: { en: 'done', ru: 'готово' },
  screenshot: { en: 'Screenshot / expected output', ru: 'Скриншот / ожидаемый результат' },
  signIn: { en: 'Sign in', ru: 'Войти' },
  signInGithub: { en: 'Sign in with GitHub', ru: 'Войти через GitHub' },
  signInDemo: { en: 'Continue as demo', ru: 'Продолжить как demo' },
  signOut: { en: 'Sign out', ru: 'Выйти' },
  backToExplore: { en: 'Back to Explore', ru: 'Назад к обзору' },
  ofLists: { en: 'lists', ru: 'списков' },
  emptyRuns: { en: 'No runs yet. Start one from any list.', ru: 'Пока нет прогонов. Запусти любой список.' },
  emptyMyLists: { en: "You haven't created or forked any lists yet.", ru: 'Вы ещё не создали и не форкнули ни одного списка.' },
  loginRequired: { en: 'Sign in to run and fork checklists.', ru: 'Войдите, чтобы прогонять и форкать чек-листы.' },
  runIt: { en: 'Run it', ru: 'Прогнать' },
  resume: { en: 'Resume run', ru: 'Продолжить прогон' },
  forkedFrom: { en: 'forked from', ru: 'форк от' },
} satisfies Dict

export type TKey = keyof typeof DICT

export function t(key: TKey, lang: Lang): string {
  return DICT[key][lang]
}
