import 'server-only'
import { t, type Lang } from '@/shared/i18n'
// library — контент-фича (версии/шаги/дифф), от которой заметки релиза зависят по сути;
// тот же кросс-фич-паттерн, что у gardener/generation (в baseline-suppressions).
// eslint-disable-next-line boundaries/dependencies -- версии/шаги списка из library
import { getVersions, getVersionSteps } from '@/features/library/queries'
import { getReleases } from '@/features/releases/queries'
// eslint-disable-next-line boundaries/dependencies -- дифф шагов версий из library
import { blockLabel, diffSteps, rowsToCmp, type DiffStatus } from '@/features/library/diff'

// Секции чейнджлога по статусу диффа (порядок фиксирован). Ярлыки — те же ключи,
// что на сравнении версий (diffAdded/…), чтобы не плодить перевод.
const SECTIONS: { status: DiffStatus; key: 'diffAdded' | 'diffChanged' | 'diffRemoved' | 'diffMoved' }[] = [
  { status: 'added', key: 'diffAdded' },
  { status: 'changed', key: 'diffChanged' },
  { status: 'removed', key: 'diffRemoved' },
  { status: 'moved', key: 'diffMoved' },
]

/**
 * Автоген заметок релиза: дифф выбранной версии против ПРЕДЫДУЩЕГО релиза (а если
 * релизов ещё не было — против ближайшей нижней версии). Возвращает markdown со
 * секциями Добавлено/Изменено/Удалено/Переставлено, пункты = заголовки шагов.
 * Пусто, если сравнивать не с чем или изменений нет.
 */
export async function buildReleaseChangelog(templateId: string, toVersion: number, lang: Lang): Promise<string> {
  const [rels, versions] = await Promise.all([getReleases(templateId), getVersions(templateId)])
  const belowNums = versions.map((v) => v.version).filter((n) => n < toVersion).sort((a, b) => a - b)
  const prevRel = rels.filter((r) => r.version < toVersion).sort((a, b) => b.version - a.version)[0]
  const fromN = prevRel?.version ?? (belowNums.length ? belowNums[belowNums.length - 1] : null)
  if (fromN == null) return '' // первая версия — сравнивать не с чем

  const [fromV, toV] = await Promise.all([getVersionSteps(templateId, fromN), getVersionSteps(templateId, toVersion)])
  if (!fromV || !toV) return ''
  const { entries } = diffSteps(rowsToCmp(fromV.steps, lang), rowsToCmp(toV.steps, lang))

  const out: string[] = []
  for (const { status, key } of SECTIONS) {
    const items = entries.filter((e) => e.status === status)
    if (!items.length) continue
    out.push(`### ${t(key, lang)}`)
    for (const e of items) out.push(`- ${blockLabel(e)}`)
    out.push('')
  }
  return out.join('\n').trim()
}
