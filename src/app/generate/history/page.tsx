import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CircleAlert, Loader2, MessageCircleQuestion, Sparkles } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, type Lang } from '@/shared/i18n'
import { getRecentGenerations, type GenerationStatus } from '@/features/generation/queries'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { timeAgo } from '@/shared/ui/timeAgo'
import { PAGE } from '@/shared/ui/control'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('draftHistory', lang) }
}

// История генераций: запрос getRecentGenerations уже был (и индекс под него), но экрана
// не существовало — попасть в прошлую генерацию можно было только по прямой ссылке.
// Ссылку всегда ведём на /generate/[id]: та страница сама редиректит на созданный список,
// если черновик уже принят.
export default async function GenerationHistoryPage() {
  const [lang, session] = await Promise.all([getLang(), getSession()])
  if (!session) redirect('/login')
  const items = await getRecentGenerations(session.userId, 50)

  return (
    <div className={PAGE}>
      <PageHeader
        title={t('generation.draftHistory', lang)}
        actions={
          <Link
            href="/generate"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[0.78125rem] font-semibold text-primary-fg hover:opacity-90"
          >
            <Sparkles size={14} /> {t('generation.newDraft', lang)}
          </Link>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<Sparkles size={34} strokeWidth={1.5} />}
          title={t('generation.noDraftsYet', lang)}
          hint={t('generation.describeWhatYouNeed', lang)}
          action={{ href: '/generate', label: t('generation.createDraft', lang) }}
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((g) => (
            <li key={g.id}>
              <Link
                href={`/generate/${g.id}`}
                className="flex items-center gap-3 rounded-md border border-border bg-surface px-3.5 py-2.5 transition-colors hover:border-border-strong"
              >
                <StatusIcon status={g.status} accepted={!!g.chosenTemplateId} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8125rem] text-ink">{g.query}</span>
                  <span className="mt-0.5 block text-[0.6875rem] text-muted">
                    {statusLabel(g.status, !!g.chosenTemplateId, lang)} · {timeAgo(g.createdAt, lang)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StatusIcon({ status, accepted }: { status: GenerationStatus; accepted: boolean }) {
  if (accepted) return <Sparkles size={15} className="shrink-0 text-accent" />
  if (status === 'pending') return <Loader2 size={15} className="shrink-0 animate-spin text-muted" />
  if (status === 'failed') return <CircleAlert size={15} className="shrink-0 text-danger" />
  if (status === 'clarify') return <MessageCircleQuestion size={15} className="shrink-0 text-warn" />
  return <Sparkles size={15} className="shrink-0 text-muted" />
}

function statusLabel(status: GenerationStatus, accepted: boolean, lang: Lang): string {
  if (accepted) return t('generation.listCreated', lang)
  if (status === 'pending') return t('generation.inProgress', lang)
  if (status === 'failed') return t('generation.failed', lang)
  if (status === 'clarify') return t('generation.needsDetails', lang)
  return t('generation.draftReady', lang)
}
