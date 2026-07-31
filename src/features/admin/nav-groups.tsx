import { BarChart3, Flag, FolderGit2, LayoutDashboard, Megaphone, MessageSquare, Palette, Rss, ScrollText, Shield, SlidersHorizontal, Tag, TrendingUp, Users } from 'lucide-react'
import { t, tr, type Lang } from '@/shared/i18n'
import type { AdminNavGroup } from './AdminNav'

/**
 * Разделы админки — ОДИН список на всё: и для меню на /admin, и для меню на вложенных
 * страницах (layout). Держать два списка значит однажды добавить пункт в один из них.
 */
export function adminNavGroups(lang: Lang): AdminNavGroup[] {
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  return [
    {
      title: say('Overview', 'Обзор'),
      links: [
        { href: '/admin/dashboard', label: tr({ en: 'Dashboard', ru: 'Дашборд' }, lang), icon: <LayoutDashboard size={14} /> },
        { href: '/admin/usage', label: say('Draft usage', 'Расход на черновики'), icon: <BarChart3 size={14} /> },
        { href: '/admin/audit', label: say('Audit', 'Аудит'), icon: <ScrollText size={14} /> },
        { href: '/admin/ui-kit', label: 'UI Kit', icon: <Palette size={14} /> },
      ],
    },
    // КОМПАНИЯ — свой раздел, а не пункт среди админских настроек: у неё свой штат, свои
    // петли и свои рубильники, и настраивают её отдельно от инстанса (решение владельца
    // 2026-07-31). Раньше «Развитие» лежало в «Обзоре», состав — вообще без пункта в меню,
    // а рубильники автономии прятались внутри секции «Генерация и модели».
    {
      title: say('Company', 'Компания'),
      links: [
        { href: '/admin/company', label: say('Overview', 'Обзор'), icon: <TrendingUp size={14} /> },
        // «Зал совета», а не «Состав»: тем же именем страница подписана в шапке (TopNav →
        // councilHall). Два имени у одного экрана — это уже вопрос «а это то же самое?».
        { href: '/admin/company/staff', label: t('councilHall', lang), icon: <Users size={14} /> },
        { href: '/admin/company/settings', label: say('Company settings', 'Настройки компании'), icon: <SlidersHorizontal size={14} /> },
      ],
    },
    {
      title: say('Content', 'Контент'),
      links: [
        { href: '/admin/collections', label: say('Collections', 'Подборки'), icon: <FolderGit2 size={14} /> },
        { href: '/admin/feeds', label: say('Feeds', 'Потоки'), icon: <Rss size={14} /> },
        { href: '/admin/tags', label: t('tags', lang), icon: <Tag size={14} /> },
        { href: '/admin/landing', label: say('Landing', 'Лендинг'), icon: <Megaphone size={14} /> },
      ],
    },
    {
      title: say('People & complaints', 'Люди и жалобы'),
      links: [
        { href: '/admin/moderation', label: say('Moderation', 'Модерация'), icon: <Shield size={14} /> },
        { href: '/admin/reports', label: t('reports', lang), icon: <Flag size={14} /> },
        { href: '/admin/feedback', label: t('feedback', lang), icon: <MessageSquare size={14} /> },
      ],
    },
  ]
}

/** Пункт «настройки инстанса» — якоря секций самой /admin, их знает только та страница. */
export function adminSettingsGroup(lang: Lang, sectionIds: string[]): AdminNavGroup {
  return { title: tr({ en: 'Instance settings', ru: 'Настройки инстанса' }, lang), sectionIds }
}
