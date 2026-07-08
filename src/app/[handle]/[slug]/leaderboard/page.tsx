import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Trophy } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { tr } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { requireViewableMeta } from '@/features/library/guard'
import { ListHeader } from '@/widgets/ListHeader'
import { getCourseLeaderboard } from '@/features/quizzes/queries'

export default async function LeaderboardPage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle: owner, slug }, lang] = await Promise.all([params, getLang()])
  const ru = lang === 'ru'
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()

  const rows = await getCourseLeaderboard(meta.id)
  const medal = ['🥇', '🥈', '🥉']

  return (
    <>
      <ListHeader owner={owner} slug={slug} active="overview" />
      <div className="mx-auto w-full max-w-[720px] px-4 py-6">
        <h1 className="mb-1 flex items-center gap-2 text-[16px] font-bold text-ink">
          <Trophy size={18} className="text-accent" /> {ru ? 'Лидерборд курса' : 'Course leaderboard'}
        </h1>
        <p className="mb-5 text-[13px] text-ink-2">{tr(meta.title, lang)}</p>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-14 text-center text-[13.5px] text-muted">
            {ru ? 'Пока никто не прошёл этот курс — будьте первым!' : 'No one has completed this course yet — be the first!'}
          </div>
        ) : (
          <ol className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {rows.map((r, i) => (
              <li key={r.handle} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-7 shrink-0 text-center text-[15px]">{i < 3 ? medal[i] : <span className="font-mono text-[12px] text-muted">{i + 1}</span>}</span>
                <Link href={`/${r.handle}`} className="flex min-w-0 flex-1 items-center gap-2.5 hover:opacity-90">
                  <Avatar handle={r.handle} avatarUrl={r.avatarUrl} size={28} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-medium text-ink">{r.name ?? r.handle}</span>
                    <span className="block truncate text-[12px] text-ink-2">{r.handle}</span>
                  </span>
                </Link>
                <span className="shrink-0 text-right font-mono text-[11.5px] text-muted">
                  {new Intl.DateTimeFormat(ru ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(r.completedAt))}
                  <span className="ml-2">v{r.version}</span>
                </span>
              </li>
            ))}
          </ol>
        )}

        <Link href={`/${owner}/${slug}`} className="mt-4 inline-block text-[13px] text-accent hover:underline">
          {ru ? '← К курсу' : '← Back to the course'}
        </Link>
      </div>
    </>
  )
}
