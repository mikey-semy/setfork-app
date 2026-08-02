import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CircleDot, GitPullRequest, Sparkles, Star } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { PageHeader } from '@/shared/ui/PageHeader'
import { getImprovementFeed } from '@/features/improve/queries'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PAGE_NARROW } from '@/shared/ui/control'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('improveTitle', lang) }
}

export default async function ImprovePage() {
  const [lang, session] = await Promise.all([getLang(), getSession()])
  if (!session) redirect('/login?next=/improve')
  const ru = lang === 'ru'
  const items = await getImprovementFeed(session.userId)

  return (
    <div className={PAGE_NARROW}>
      <PageHeader
        icon={<Sparkles size={18} />}
        title={ru ? 'Что улучшить' : 'What to improve'}
        subtitle={
          ru
            ? 'Списки, которыми вы пользуетесь и которым нужна доводка — открытые вопросы и предложенные правки. Помогите довести их до безупречности.'
            : 'Lists you use that need polish — open issues and pending edits. Help bring them to perfection.'
        }
      />

      {items.length === 0 ? (
        <EmptyState
          hint={
            ru
              ? 'Пока нечего улучшать — отмечайте звёздами и прогоняйте списки, и здесь появятся те, что ждут вашего вклада.'
              : 'Nothing to improve yet — star and run lists, and the ones awaiting your contribution will show up here.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((it) => {
            const base = `/${it.ownerHandle}/${it.slug}`
            return (
              <li key={it.id} className="rounded-lg border border-border bg-surface px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={base} className="truncate text-[0.875rem] font-semibold text-accent hover:underline">
                      {tr(it.title, lang)}
                    </Link>
                    {tr(it.desc, lang) && <p className="mt-0.5 line-clamp-1 text-[0.78125rem] text-ink-2">{tr(it.desc, lang)}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.6875rem] text-muted">
                      <span className="inline-flex items-center gap-1"><Star size={12} /> {it.starsCount}</span>
                      {it.openSuggestions > 0 && (
                        <span className="inline-flex items-center gap-1 text-accent"><GitPullRequest size={12} /> {it.openSuggestions} {ru ? 'правок' : 'edits'}</span>
                      )}
                      {it.openIssues > 0 && (
                        <span className="inline-flex items-center gap-1 text-warn"><CircleDot size={12} /> {it.openIssues} {ru ? 'вопросов' : 'issues'}</span>
                      )}
                      <span>· {it.reason === 'starred' ? (ru ? 'в избранном' : 'starred') : ru ? 'вы прогоняли' : 'you ran it'}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <Link href={`${base}/suggest`} className="rounded-md bg-primary px-3 py-1.5 text-center text-[0.78125rem] font-medium text-primary-fg hover:opacity-90">
                      {ru ? 'Предложить правку' : 'Suggest edit'}
                    </Link>
                    {it.openIssues > 0 && (
                      <Link href={`${base}/issues`} className="rounded-md border border-border px-3 py-1.5 text-center text-[0.78125rem] text-ink-2 hover:border-border-strong">
                        {ru ? 'Вопросы' : 'Issues'}
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
