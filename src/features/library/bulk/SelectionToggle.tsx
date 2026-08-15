'use client'

import { CheckSquare, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { t, type Lang } from '@/shared/i18n'
import { useSelection } from './selection'

/** Один контрол на вход И выход из режима — он не меняет место и не оставляет
 *  человека среди inert-карточек без очевидного способа вернуться. */
export function SelectionToggle({ lang }: { lang: Lang }) {
  const sel = useSelection()
  if (!sel) return null
  return (
    <Button variant="outline" size="md" onClick={() => (sel.active ? sel.stop() : sel.start())} aria-pressed={sel.active}>
      {sel.active ? <X size={15} /> : <CheckSquare size={15} />}
      {sel.active ? t('cancel', lang) : t('bulk.select', lang)}
    </Button>
  )
}
