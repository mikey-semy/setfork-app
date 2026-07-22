import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, GitFork } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { requireViewableMeta } from '@/features/library/guard'
import { ForkForm } from '@/features/library/ForkForm'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  return { title: `Fork · ${handle}/${slug}` }
}

// «Create a new fork» отдельной СТРАНИЦЕЙ (как GitHub), не модалкой (фидбек владельца).
export default async function ForkPage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle: owner, slug }, lang, session] = await Promise.all([params, getLang(), getSession()])
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  const base = `/${owner}/${slug}`
  if (!session) redirect('/login') // гость — на вход
  if (session.userId === meta.ownerId) redirect(base) // свой список форкнуть нельзя (как GitHub)

  return (
    <div className="mx-auto w-full max-w-[560px] px-4 py-8">
      <Link href={base} className="mb-5 inline-flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft size={15} /> {owner} / {tr(meta.title, lang)}
      </Link>
      <h1 className="flex items-center gap-2 text-[19px] font-bold text-ink">
        <GitFork size={18} className="text-muted" /> {t('forkDialogTitle', lang)}
      </h1>
      <p className="mb-5 mt-1.5 text-[13px] leading-relaxed text-ink-2">
        {t('forkIntro', lang)}{' '}
        <Link href={`${base}/forks`} className="text-accent hover:underline">
          {t('forkExisting', lang)}
        </Link>
      </p>
      <div className="rounded-lg border border-border bg-surface p-5">
        <ForkForm
          templateId={meta.id}
          defaultSlug={meta.slug}
          viewerHandle={session.handle}
          cancelHref={base}
          labels={{
            ownerLabel: t('forkOwnerLabel', lang),
            nameLabel: t('forkNameLabel', lang),
            nameHint: t('forkNameHint', lang),
            available: t('forkAvailable', lang),
            taken: t('forkTaken', lang),
            descLabel: t('forkDescLabel', lang),
            descPlaceholder: t('forkDescPlaceholder', lang),
            create: t('createFork', lang),
            cancel: t('cancel', lang),
          }}
        />
      </div>
    </div>
  )
}
