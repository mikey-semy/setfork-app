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
import { EmptyState } from '@/shared/ui/EmptyState'
import { PAGE } from '@/shared/ui/control'
import { cardClass } from '@/shared/ui/card-style'
import { SmartImage } from '@/shared/ui/SmartImage'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const [{ slug }, lang] = await Promise.all([params, getLang()])
  const c = await getCollectionDetail(slug)
  if (!c) return {}
  // Заголовок/описание подборки — LocaleText: показываем на языке пользователя (fallback внутри tr).
  const title = tr(c.title, lang) || slug
  const description = tr(c.desc, lang) || `Curated lists on SetFork: ${title}.`
  const canonical = `/collections/${slug}`
  // ⚠️ `openGraph` здесь ОБЯЗАН нести title и description, а не одну обложку:
  // объявленный в сегменте, он ЗАМЕНЯЕТ родительский ЦЕЛИКОМ — и подборка с обложкой
  // уезжала в шеринг под названием сайта, а не своим.
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      siteName: 'SetFork',
      url: canonical,
      title,
      description,
      ...(c.coverUrl ? { images: [c.coverUrl] } : {}),
    },
  }
}

export default async function CollectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const [{ slug }, lang, session] = await Promise.all([params, getLang(), getSession()])
  const ru = lang === 'ru'
  const c = await getCollectionDetail(slug)
  if (!c) notFound()

  return (
    <div className={PAGE}>
      <div className="mb-5 overflow-hidden rounded-xl border border-border">
        {c.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <SmartImage src={c.coverUrl} alt="" className="h-45 w-full object-cover" />
        ) : (
          <AutoBanner seed={c.id} accent={c.accent} label={tr(c.title, lang) || c.slug} height="h-45" />
        )}
      </div>

      <h1 className="text-display font-bold leading-tight text-ink [overflow-wrap:anywhere]">{tr(c.title, lang) || c.slug}</h1>
      {tr(c.desc, lang) && <p className="mt-1 max-w-[70ch] text-body-lg text-ink-2 [overflow-wrap:anywhere]">{tr(c.desc, lang)}</p>}

      {c.lists.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-title font-semibold text-ink">
            {ru ? 'Списки' : 'Lists'} <span className="font-mono text-body-sm text-muted">{c.lists.length}</span>
          </h2>
          <FeedList items={c.lists} lang={lang} viewerId={session?.userId} className="flex flex-col gap-3" />
        </section>
      )}

      {c.catalogs.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-title font-semibold text-ink">
            {ru ? 'Каталоги' : 'Catalogs'} <span className="font-mono text-body-sm text-muted">{c.catalogs.length}</span>
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {c.catalogs.map((cat) => (
              <Link
                key={cat.id}
                href={`/${cat.ownerHandle}/catalogs/${cat.name}`}
                className={cardClass({ pad: 'sm', className: 'group block transition-colors hover:border-border-strong' })}
              >
                <div className="flex items-center gap-2">
                  <FolderGit2 size={15} className="text-muted" />
                  <span className="truncate font-semibold text-accent group-hover:underline">{tr(cat.title, lang) || cat.name}</span>
                </div>
                {tr(cat.desc, lang) && <p className="mt-1 line-clamp-2 text-body-sm text-ink-2">{tr(cat.desc, lang)}</p>}
                <div className="mt-2 flex items-center gap-2 text-caption text-muted">
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
        <EmptyState className="mt-8" hint={ru ? 'Подборка пока пуста.' : 'This collection is empty for now.'} />
      )}
    </div>
  )
}
