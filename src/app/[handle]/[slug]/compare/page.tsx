import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Code2, List } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t, tr, type Lang, type LocaleText } from '@/shared/i18n'
import { Markdown } from '@/shared/ui/Markdown'
import { StepLevelBadge } from '@/shared/ui/StepLevelBadge'
import { ListHeader } from '@/features/library/ListHeader'
import { VersionPicker } from '@/features/library/VersionPicker'
import { getListMeta, getVersions, getVersionSteps } from '@/features/library/queries'
import { diffSteps, lineDiff, serializeSteps, type CmpStep, type DiffEntry } from '@/features/library/diff'

function toCmp(
  steps: { title: LocaleText; desc: LocaleText; command: string; level: CmpStep['level']; why: LocaleText; subtasks: LocaleText[] }[],
  lang: Lang,
): CmpStep[] {
  return steps.map((s) => ({
    title: tr(s.title, lang),
    desc: tr(s.desc, lang),
    command: s.command,
    level: s.level,
    why: tr(s.why, lang),
    subtasks: (s.subtasks as LocaleText[]).map((x) => tr(x, lang)).filter(Boolean),
  }))
}

const STATUS: Record<DiffEntry['status'], { color: string | null; key: 'diffAdded' | 'diffRemoved' | 'diffChanged' | 'diffMoved' | null }> = {
  added: { color: 'var(--ok)', key: 'diffAdded' },
  removed: { color: 'var(--danger)', key: 'diffRemoved' },
  changed: { color: 'var(--warn)', key: 'diffChanged' },
  moved: { color: 'var(--accent)', key: 'diffMoved' },
  unchanged: { color: null, key: null },
}
const mix = (c: string, pct: number, base = 'transparent') => `color-mix(in srgb, ${c} ${pct}%, ${base})`

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>
  searchParams: Promise<{ from?: string; to?: string; view?: string }>
}) {
  const [{ handle: owner, slug }, sp, lang, viewer] = await Promise.all([params, searchParams, getLang(), getSession()])
  const meta = await getListMeta(owner, slug)
  if (!meta) notFound()
  const isOwner = viewer?.userId === meta.ownerId
  const isAdmin = isAdminHandle(viewer?.handle)
  if (meta.visibility === 'private' && !isOwner) notFound()
  if (meta.status === 'draft' && !isOwner) notFound()
  if (meta.moderation !== 'active' && !isOwner && !isAdmin) notFound()

  const view = sp.view === 'list' ? 'list' : 'code'
  const versions = await getVersions(meta.id)
  const nums = versions.map((v) => v.version).sort((a, b) => a - b)
  const toN = Math.min(Number(sp.to) || meta.currentVersion, meta.currentVersion)
  const fromN = Math.max(Number(sp.from) || Math.max(nums[0], toN - 1), nums[0])

  const [fromV, toV] = await Promise.all([getVersionSteps(meta.id, fromN), getVersionSteps(meta.id, toN)])
  if (!fromV || !toV) notFound()
  const fromSteps = toCmp(fromV.steps, lang)
  const toSteps = toCmp(toV.steps, lang)

  const base = `/${owner}/${slug}/compare`
  const toggle = (key: 'code' | 'list', icon: ReactNode, labelKey: 'viewCode' | 'viewList') => (
    <Link
      href={`${base}?from=${fromN}&to=${toN}&view=${key}`}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium ${
        view === key ? 'bg-primary text-primary-fg' : 'text-ink-2 hover:text-ink'
      }`}
    >
      {icon} {t(labelKey, lang)}
    </Link>
  )

  return (
    <>
      <ListHeader owner={owner} slug={slug} active="versions" />
      <div className="mx-auto w-full max-w-[860px] px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[16px] font-bold text-ink">{t('compareTitle', lang)}</h1>
          <div className="flex items-center gap-1 rounded-md border border-border bg-surface-2 p-0.5">
            {toggle('code', <Code2 size={14} />, 'viewCode')}
            {toggle('list', <List size={14} />, 'viewList')}
          </div>
        </div>

        <div className="mb-4">
          <VersionPicker base={base} versions={nums} from={fromN} to={toN} view={view} fromLabel={`${t('diffFrom', lang)}:`} toLabel={`${t('diffTo', lang)}:`} />
        </div>

        {view === 'code' ? (
          <CodeDiff fromSteps={fromSteps} toSteps={toSteps} ordered={meta.ordered} lang={lang} />
        ) : (
          <ListDiff fromSteps={fromSteps} toSteps={toSteps} lang={lang} />
        )}
      </div>
    </>
  )
}

function CodeDiff({ fromSteps, toSteps, ordered, lang }: { fromSteps: CmpStep[]; toSteps: CmpStep[]; ordered: boolean; lang: Lang }) {
  const { rows, added, removed } = lineDiff(serializeSteps(fromSteps, ordered), serializeSteps(toSteps, ordered))
  if (added + removed === 0)
    return <div className="rounded-lg border border-dashed border-border py-12 text-center text-[13.5px] text-muted">{t('diffNothing', lang)}</div>
  return (
    <>
      <div className="mb-3 flex gap-3 text-[12.5px]">
        <span className="text-ok">+{added}</span>
        <span className="text-danger">−{removed}</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border font-mono text-[12px] leading-[1.55]">
        {rows.map((r, i) => {
          const clr = r.type === 'add' ? 'var(--ok)' : r.type === 'del' ? 'var(--danger)' : ''
          const rowStyle = clr ? { backgroundColor: `color-mix(in srgb, ${clr} 13%, transparent)` } : undefined
          const sign = r.type === 'add' ? '+' : r.type === 'del' ? '−' : ''
          const signColor = r.type === 'add' ? 'text-ok' : r.type === 'del' ? 'text-danger' : 'text-transparent'
          return (
            <div key={i} style={rowStyle} className="flex">
              <span className="w-10 shrink-0 select-none border-r border-border px-1.5 text-right text-[11px] text-muted">
                {r.oldNo ?? ''}
              </span>
              <span className="w-10 shrink-0 select-none border-r border-border px-1.5 text-right text-[11px] text-muted">
                {r.newNo ?? ''}
              </span>
              <span className={`w-4 shrink-0 select-none text-center ${signColor}`}>{sign}</span>
              <span className="whitespace-pre-wrap break-words px-2 text-ink">
                {r.segs
                  ? r.segs.map((seg, k) =>
                      seg.changed ? (
                        <span key={k} className="rounded-sm" style={{ backgroundColor: `color-mix(in srgb, ${clr} 38%, transparent)` }}>
                          {seg.text}
                        </span>
                      ) : (
                        <span key={k}>{seg.text}</span>
                      ),
                    )
                  : r.text || ' '}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}

function ListDiff({ fromSteps, toSteps, lang }: { fromSteps: CmpStep[]; toSteps: CmpStep[]; lang: Lang }) {
  const { entries, summary } = diffSteps(fromSteps, toSteps)
  if (summary.added + summary.removed + summary.changed === 0)
    return <div className="rounded-lg border border-dashed border-border py-12 text-center text-[13.5px] text-muted">{t('diffNothing', lang)}</div>
  return (
    <>
      <div className="mb-3 flex gap-3 text-[12.5px]">
        <span className="text-ok">+{summary.added}</span>
        <span className="text-danger">−{summary.removed}</span>
        <span className="text-warn">~{summary.changed}</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {entries.map((e, i) => {
          const st = STATUS[e.status]
          const cardStyle = st.color
            ? { borderColor: mix(st.color, 55, 'var(--border)'), backgroundColor: mix(st.color, 6) }
            : undefined
          return (
            <div key={i} style={cardStyle} className={`rounded-lg border p-4 ${st.color ? '' : 'border-border opacity-60'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[14.5px] font-semibold text-ink ${e.status === 'removed' ? 'line-through opacity-70' : ''}`}>{e.title}</span>
                <StepLevelBadge level={e.level} lang={lang} />
                {st.key && st.color && (
                  <span
                    className="rounded border px-1.5 py-0.5 text-[10.5px] font-medium"
                    style={{ color: st.color, borderColor: mix(st.color, 55) }}
                  >
                    {t(st.key, lang)}
                  </span>
                )}
              </div>
              {e.status !== 'removed' && e.desc && <Markdown className="mt-1">{e.desc}</Markdown>}
              {e.status === 'removed' && e.desc && <div className="mt-1 text-[13px] text-ink-2 line-through opacity-70">{e.desc}</div>}
              {e.status === 'changed' && e.before && (
                <div className="mt-2 space-y-1 border-l-2 border-warn/40 pl-2.5 text-[12px] text-ink-2">
                  {e.changes.includes('level') && (
                    <div>
                      level: <span className="line-through opacity-70">{e.before.level}</span> → <b>{e.level}</b>
                    </div>
                  )}
                  {e.changes.includes('command') && (
                    <div className="font-mono">
                      {e.before.command && <span className="line-through opacity-70">{e.before.command}</span>}
                      {e.command && <> → {e.command}</>}
                    </div>
                  )}
                  {e.changes.includes('desc') && e.before.desc && (
                    <div>
                      {t('diffWas', lang)}: <span className="line-through opacity-70">{e.before.desc}</span>
                    </div>
                  )}
                  {(e.changes.includes('subtasks') || e.changes.includes('why')) && (
                    <div className="text-muted">{e.changes.filter((c) => c === 'subtasks' || c === 'why').join(', ')} {t('diffChanged', lang).toLowerCase()}</div>
                  )}
                </div>
              )}
              {e.status !== 'removed' && e.command && !e.changes.includes('command') && (
                <code className="mt-2 block rounded bg-surface-2 px-2 py-1 font-mono text-[12px] text-ink">{e.command}</code>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
