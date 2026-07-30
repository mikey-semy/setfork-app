'use client'

import { useState } from 'react'
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
  return (
    <span
      className={`inline-flex h-9 items-stretch overflow-hidden rounded-md border transition-colors ${
        on ? 'border-warn' : 'border-border hover:border-border-strong'
      }`}
    >
      <StarButton
        templateId={templateId}
        starred={starred}
        count={count}
        label={label}
        grouped
        bare
        onStarredChange={setOptimistic}
      />
      {/* Разделитель половинок — своей линией, чтобы внешняя рамка осталась цельной. */}
      <span className={`w-px shrink-0 ${on ? 'bg-warn/40' : 'bg-border'}`} />
      <StarFolderMenu templateId={templateId} folders={folders} inFolders={inFolders} lang={lang} bare />
    </span>
  )
}
