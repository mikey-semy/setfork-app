'use client'

import { useTransition } from 'react'
import { Lock, LockOpen } from 'lucide-react'
import { t, type Lang, type TKey } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { setIssueLocked } from './actions'

/** Тот же перечень, что в схеме: причина переводится и потому живёт ключами словаря. */
const REASONS = ['off_topic', 'too_heated', 'resolved', 'spam'] as const

/**
 * ЗАПЕРЕТЬ ИЛИ ОТПЕРЕТЬ ОБСУЖДЕНИЕ — владельцу списка и коллаборантам.
 *
 * Запирание спрашивает ПРИЧИНУ и потому идёт меню, а отпирание — одно действие и потому
 * кнопка: выбор из одного пункта был бы лишним нажатием.
 */
export function IssueLockControl({
  owner,
  slug,
  number,
  locked,
  lang,
}: {
  owner: string
  slug: string
  number: number
  locked: boolean
  lang: Lang
}) {
  const [pending, start] = useTransition()
  const run = (reason?: (typeof REASONS)[number]) =>
    start(() => {
      void setIssueLocked(owner, slug, number, !locked, reason)
    })

  if (locked) {
    return (
      <Button type="button" size="md" disabled={pending} onClick={() => run()}>
        <LockOpen size={14} /> {t('issue.unlockTitle', lang)}
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="md" disabled={pending}>
          <Lock size={14} /> {t('issue.lockTitle', lang)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {REASONS.map((r) => (
          <DropdownMenuItem
            key={r}
            disabled={pending}
            onSelect={(e) => {
              e.preventDefault() // не закрывать меню до старта перехода
              run(r)
            }}
          >
            {t(`issue.lockReason.${r}` as TKey, lang)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
