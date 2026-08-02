import type { ReactNode } from 'react'
import { getLang } from '@/shared/i18n/server'
import { AdminNavSlot } from '@/features/admin/AdminNav'
import { adminNavGroups } from '@/features/admin/nav-groups'
import { PAGE } from '@/shared/ui/control'

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
 * Рамка (PAGE) — здесь, одна на меню и контент: страницы админки своей ширины не
 * задают. Иначе получалось четыре ширины на одну админку (960/860/720/во весь
 * экран) и контент прыгал при каждом переходе.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const lang = await getLang()
  return (
    <div className={`${PAGE} flex min-w-0 flex-col md:flex-row md:gap-8`}>
      <AdminNavSlot groups={adminNavGroups(lang)} lang={lang} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
