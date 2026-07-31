'use client'

import { useOptimistic, useTransition } from 'react'
import { SplitButton } from '@/shared/ui/SplitButton'
import { splitSegment } from '@/shared/ui/split-segment'
import { StarButton } from '@/features/library/StarButton'
import { toggleStar } from '@/features/library/actions'
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
  // ОДНО оптимистичное состояние на пару «звезда + счётчик», и живёт оно ЗДЕСЬ, потому
  // что счётчик рисует обёртка. Раньше звезда держала своё useOptimistic, а обёртка —
  // отдельный useState: экшен мог завершиться, ничего не поменяв (список скрыт/удалён
  // после рендера), и тогда иконка откатывалась сама, а число оставалось сдвинутым
  // навсегда — до перезагрузки страницы (P2 из авто-ревью).
  //
  // useOptimistic привязан к переходу: как только действие завершилось, значение
  // возвращается к серверному — обе части откатываются вместе.
  const [pending, start] = useTransition()
  const [opt, setOpt] = useOptimistic({ starred, count }, (_s, next: boolean) => ({
    starred: next,
    count: Math.max(0, count + (next ? 1 : -1)),
  }))
  const toggle = () =>
    start(async () => {
      setOpt(!opt.starred)
      await toggleStar(templateId)
    })

  return (
    <SplitButton tone={opt.starred ? 'warn' : 'neutral'}>
      <StarButton starred={opt.starred} pending={pending} label={label} onToggle={toggle} />
      {opt.count > 0 ? <span className={splitSegment({ interactive: false, muted: true })}>{opt.count}</span> : null}
      <StarFolderMenu templateId={templateId} folders={folders} inFolders={inFolders} lang={lang} />
    </SplitButton>
  )
}
