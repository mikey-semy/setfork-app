'use client'

import type { Lang } from '@/shared/i18n'
import { BulkBar } from './BulkBar'
import { SelectionProvider } from './selection'

/**
 * Режим выбора вокруг ленты списков: кнопка «Выбрать» сверху, полоса действий снизу.
 *
 * Лента внутри приходит с сервера как есть (`children`) — клиентским здесь становится
 * только выбор. Так карточка остаётся серверной со всей её начинкой, а мы не тащим в
 * браузер ни запросы звёзд, ни разметку.
 */
export function BulkSelection({
  lang,
  catalogs,
  allIds,
  toolbar,
  children,
}: {
  lang: Lang
  catalogs: { name: string; title: string }[]
  /** Идентификаторы ВСЕЙ текущей выдачи (не только страницы) — для «выбрать все». */
  allIds: string[]
  /** Тулбар должен быть внутри провайдера: тогда Select остаётся на своём месте
   *  и в активном режиме превращается в Cancel, а не исчезает. */
  toolbar?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <SelectionProvider>
      {toolbar}
      {children}
      <BulkBar lang={lang} catalogs={catalogs} allIds={allIds} />
    </SelectionProvider>
  )
}
