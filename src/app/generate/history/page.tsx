import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CircleAlert, Loader2, MessageCircleQuestion, Sparkles } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { type Lang } from '@/shared/i18n'
import { getRecentGenerations, type GenerationStatus } from '@/features/generation/queries'
import { EmptyState } from '@/shared/ui/EmptyState'
import { timeAgo } from '@/shared/ui/timeAgo'

export const metadata = { title: 'Draft history' }

// История генераций: запрос getRecentGenerations уже был (и индекс под него), но экрана
// не существовало — попасть в прошлую генерацию можно было только по прямой ссылке.
// Ссылку всегда ведём на /generate/[id]: та страница сама редиректит на созданный список,
// если черновик уже принят.
export default async function GenerationHistoryPage() {
  const [lang, session] = await Promise.all([getLang(), getSession()])
  if (!session) redirect('/login')
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en)
  const items = await getRecentGenerations(session.userId, 50)

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-[18px] font-bold text-ink">{say('Draft history', 'История генераций')}</h1>
        <Link
          href="/generate"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-fg hover:opacity-90"
        >
          <Sparkles size={14} /> {say('New draft', 'Новый черновик')}
        </Link>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<Sparkles size={34} strokeWidth={1.5} />}
          title={say('No drafts yet', 'Черновиков пока нет')}
          hint={say('Describe what you need — the draft will appear here.', 'Опиши, что нужно сделать — черновик появится здесь.')}
          action={{ href: '/generate', label: say('Create a draft', 'Создать черновик') }}
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
                  <span className="block truncate text-[13.5px] text-ink">{g.query}</span>
                  <span className="mt-0.5 block text-[11.5px] text-muted">
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
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en)
  if (accepted) return say('List created', 'Список создан')
  if (status === 'pending') return say('In progress', 'В работе')
  if (status === 'failed') return say('Failed', 'Не удалось')
  if (status === 'clarify') return say('Needs details', 'Нужны уточнения')
  return say('Draft ready', 'Черновик готов')
}
