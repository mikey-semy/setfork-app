import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t, tr, type LocaleText } from '@/shared/i18n'
import { Markdown } from '@/shared/ui/Markdown'
import { StepLevelBadge } from '@/shared/ui/StepLevelBadge'
import { ListHeader } from '@/features/library/ListHeader'
import { getListMeta, getVersions, getVersionSteps } from '@/features/library/queries'
import { diffSteps, type CmpStep, type DiffEntry } from '@/features/library/diff'

const STATUS: Record<DiffEntry['status'], { border: string; badge: string; key: 'diffAdded' | 'diffRemoved' | 'diffChanged' | 'diffMoved' | null }> = {
  added: { border: 'border-[var(--ok)]/50 bg-[var(--ok)]/5', badge: 'text-[var(--ok)] border-[var(--ok)]/50', key: 'diffAdded' },
  removed: { border: 'border-[var(--danger)]/50 bg-[var(--danger)]/5', badge: 'text-[var(--danger)] border-[var(--danger)]/50', key: 'diffRemoved' },
  changed: { border: 'border-[var(--warn)]/50 bg-[var(--warn)]/5', badge: 'text-[var(--warn)] border-[var(--warn)]/50', key: 'diffChanged' },
  moved: { border: 'border-[var(--accent)]/50', badge: 'text-accent border-[var(--accent)]/50', key: 'diffMoved' },
  unchanged: { border: 'border-border opacity-60', badge: '', key: null },
}

function toCmp(steps: { title: LocaleText; desc: LocaleText; command: string; level: CmpStep['level']; why: LocaleText; subtasks: LocaleText[] }[], lang: 'en' | 'ru'): CmpStep[] {
  return steps.map((s) => ({
    title: tr(s.title, lang),
    desc: tr(s.desc, lang),
    command: s.command,
    level: s.level,
    why: tr(s.why, lang),
    subtasks: (s.subtasks as LocaleText[]).map((x) => tr(x, lang)).filter(Boolean),
  }))
}

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const [{ handle: owner, slug }, sp, lang, viewer] = await Promise.all([params, searchParams, getLang(), getSession()])
  const meta = await getListMeta(owner, slug)
  if (!meta) notFound()
  const isOwner = viewer?.userId === meta.ownerId
  const isAdmin = isAdminHandle(viewer?.handle)
  if (meta.visibility === 'private' && !isOwner) notFound()
  if (meta.status === 'draft' && !isOwner) notFound()
  if (meta.moderation !== 'active' && !isOwner && !isAdmin) notFound()

  const versions = await getVersions(meta.id) // desc
  const nums = versions.map((v) => v.version).sort((a, b) => a - b)
  const toN = Math.min(Number(sp.to) || meta.currentVersion, meta.currentVersion)
  const fromN = Math.max(Number(sp.from) || Math.max(nums[0], toN - 1), nums[0])

  const [fromV, toV] = await Promise.all([getVersionSteps(meta.id, fromN), getVersionSteps(meta.id, toN)])
  if (!fromV || !toV) notFound()
  const { entries, summary } = diffSteps(toCmp(fromV.steps, lang), toCmp(toV.steps, lang))

  const base = `/${owner}/${slug}/compare`
  const chip = (v: number, param: 'from' | 'to', activeN: number, other: number) => (
    <Link
      key={`${param}-${v}`}
      href={`${base}?from=${param === 'from' ? v : other}&to=${param === 'to' ? v : other}`}
      className={`rounded px-2 py-0.5 font-mono text-[12px] ${v === activeN ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-ink-2 hover:text-ink'}`}
    >
      v{v}
    </Link>
  )

  return (
    <>
      <ListHeader owner={owner} slug={slug} active="versions" />
      <div className="mx-auto w-full max-w-[820px] px-4 py-6">
        <h1 className="mb-3 text-[16px] font-bold text-ink">{t('compareTitle', lang)}</h1>

        {/* Выбор пары версий */}
        <div className="mb-4 flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] text-muted">{t('diffFrom', lang)}:</span>
            {nums.map((v) => chip(v, 'from', fromN, toN))}
          </div>
          <ArrowRight size={14} className="hidden text-muted sm:block" />
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] text-muted">{t('diffTo', lang)}:</span>
            {nums.map((v) => chip(v, 'to', toN, fromN))}
          </div>
        </div>

        {/* Сводка */}
        <div className="mb-4 flex flex-wrap gap-3 text-[12.5px]">
          <span className="text-[var(--ok)]">+{summary.added}</span>
          <span className="text-[var(--danger)]">−{summary.removed}</span>
          <span className="text-[var(--warn)]">~{summary.changed}</span>
          <span className="text-muted">{t('diffSummary', lang)}</span>
        </div>

        {summary.added + summary.removed + summary.changed === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-12 text-center text-[13.5px] text-muted">
            {t('diffNothing', lang)}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {entries.map((e, i) => {
              const st = STATUS[e.status]
              return (
                <div key={i} className={`rounded-lg border p-4 ${st.border}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[14.5px] font-semibold text-ink ${e.status === 'removed' ? 'line-through opacity-70' : ''}`}>
                      {e.title}
                    </span>
                    <StepLevelBadge level={e.level} lang={lang} />
                    {st.key && (
                      <span className={`rounded border px-1.5 py-0.5 text-[10.5px] font-medium ${st.badge}`}>{t(st.key, lang)}</span>
                    )}
                  </div>

                  {e.status !== 'removed' && e.desc && <Markdown className="mt-1">{e.desc}</Markdown>}
                  {e.status === 'removed' && e.desc && (
                    <div className="mt-1 text-[13px] text-ink-2 line-through opacity-70">{e.desc}</div>
                  )}

                  {/* Что изменилось */}
                  {e.status === 'changed' && e.before && (
                    <div className="mt-2 space-y-1 border-l-2 border-[var(--warn)]/40 pl-2.5 text-[12px] text-ink-2">
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
                        <div className="text-muted">
                          {e.changes.filter((c) => c === 'subtasks' || c === 'why').join(', ')} {t('diffChanged', lang).toLowerCase()}
                        </div>
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
        )}
      </div>
    </>
  )
}
