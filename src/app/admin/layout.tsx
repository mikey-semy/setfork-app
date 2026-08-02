import type { ReactNode } from 'react'
import { getLang } from '@/shared/i18n/server'
import { AdminNavSlot } from '@/features/admin/AdminNav'
import { adminNavGroups, adminSettingsLinksGroup } from '@/features/admin/nav-groups'

/**
 * Меню админки — на всех её страницах, а не только на корневой.
 *
 * До этого навигация была только на /admin: из «Дашборда» в «Теги» приходилось
 * возвращаться в корень и искать пункт глазами. В настройках списка содержание никуда
 * не девается — в админке теперь так же.
 *
 * На самой /admin слот молчит: там меню рисует оболочка, добавляя к ссылкам якоря
 * секций со scrollspy.
 *
 * Группа «Настройки инстанса» здесь тоже есть — ссылками на /admin#<секция>. Без неё
 * состав меню менялся от страницы к странице: на /admin одиннадцать настроек, шаг в
 * «Потоки» — и их нет, будто раздел исчез.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const lang = await getLang()
  return (
    <div className="flex w-full min-w-0 flex-col md:flex-row">
      <AdminNavSlot groups={[...adminNavGroups(lang), adminSettingsLinksGroup(lang)]} lang={lang} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
