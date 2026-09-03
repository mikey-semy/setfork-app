'use client'

import { useState, useTransition } from 'react'
import { CircleCheck, CircleDot } from 'lucide-react'
import { t, type Lang, type TKey } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { Input } from '@/shared/ui/input'
import { setIssueStatus } from './actions'

/** Тот же набор, что в схеме: исход закрытия — перечень, а не свободный текст. */
const REASONS = ['completed', 'not_planned', 'duplicate'] as const

/**
 * ЗАКРЫТЬ С ИСХОДОМ ИЛИ ОТКРЫТЬ ЗАНОВО.
 *
 * Закрытие спрашивает, ЧЕМ кончилось: «сделано» и «не будем делать» выглядят одинаково —
 * перечёркнутым номером, — а значат противоположное. Переоткрытие ничего не спрашивает и
 * потому остаётся кнопкой: выбор из одного пункта был бы лишним нажатием.
 *
 * У дубликата второй шаг — номер оригинала. Причина без ссылки сообщает, что оригинал
 * есть, и не говорит где; у GitHub в `CloseIssueInput` поэтому идут парой `stateReason:
 * DUPLICATE` и `duplicateIssueId`.
 */
export function IssueCloseControl({
  owner,
  slug,
  number,
  closed,
  lang,
}: {
  owner: string
  slug: string
  number: number
  closed: boolean
  lang: Lang
}) {
  const [pending, start] = useTransition()
  const [askDuplicate, setAskDuplicate] = useState(false)
  const [dup, setDup] = useState('')

  const run = (reason?: (typeof REASONS)[number], duplicateOf?: number) =>
    start(() => {
      void setIssueStatus(owner, slug, number, closed ? 'open' : 'closed', reason, duplicateOf)
    })

  if (closed) {
    return (
      <Button type="button" size="md" disabled={pending} onClick={() => run()}>
        <CircleDot size={14} className="text-ok" /> {t('reopenIssue', lang)}
      </Button>
    )
  }

  if (askDuplicate) {
    return (
      // Ряд, а не окно: спрашиваем ОДНО число, и модальное окно ради него было бы
      // тяжелее самого действия. `flex-wrap` — чтобы на 320px поле и кнопки перенеслись.
      //
      // ⚠️ ВЕРТИКАЛЬНЫЙ ЗАЗОР ЗДЕСЬ НЕСУЩИЙ, а не косметика. Перенесённые кнопки встают
      // друг под друга, а зона нажатия у ступени 32px растёт до 44 — то есть на 6px вверх
      // и вниз. При зазоре 8px зоны наложились бы, и палец у границы сделал бы соседнее
      // действие: «закрыть как дубликат» вместо «отмена». 12px по вертикали ровно
      // закрывают разницу (узда tests/architecture/stacked-touch считает так же).
      //
      // Политику ряда при этом не меняем: поле `Input` роста не умеет, и `touch="grow"` у
      // кнопок сделал бы ряд разнополитичным — на сенсоре кнопки стали бы 44, а поле
      // осталось 32 (вторая узда, row-touch, ловит ровно это).
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
        <Input
          type="number"
          min={1}
          value={dup}
          onChange={(e) => setDup(e.target.value)}
          placeholder={t('issue.duplicateOfPh', lang)}
          className="w-field-sm"
          aria-label={t('issue.duplicateOfPh', lang)}
        />
        <Button
          type="button"
          size="md"
          disabled={pending || !Number(dup)}
          onClick={() => run('duplicate', Number(dup))}
        >
          {t('issue.closeAsDuplicate', lang)}
        </Button>
        <Button type="button" variant="ghost" size="md" disabled={pending} onClick={() => setAskDuplicate(false)}>
          {t('cancel', lang)}
        </Button>
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="md" disabled={pending}>
          <CircleCheck size={14} className="text-accent" /> {t('closeIssue', lang)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {REASONS.map((r) => (
          <DropdownMenuItem
            key={r}
            disabled={pending}
            onSelect={(e) => {
              e.preventDefault() // не закрывать меню до старта перехода
              if (r === 'duplicate') setAskDuplicate(true)
              else run(r)
            }}
          >
            {t(`issue.closeReason.${r}` as TKey, lang)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
