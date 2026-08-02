import { BarChart3, Cpu, Flag, FolderGit2, LayoutDashboard, Megaphone, MessageSquare, Palette, Rss, ScrollText, Shield, Tag, TrendingUp } from 'lucide-react'
import { t, tr, type Lang } from '@/shared/i18n'
import type { AdminNavGroup } from './AdminNav'

/**
 * Разделы админки — ОДИН список на всё: и для меню на /admin, и для меню на вложенных
 * страницах (layout). Держать два списка значит однажды добавить пункт в один из них.
 */
export function adminNavGroups(lang: Lang): AdminNavGroup[] {
  return [
    {
      title: t('admin.overview', lang),
      links: [
        { href: '/admin/dashboard', label: t('admin.dashboard', lang), icon: <LayoutDashboard size={14} /> },
        { href: '/admin/development', label: t('admin.development', lang), icon: <TrendingUp size={14} /> },
        { href: '/admin/usage', label: t('admin.draftUsage', lang), icon: <BarChart3 size={14} /> },
        // Модели рядом с расходом: это два взгляда на одни деньги — «кто тратит» и «на чём».
        { href: '/admin/models', label: t('admin.models', lang), icon: <Cpu size={14} /> },
        { href: '/admin/audit', label: t('admin.audit', lang), icon: <ScrollText size={14} /> },
        { href: '/admin/ui-kit', label: 'UI Kit', icon: <Palette size={14} /> },
      ],
    },
    {
      title: t('admin.content', lang),
      links: [
        { href: '/admin/collections', label: t('admin.collections', lang), icon: <FolderGit2 size={14} /> },
        { href: '/admin/feeds', label: t('admin.feeds', lang), icon: <Rss size={14} /> },
        { href: '/admin/tags', label: t('tags', lang), icon: <Tag size={14} /> },
        { href: '/admin/landing', label: t('admin.landing', lang), icon: <Megaphone size={14} /> },
      ],
    },
    {
      title: t('admin.peopleComplaints', lang),
      links: [
        { href: '/admin/moderation', label: t('admin.moderation', lang), icon: <Shield size={14} /> },
        { href: '/admin/reports', label: t('reports', lang), icon: <Flag size={14} /> },
        { href: '/admin/feedback', label: t('feedback', lang), icon: <MessageSquare size={14} /> },
      ],
    },
  ]
}

/** Пункт «настройки инстанса» — якоря секций самой /admin, их знает только та страница. */
export function adminSettingsGroup(lang: Lang, sectionIds: string[]): AdminNavGroup {
  return { title: t('admin.instanceSettings', lang), sectionIds }
}
