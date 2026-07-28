// ИСТОРИЧЕСКИЕ записи changelog — то, что было набрано руками до того, как
// changelog переехал в БД и стал пополняться из GitHub.
//
// Оставлены как СИД: пока таблица пуста, витрина показывает их, и включение
// подсистемы не выглядит потерей всей истории. Новые записи сюда не дописывают —
// их приносит джоба (или админ добавляет в БД).

export interface ChangelogEntry {
  date: string // ISO YYYY-MM-DD
  en: string
  ru: string
  href?: string // куда ведёт запись (фича/док)
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-07-05',
    en: 'Branches for lists: create drafts, view any branch, delete safely — main stays canonical',
    ru: 'Ветки у списков: черновики, просмотр любой ветки, безопасное удаление — main остаётся каноном',
  },
  {
    date: '2026-07-04',
    en: 'Activity graph: month navigation and pinned weekday labels',
    ru: 'График активности: навигация по месяцам и закреплённые дни недели',
  },
  {
    date: '2026-07-03',
    en: 'In-list search (?find=) and mobile search overlay',
    ru: 'Поиск внутри списка (?find=) и мобильный поиск-оверлей',
  },
  {
    date: '2026-07-02',
    en: 'Star folders: organize starred lists like GitHub Lists',
    ru: 'Папки звёзд: организуй starred-списки как GitHub Lists',
  },
  {
    date: '2026-06-30',
    en: 'Explore got GitHub-style tabs: Topics, Trending, Collections',
    ru: 'Explore перешёл на табы как у GitHub: Topics, Trending, Collections',
  },
  {
    date: '2026-06-28',
    en: 'Full git support: clone, pull and push your lists as repos',
    ru: 'Полная поддержка git: clone, pull и push списков как репозиториев',
  },
  {
    date: '2026-06-25',
    en: 'MCP integration: run lists from Claude and IDEs',
    ru: 'Интеграция MCP: прогоняй списки из Claude и IDE',
  },
]
