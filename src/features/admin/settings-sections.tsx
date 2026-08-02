import type { ReactNode } from 'react'
import { Award, Bell, Bot, Coins, Database, Mail, RefreshCw, ScrollText, Search, Users, Wrench } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'

/**
 * СЕКЦИИ НАСТРОЕК ИНСТАНСА — один список на всё, как и разделы админки (nav-groups).
 *
 * Сами настройки живут секциями на /admin и адресуются якорями (#ai, #email…). Раньше
 * список этих якорей знала только сама страница, поэтому группа «Настройки инстанса»
 * была в меню лишь на /admin: стоило перейти в «Потоки» — и половина меню исчезала,
 * а вернуться к настройкам можно было только через корень админки. Меню, которое
 * меняет состав от страницы к странице, читается как пропавший раздел.
 *
 * Теперь подписи, иконки и порядок секций описаны здесь: страница добирает к ним
 * содержимое, layout — рисует те же пункты ссылками на /admin#<id>.
 */
/** Идентификаторы секций = якоря на /admin. Типом, а не строкой: страница обязана
 *  дать содержимое каждой — иначе пункт меню вёл бы в пустое место. */
export const ADMIN_SECTION_IDS = [
  'maintenance',
  'online',
  'ai',
  'media',
  'email',
  'push',
  'search',
  'changelog',
  'monetization',
  'achievements',
  'reindex',
] as const

export type AdminSectionId = (typeof ADMIN_SECTION_IDS)[number]

export interface AdminSectionMeta {
  id: AdminSectionId
  title: string
  icon: ReactNode
  /** Синонимы для поиска по меню («smtp» находит «Почта»). */
  keywords: string[]
}

export function adminSettingsSections(lang: Lang): AdminSectionMeta[] {
  return [
    {
      id: 'maintenance',
      title: t('adminMaintenance', lang),
      icon: <Wrench size={14} />,
      keywords: ['maintenance', 'ремонт', 'обслуживание', '503'],
    },
    {
      id: 'online',
      title: t('admin.sect.online', lang),
      icon: <Users size={14} />,
      keywords: ['online', 'онлайн', 'presence'],
    },
    {
      id: 'ai',
      title: t('admin.sect.ai', lang),
      icon: <Bot size={14} />,
      keywords: ['ai', 'openrouter', 'model', 'модель', 'генерация', 'температура', 'токены'],
    },
    {
      id: 'media',
      title: t('admin.sect.media', lang),
      icon: <Database size={14} />,
      keywords: ['s3', 'imgproxy', 'cdn', 'хранилище', 'картинки', 'storage'],
    },
    {
      id: 'email',
      title: t('admin.sect.email', lang),
      icon: <Mail size={14} />,
      keywords: ['smtp', 'email', 'почта', 'mail'],
    },
    {
      id: 'push',
      title: t('admin.sect.push', lang),
      icon: <Bell size={14} />,
      keywords: ['push', 'vapid', 'web push', 'уведомления'],
    },
    {
      id: 'search',
      title: t('admin.sect.search', lang),
      icon: <Search size={14} />,
      keywords: ['search', 'поиск', 'semantic', 'вектор', 'rag'],
    },
    {
      id: 'changelog',
      // Название продукта, не переводится — как «UI Kit» в разделах админки.
      title: 'Changelog',
      icon: <ScrollText size={14} />,
      keywords: ['changelog', 'релизы', 'github', 'история', 'обновления'],
    },
    {
      id: 'monetization',
      title: t('adminMonetization', lang),
      icon: <Coins size={14} />,
      keywords: ['monetization', 'монетизация', 'affiliate', 'партнёрка', 'donate', 'донат', 'клики', 'просмотры', 'ftc'],
    },
    {
      id: 'achievements',
      title: t('admin.sect.achievements', lang),
      icon: <Award size={14} />,
      keywords: ['achievements', 'достижения', 'бейджи', 'badges'],
    },
    {
      id: 'reindex',
      title: t('adminReindexTitle', lang),
      icon: <RefreshCw size={14} />,
      keywords: ['reindex', 'индексация', 'embeddings', 'эмбеддинги'],
    },
  ]
}
