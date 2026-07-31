'use client'

import { useState } from 'react'
import { SplitButton, splitSegment } from '@/shared/ui/SplitButton'
import { StarButton } from '@/features/library/StarButton'
import { StarFolderMenu } from '@/features/star-folders/StarFolderMenu'
import type { StarFolder } from '@/features/star-folders/queries'

/**
 * Split-кнопка звезды: [★ Отметить · N | ▾ папки]. Рамку рисует ОБЁРТКА, а не
 * половинки: иначе при отметке подсвечивалась только левая часть, и обводка
 * рвалась на каретке. Состояние живёт здесь, поэтому периметр перекрашивается
 * сразу по клику, не дожидаясь серверного рендера.
 *
 * Живёт в widgets: связывает две РАЗНЫЕ фичи (library + star-folders), а фича
 * фичу импортировать не может (границы слоёв).
 */
export function StarSplit({
  templateId,
  starred,
  count,
  label,
  folders,
  inFolders,
  lang,
}: {
  templateId: string
  starred: boolean
  count: number
  label: string
  folders: StarFolder[]
  inFolders: string[]
  lang: string
}) {
  // Не копия пропа, а ПОПРАВКА к нему: null = «своего мнения нет, слушаем сервер».
  // useState(starred) держал бы устаревшее значение после серверного обновления
  // (react-doctor: no-derived-useState).
  const [optimistic, setOptimistic] = useState<boolean | null>(null)
  const on = optimistic ?? starred
  // Счётчик живёт в обёртке (общая анатомия), поэтому оптимистичный сдвиг считаем здесь:
  // пока сервер не ответил, число должно двигаться вместе со звездой.
  const shown = Math.max(0, count + (optimistic === null || optimistic === starred ? 0 : optimistic ? 1 : -1))
  return (
    <SplitButton tone={on ? 'warn' : 'neutral'}>
      <StarButton templateId={templateId} starred={starred} label={label} onStarredChange={setOptimistic} />
      {shown > 0 ? <span className={splitSegment({ interactive: false, muted: true })}>{shown}</span> : null}
      <StarFolderMenu templateId={templateId} folders={folders} inFolders={inFolders} lang={lang} />
    </SplitButton>
  )
}
