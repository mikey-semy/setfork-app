import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { GitFork } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { requireViewableMeta } from '@/features/library/guard'
import { PageHeader } from '@/shared/ui/PageHeader'
import { BackLink } from '@/shared/ui/BackLink'
import { ForkForm } from '@/features/library/ForkForm'
import { PAGE_NARROW } from '@/shared/ui/control'
import { cardClass } from '@/shared/ui/card-style'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle, slug }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('fork', lang)} · ${handle}/${slug}` }
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
    <div className={PAGE_NARROW}>
      <BackLink href={base} label={`${owner} / ${tr(meta.title, lang)}`} className="mb-2" />
      <PageHeader
        icon={<GitFork size={18} className="text-muted" />}
        title={t('forkDialogTitle', lang)}
        subtitle={
          <>
            {t('forkIntro', lang)}{' '}
            <Link href={`${base}/forks`} className="text-accent hover:underline">
              {t('forkExisting', lang)}
            </Link>
          </>
        }
      />
      <div className={cardClass({ pad: 'lg' })}>
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
