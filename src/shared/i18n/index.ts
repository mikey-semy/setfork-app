// i18n SetHub. English-first (как GitHub), сейчас доступен русский.
// Контент (шаблоны/шаги/темы) хранится как locale-JSON (LocaleText), поэтому
// добавить язык = только данные, без миграций схемы. UI-строки — в DICT ниже.

export const LOCALES = ['en', 'ru'] as const
export type Locale = (typeof LOCALES)[number]
export type Lang = Locale

export const DEFAULT_LANG: Lang = 'en'
export const LANG_COOKIE = 'lang'

/** Переводимый контент: { en: '…', ru: '…', … }. Ключ — код языка. */
export type LocaleText = Partial<Record<string, string>>

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v)
}

/** Резолв locale-текста с фолбэком: запрошенный → en → первый доступный. */
export function tr(text: LocaleText | null | undefined, lang: Lang): string {
  if (!text) return ''
  return text[lang] ?? text.en ?? Object.values(text).find(Boolean) ?? ''
}

type Dict = Record<string, LocaleText>

const DICT = {
  explore: { en: 'Explore', ru: 'Обзор' },
  myLists: { en: 'My lists', ru: 'Мои списки' },
  runs: { en: 'Runs', ru: 'Прогоны' },
  newList: { en: 'New list', ru: 'Новый список' },
  searchLists: { en: 'Search lists, topics or people…', ru: 'Поиск списков, тем, людей…' },
  heroSub: { en: 'Find the canonical list — or make it better', ru: 'Найди эталонный список — или сделай его лучше' },
  searchPh: { en: 'Describe what you need to do…', ru: 'Опиши, что нужно сделать…' },
  topics: { en: 'Topics', ru: 'Темы' },
  tags: { en: 'Tags', ru: 'Теги' },
  allTags: { en: 'All', ru: 'Все' },
  tagsHint: { en: 'Tags (space or comma separated)', ru: 'Теги (через пробел или запятую)' },
  yourLists: { en: 'Your lists', ru: 'Твои списки' },
  recentActivity: { en: 'Recent activity', ru: 'Недавние изменения' },
  created: { en: 'created', ru: 'создал' },
  updatedTo: { en: 'updated to', ru: 'обновил до' },
  noActivity: { en: 'No activity yet.', ru: 'Пока нет активности.' },
  popularTags: { en: 'Popular tags', ru: 'Популярные теги' },
  aiDraft: { en: 'AI draft', ru: 'черновик ИИ' },
  generateWithAi: { en: 'Generate with AI', ru: 'Сгенерировать нейросетью' },
  cantFind: { en: "Can't find it?", ru: 'Не нашёл?' },
  aiFail: { en: "AI couldn't generate a list — try rephrasing.", ru: 'Нейросеть не смогла — переформулируй запрос.' },
  rateLimited: { en: 'Too many requests. Try again in a minute.', ru: 'Слишком часто. Попробуй через минуту.' },
  aiVerifyHint: {
    en: 'Drafted by AI — run it, like it, and improve it so it becomes proven.',
    ru: 'Черновик от нейросети — проверь, лайкни и улучши, чтобы он стал проверенным.',
  },
  trending: { en: 'Trending', ru: 'В тренде' },
  newest: { en: 'Newest', ru: 'Новые' },
  mostStarred: { en: 'Most starred', ru: 'Популярные' },
  like: { en: 'Like', ru: 'Нравится' },
  liked: { en: 'Liked', ru: 'Понравилось' },
  star: { en: 'Star', ru: 'Отметить' },
  starredTab: { en: 'Starred', ru: 'Избранное' },
  suggestEdit: { en: 'Suggest edit', ru: 'Предложить правку' },
  maintainedBy: { en: 'maintained by', ru: 'ведёт' },
  open: { en: 'Open', ru: 'Открыть' },
  edit: { en: 'Edit', ru: 'Редактировать' },
  suggestions: { en: 'Suggestions', ru: 'Предложения' },
  accept: { en: 'Accept', ru: 'Принять' },
  reject: { en: 'Reject', ru: 'Отклонить' },
  noSuggestions: { en: 'No suggestions yet.', ru: 'Пока нет предложений.' },
  proposedBy: { en: 'proposed by', ru: 'предложил' },
  changeNote: { en: 'What did you change and why?', ru: 'Что изменили и почему?' },
  sendSuggestion: { en: 'Send suggestion', ru: 'Отправить предложение' },
  saveVersion: { en: 'Save as new version', ru: 'Сохранить новую версию' },
  statusOpen: { en: 'open', ru: 'открыто' },
  statusAccepted: { en: 'accepted', ru: 'принято' },
  statusRejected: { en: 'rejected', ru: 'отклонено' },
  run: { en: 'Run', ru: 'Прогон' },
  fork: { en: 'Fork', ru: 'Форк' },
  forkTemplate: { en: 'Fork template', ru: 'Форкнуть шаблон' },
  bookmark: { en: 'Save', ru: 'В закладки' },
  saved: { en: 'Saved', ru: 'В закладках' },
  share: { en: 'Share', ru: 'Поделиться' },
  copied: { en: 'Copied', ru: 'Скопировано' },
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
  signedInAs: { en: 'Signed in as', ru: 'Вошёл как' },
  yourProfile: { en: 'Your profile', ru: 'Твой профиль' },
  theme: { en: 'Theme', ru: 'Тема' },
  language: { en: 'Language', ru: 'Язык' },
  create: { en: 'Create', ru: 'Создать' },
  darkMode: { en: 'Dark', ru: 'Тёмная' },
  lightMode: { en: 'Light', ru: 'Светлая' },
  backToExplore: { en: 'Back to Explore', ru: 'Назад к обзору' },
  ofLists: { en: 'lists', ru: 'списков' },
  emptyRuns: { en: 'No runs yet. Start one from any list.', ru: 'Пока нет прогонов. Запусти любой список.' },
  emptyMyLists: { en: "You haven't created or forked any lists yet.", ru: 'Вы ещё не создали и не форкнули ни одного списка.' },
  loginRequired: { en: 'Sign in to like and improve lists.', ru: 'Войдите, чтобы лайкать и улучшать списки.' },
  runIt: { en: 'Run it', ru: 'Прогнать' },
  resume: { en: 'Resume run', ru: 'Продолжить прогон' },
  forkedFrom: { en: 'forked from', ru: 'форк от' },
  allTopics: { en: 'All topics', ru: 'Все темы' },
  nothingFound: { en: 'Nothing found.', ru: 'Ничего не найдено.' },
  lists: { en: 'Lists', ru: 'Списки' },
  starred: { en: 'Starred', ru: 'В избранном' },
  joined: { en: 'joined', ru: 'на сайте с' },
  noStars: { en: 'No starred lists yet.', ru: 'Пока ничего в избранном.' },
  noProfileLists: { en: 'No lists yet.', ru: 'Пока нет списков.' },
} satisfies Dict

export type TKey = keyof typeof DICT

export function t(key: TKey, lang: Lang): string {
  return tr(DICT[key], lang)
}
