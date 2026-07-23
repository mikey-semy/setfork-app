import 'server-only'
import { t, tr, type Lang, type LocaleText } from '@/shared/i18n'
import { getVersions, getVersionSteps } from '@/features/library/queries'
import { getReleases } from '@/features/releases/queries'
import { diffSteps, type CmpStep, type DiffStatus } from '@/features/library/diff'

// Пункты версии (LocaleText-поля) → CmpStep (строки на языке зрителя). Та же
// конверсия, что на странице сравнения — чтобы дифф считался одинаково.
function stepsToCmp(
  steps: {
    title: LocaleText
    desc: LocaleText
    command: string
    level: CmpStep['level']
    why: LocaleText
    section?: LocaleText
    subtasks: LocaleText[]
    refs?: { label: LocaleText; url?: string }[]
  }[],
  lang: Lang,
): CmpStep[] {
  return steps.map((s) => ({
    title: tr(s.title, lang),
    desc: tr(s.desc, lang),
    command: s.command,
    level: s.level,
    why: tr(s.why, lang),
    section: s.section ? tr(s.section, lang) : '',
    subtasks: (s.subtasks as LocaleText[]).map((x) => tr(x, lang)).filter(Boolean),
    refs: (s.refs ?? []).map((r) => ({ label: tr(r.label, lang), url: r.url ?? '' })).filter((r) => r.label || r.url),
  }))
}

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
  const { entries } = diffSteps(stepsToCmp(fromV.steps, lang), stepsToCmp(toV.steps, lang))

  const out: string[] = []
  for (const { status, key } of SECTIONS) {
    const items = entries.filter((e) => e.status === status)
    if (!items.length) continue
    out.push(`### ${t(key, lang)}`)
    for (const e of items) out.push(`- ${e.title}`)
    out.push('')
  }
  return out.join('\n').trim()
}
