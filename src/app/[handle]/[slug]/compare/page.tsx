import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t, tr, type LocaleText } from '@/shared/i18n'
import { ListHeader } from '@/features/library/ListHeader'
import { getListMeta, getVersions, getVersionSteps } from '@/features/library/queries'
import { lineDiff, serializeSteps, type CmpStep } from '@/features/library/diff'

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
  const { rows, added, removed } = lineDiff(
    serializeSteps(toCmp(fromV.steps, lang), meta.ordered),
    serializeSteps(toCmp(toV.steps, lang), meta.ordered),
  )

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
        <div className="mb-3 flex flex-wrap gap-3 text-[12.5px]">
          <span className="text-[var(--ok)]">+{added}</span>
          <span className="text-[var(--danger)]">−{removed}</span>
          <span className="text-muted">
            v{fromN} → v{toN}
          </span>
        </div>

        {added + removed === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-12 text-center text-[13.5px] text-muted">
            {t('diffNothing', lang)}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border font-mono text-[12px] leading-[1.55]">
            {rows.map((r, i) => {
              const bg = r.type === 'add' ? 'bg-[var(--ok)]/10' : r.type === 'del' ? 'bg-[var(--danger)]/10' : ''
              const sign = r.type === 'add' ? '+' : r.type === 'del' ? '−' : ''
              const signColor = r.type === 'add' ? 'text-[var(--ok)]' : r.type === 'del' ? 'text-[var(--danger)]' : 'text-transparent'
              return (
                <div key={i} className={`flex ${bg}`}>
                  <span className="w-10 shrink-0 select-none border-r border-border px-1.5 text-right text-[11px] text-muted">
                    {r.oldNo ?? ''}
                  </span>
                  <span className="w-10 shrink-0 select-none border-r border-border px-1.5 text-right text-[11px] text-muted">
                    {r.newNo ?? ''}
                  </span>
                  <span className={`w-4 shrink-0 select-none text-center ${signColor}`}>{sign}</span>
                  <span className="whitespace-pre-wrap break-words px-2 text-ink">{r.text || ' '}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
