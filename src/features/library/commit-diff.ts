'use server'

import { type Lang } from '@/shared/i18n'
import { requireViewableMeta } from './guard'
import { getVersionSteps } from './queries'
import { blockLabel, diffSteps, isStepBlock, rowsToCmp, type CmpStep, type DiffStatus } from './diff'

export interface CommitDiffEntry {
  status: Exclude<DiffStatus, 'unchanged'>
  title: string
  level: CmpStep['level']
  /** Презентационный блок (текст/картинка/опрос/видео) — у него нет уровня. */
  block?: boolean
}
export interface CommitDiff {
  entries: CommitDiffEntry[]
  counts: { added: number; removed: number; changed: number; moved: number }
}

/**
 * Изменения ОДНОГО коммита (версии) против предыдущей — для аккордеона на странице
 * «Коммиты». Первая версия (нет предыдущей) → всё как «добавлено». Возвращает
 * компактные записи (статус + заголовок пункта) + счётчики. Гейт видимости — как у
 * страницы (requireViewableMeta).
 */
export async function getCommitDiff(owner: string, slug: string, version: number, lang: Lang): Promise<CommitDiff | null> {
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) return null

  const [fromV, toV] = await Promise.all([
    version > 1 ? getVersionSteps(meta.id, version - 1) : Promise.resolve(null),
    getVersionSteps(meta.id, version),
  ])
  if (!toV) return null

  const { entries } = diffSteps(rowsToCmp(fromV?.steps ?? [], lang), rowsToCmp(toV.steps, lang))
  const counts = { added: 0, removed: 0, changed: 0, moved: 0 }
  const out: CommitDiffEntry[] = []
  for (const e of entries) {
    if (e.status === 'unchanged') continue
    counts[e.status]++
    out.push({ status: e.status, title: blockLabel(e), level: e.level, block: !isStepBlock(e) })
  }
  return { entries: out, counts }
}
