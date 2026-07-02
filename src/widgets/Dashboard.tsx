import Link from 'next/link'
import { Plus, Sparkles } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { t, tr, type Lang } from '@/shared/i18n'
import { getActivity, getPopularTags, getUserTemplates } from '@/features/library/queries'

export async function Dashboard({ lang, userId }: { lang: Lang; userId: string }) {
  const [mine, activity, tags] = await Promise.all([
    getUserTemplates(userId, userId),
    getActivity(30, userId),
    getPopularTags(18),
  ])

  return (
    <div className="mx-auto grid w-full max-w-[1280px] gap-6 px-6 py-6 lg:grid-cols-[300px_minmax(0,1fr)_260px]">
      {/* Слева: твои списки */}
      <aside className="lg:sticky lg:top-[68px] lg:self-start">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{t('yourLists', lang)}</span>
          <Link href="/new" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent hover:underline">
            <Plus size={13} /> {lang === 'ru' ? 'Создать' : 'New'}
          </Link>
        </div>
        {mine.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-muted">
            {t('emptyMyLists', lang)}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {mine.map((m) => (
              <Link
                key={m.id}
                href={`/${m.ownerHandle}/${m.slug}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-surface"
              >
                <Avatar handle={m.ownerHandle} avatarUrl={m.ownerAvatarUrl} size={18} />
                <span className="truncate text-ink-2">
                  <span className="font-semibold text-ink">{m.slug}</span>
                </span>
                <span className="ml-auto font-mono text-[10.5px] text-muted">v{m.version}</span>
              </Link>
            ))}
          </div>
        )}
      </aside>

      {/* Центр: лента изменений */}
      <section className="min-w-0">
        <h2 className="mb-3 text-[15px] font-semibold text-ink">{t('recentActivity', lang)}</h2>
        {activity.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center text-[13.5px] text-muted">
            {t('noActivity', lang)}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {activity.map((a, i) => (
              <div key={`${a.templateId}-${a.version}-${i}`} className="flex gap-3 rounded-lg border border-border bg-surface p-3.5">
                <Link href={`/${a.ownerHandle}`} className="flex-shrink-0">
                  <Avatar handle={a.ownerHandle} avatarUrl={a.ownerAvatarUrl} size={34} />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]">
                    <Link href={`/${a.ownerHandle}`} className="text-ink-2 hover:text-accent">
                      {a.ownerHandle}
                    </Link>
                    <span className="text-ink-2">
                      {a.version === 1 ? t('created', lang) : `${t('updatedTo', lang)} v${a.version}`}
                    </span>
                    <Link href={`/${a.ownerHandle}/${a.slug}`} className="font-semibold text-accent hover:underline">
                      {a.slug}
                    </Link>
                    {a.origin === 'ai_draft' && a.version === 1 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10.5px] font-semibold text-accent">
                        <Sparkles size={10} /> {t('aiDraft', lang)}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[13px] text-ink-2">{tr(a.title, lang)}</div>
                  {a.note && !['initial', 'edit', 'seeded'].includes(a.note) && (
                    <div className="mt-1 text-[12.5px] text-muted">“{a.note}”</div>
                  )}
                </div>
                <span className="flex-shrink-0 font-mono text-[11px] text-muted">
                  {new Intl.DateTimeFormat(lang === 'ru' ? 'ru' : 'en', { month: 'short', day: 'numeric' }).format(
                    new Date(a.createdAt),
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Справа: популярные теги */}
      <aside className="hidden lg:sticky lg:top-[68px] lg:block lg:self-start">
        <div className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{t('popularTags', lang)}</div>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tg) => (
            <Link
              key={tg.tag}
              href={`/explore?tag=${encodeURIComponent(tg.tag)}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[12px] text-ink-2 hover:text-ink"
            >
              {tg.tag}
              <span className="font-mono text-[10.5px] text-muted">{tg.count}</span>
            </Link>
          ))}
        </div>
      </aside>
    </div>
  )
}
