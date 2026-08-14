'use client'

import { CheckSquare } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { t, type Lang } from '@/shared/i18n'
import { BulkBar } from './BulkBar'
import { SelectionProvider, useSelection } from './selection'

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
  children,
}: {
  lang: Lang
  catalogs: { name: string; title: string }[]
  /** Идентификаторы ВСЕЙ текущей выдачи (не только страницы) — для «выбрать все». */
  allIds: string[]
  children: React.ReactNode
}) {
  return (
    <SelectionProvider>
      <SelectionToggle lang={lang} />
      {children}
      <BulkBar lang={lang} catalogs={catalogs} allIds={allIds} />
    </SelectionProvider>
  )
}

/** Вход в режим. Пока он выключен, на странице от всей этой механики — одна кнопка. */
function SelectionToggle({ lang }: { lang: Lang }) {
  const sel = useSelection()
  if (!sel || sel.active) return null
  return (
    <div className="mb-2 flex justify-end">
      <Button variant="ghost" size="sm" onClick={() => sel.start()}>
        <CheckSquare size={15} />
        {t('bulk.select', lang)}
      </Button>
    </div>
  )
}
