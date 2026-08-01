import { BarChart3, Cpu, Flag, FolderGit2, LayoutDashboard, Megaphone, MessageSquare, Palette, Rss, ScrollText, Shield, Tag, TrendingUp } from 'lucide-react'
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
        { href: '/admin/development', label: tr({ en: 'Development', ru: 'Развитие' }, lang), icon: <TrendingUp size={14} /> },
        { href: '/admin/usage', label: say('Draft usage', 'Расход на черновики'), icon: <BarChart3 size={14} /> },
        // Модели рядом с расходом: это два взгляда на одни деньги — «кто тратит» и «на чём».
        { href: '/admin/models', label: say('Models', 'Модели'), icon: <Cpu size={14} /> },
        { href: '/admin/audit', label: say('Audit', 'Аудит'), icon: <ScrollText size={14} /> },
        { href: '/admin/ui-kit', label: 'UI Kit', icon: <Palette size={14} /> },
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
