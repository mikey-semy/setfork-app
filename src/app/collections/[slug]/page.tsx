import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { FolderGit2 } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { tr } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { AutoBanner } from '@/shared/ui/AutoBanner'
import { FeedList } from '@/features/library/FeedList'
import { getCollectionDetail } from '@/features/collections/queries'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const [{ slug }, lang] = await Promise.all([params, getLang()])
  const c = await getCollectionDetail(slug)
  if (!c) return {}
  // Заголовок/описание подборки — LocaleText: показываем на языке пользователя (fallback внутри tr).
  const title = tr(c.title, lang) || slug
  return { title, description: tr(c.desc, lang) || undefined, openGraph: c.coverUrl ? { images: [c.coverUrl] } : undefined }
}

export default async function CollectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const [{ slug }, lang, session] = await Promise.all([params, getLang(), getSession()])
  const ru = lang === 'ru'
  const c = await getCollectionDetail(slug)
  if (!c) notFound()

  return (
    <div className="mx-auto w-full max-w-[67.5rem] px-4 py-6">
      <div className="mb-5 overflow-hidden rounded-xl border border-border">
        {c.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.coverUrl} alt="" className="h-[11.25rem] w-full object-cover" />
        ) : (
          <AutoBanner seed={c.id} accent={c.accent} label={tr(c.title, lang) || c.slug} height="h-[11.25rem]" />
        )}
      </div>

      <h1 className="text-[1.5rem] font-bold leading-tight text-ink">{tr(c.title, lang) || c.slug}</h1>
      {tr(c.desc, lang) && <p className="mt-1 max-w-[70ch] text-[0.875rem] text-ink-2">{tr(c.desc, lang)}</p>}

      {c.lists.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-[1rem] font-semibold text-ink">
            {ru ? 'Списки' : 'Lists'} <span className="font-mono text-[0.78125rem] text-muted">{c.lists.length}</span>
          </h2>
          <FeedList items={c.lists} lang={lang} viewerId={session?.userId} className="flex flex-col gap-3" />
        </section>
      )}

      {c.catalogs.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[1rem] font-semibold text-ink">
            {ru ? 'Каталоги' : 'Catalogs'} <span className="font-mono text-[0.78125rem] text-muted">{c.catalogs.length}</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {c.catalogs.map((cat) => (
              <Link
                key={cat.id}
                href={`/${cat.ownerHandle}/catalogs/${cat.name}`}
                className="group rounded-lg border border-border bg-surface px-4 py-3 hover:border-border-strong"
              >
                <div className="flex items-center gap-2">
                  <FolderGit2 size={15} className="text-muted" />
                  <span className="truncate font-semibold text-accent group-hover:underline">{tr(cat.title, lang) || cat.name}</span>
                </div>
                {tr(cat.desc, lang) && <p className="mt-1 line-clamp-2 text-[0.78125rem] text-ink-2">{tr(cat.desc, lang)}</p>}
                <div className="mt-2 flex items-center gap-2 text-[0.6875rem] text-muted">
                  <Avatar handle={cat.ownerHandle} avatarUrl={cat.ownerAvatarUrl} size={16} />
                  <span>{cat.ownerHandle}</span>
                  <span className="font-mono">· {cat.listCount} {ru ? 'списков' : 'lists'}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {c.lists.length === 0 && c.catalogs.length === 0 && (
        <p className="mt-8 rounded-lg border border-dashed border-border py-12 text-center text-[0.8125rem] text-muted">
          {ru ? 'Подборка пока пуста.' : 'This collection is empty for now.'}
        </p>
      )}
    </div>
  )
}
