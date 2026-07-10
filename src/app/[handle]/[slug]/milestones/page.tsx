import { notFound } from 'next/navigation'
import { Calendar, CircleCheck, CircleDot, Milestone as MilestoneIcon, Trash2 } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Markdown } from '@/shared/ui/Markdown'
import { requireViewableMeta } from '@/features/library/guard'
import { ListHeader } from '@/widgets/ListHeader'
import { isCollaborator } from '@/features/collab/queries'
import { getMilestones } from '@/features/milestones/queries'
import { MilestoneForm } from '@/features/milestones/MilestoneForm'
import { deleteMilestone, toggleMilestoneClosed } from '@/features/milestones/actions'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  return { title: `Milestones · ${handle}/${slug}` }
}

export default async function MilestonesPage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle: owner, slug }, lang, session] = await Promise.all([params, getLang(), getSession()])
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  const canManage = session ? session.userId === meta.ownerId || (await isCollaborator(meta.id, session.userId)) : false
  const list = await getMilestones(meta.id)
  const fmt = new Intl.DateTimeFormat(lang === 'ru' ? 'ru' : 'en', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <>
      <ListHeader owner={owner} slug={slug} active="issues" />
      <div className="mx-auto w-full max-w-[900px] px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-[17px] font-bold text-ink">
            <MilestoneIcon size={18} className="text-accent" /> {t('milestonesTitle', lang)}
          </h1>
          {canManage && <MilestoneForm owner={owner} slug={slug} lang={lang} />}
        </div>

        {list.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center text-[13.5px] text-muted">{t('noMilestones', lang)}</div>
        ) : (
          <div className="flex flex-col gap-3">
            {list.map((m) => {
              const total = m.openCount + m.closedCount
              const pct = total ? Math.round((m.closedCount / total) * 100) : 0
              return (
                <div key={m.id} className="rounded-lg border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold text-white ${m.closed ? 'bg-accent' : 'bg-ok'}`}>
                          {m.closed ? <CircleCheck size={12} /> : <CircleDot size={12} />}
                          {m.closed ? t('closedLabel', lang) : t('openLabel', lang)}
                        </span>
                        <span className="text-[15px] font-semibold text-ink">{m.title}</span>
                      </div>
                      {m.dueOn && (
                        <div className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-muted">
                          <Calendar size={12} /> {t('milestoneDue', lang)} {fmt.format(new Date(m.dueOn))}
                        </div>
                      )}
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 gap-1.5">
                        <form action={toggleMilestoneClosed.bind(null, owner, slug, m.id)}>
                          <button className="rounded-md border border-border px-2.5 py-1 text-[12px] font-semibold text-ink hover:border-border-strong">
                            {m.closed ? t('reopen', lang) : t('close', lang)}
                          </button>
                        </form>
                        <form action={deleteMilestone.bind(null, owner, slug, m.id)}>
                          <button aria-label={t('delete', lang)} className="rounded-md border border-border px-2 py-1 text-muted hover:border-danger hover:text-danger">
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
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-muted">
                      <span className="font-semibold text-ink-2">{pct}%</span>
                      <span className="inline-flex items-center gap-1">
                        <CircleDot size={12} /> {m.openCount} {t('openLabel', lang).toLowerCase()}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <CircleCheck size={12} /> {m.closedCount} {t('closedLabel', lang).toLowerCase()}
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
