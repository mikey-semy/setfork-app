import { notFound } from 'next/navigation'
import { Calendar, CircleCheck, CircleDot, Milestone as MilestoneIcon, Trash2 } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { plural, t } from '@/shared/i18n'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Markdown } from '@/shared/ui/Markdown'
import { PageHeader } from '@/shared/ui/PageHeader'
import { requireViewableMeta } from '@/features/library/guard'
import { isCollaborator } from '@/features/collab/queries'
import { getMilestones } from '@/features/milestones/queries'
import { MilestoneForm } from '@/features/milestones/MilestoneForm'
import { deleteMilestone, toggleMilestoneClosed } from '@/features/milestones/actions'
import { PAGE } from '@/shared/ui/control'
import { cardClass } from '@/shared/ui/card-style'
import { buttonClass } from '@/shared/ui/button-style'
import { Badge } from '@/shared/ui/badge'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle, slug }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('milestonesTitle', lang)} · ${handle}/${slug}` }
}

export default async function MilestonesPage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle: owner, slug }, lang, session] = await Promise.all([params, getLang(), getSession()])
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  const canManage = session ? session.userId === meta.ownerId || (await isCollaborator(meta.id, session.userId)) : false
  const list = await getMilestones(meta.id)
  const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <>
      <div className={PAGE}>
        <PageHeader
          icon={<MilestoneIcon size={18} />}
          title={t('milestonesTitle', lang)}
          actions={canManage && <MilestoneForm owner={owner} slug={slug} lang={lang} />}
        />

        {list.length === 0 ? (
          <EmptyState hint={t('noMilestones', lang)} />
        ) : (
          <div className="flex flex-col gap-3">
            {list.map((m) => {
              const total = m.openCount + m.closedCount
              const pct = total ? Math.round((m.closedCount / total) * 100) : 0
              return (
                <div key={m.id} className={cardClass()}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={m.closed ? 'accentSolid' : 'okSolid'} className="px-2.5">
                          {m.closed ? <CircleCheck size={12} /> : <CircleDot size={12} />}
                          {m.closed ? t('closedLabel', lang) : t('openLabel', lang)}
                        </Badge>
                        <span className="min-w-0 text-title font-semibold text-ink [overflow-wrap:anywhere]">{m.title}</span>
                      </div>
                      {m.dueOn && (
                        <div className="mt-0.5 inline-flex items-center gap-1 text-body-sm text-muted">
                          <Calendar size={12} /> {t('milestoneDue', lang)} {fmt.format(new Date(m.dueOn))}
                        </div>
                      )}
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 gap-1.5">
                        <form action={toggleMilestoneClosed.bind(null, owner, slug, m.id)}>
                          <button type="submit" className={buttonClass()}>
                            {m.closed ? t('reopen', lang) : t('close', lang)}
                          </button>
                        </form>
                        <form action={deleteMilestone.bind(null, owner, slug, m.id)}>
                          <button type="submit" aria-label={t('delete', lang)} className={buttonClass({ variant: 'danger', className: 'hover:border-danger hover:text-danger' })}>
                            <Trash2 size={14} />
                          </button>
                        </form>
                      </div>
                    )}
                  </div>

                  <div className="mt-3">
                    <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-ok transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-body-sm text-muted">
                      <span className="font-semibold text-ink-2">{pct}%</span>
                      <span className="inline-flex items-center gap-1">
                        <CircleDot size={12} /> {m.openCount} {plural(m.openCount, 'openIssues', lang)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <CircleCheck size={12} /> {m.closedCount} {plural(m.closedCount, 'closedIssues', lang)}
                      </span>
                    </div>
                  </div>

                  {m.desc && <div className="mt-2.5 border-t border-border pt-2.5"><Markdown>{m.desc}</Markdown></div>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
