import { notFound } from 'next/navigation'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { getListMeta } from '@/features/library/queries'
import { getCollaborators } from '@/features/collab/queries'
import { CollaboratorsSection } from '@/features/collab/CollaboratorsSection'
import { getOwnerCatalogs } from '@/features/catalogs/queries'
import { CatalogSection } from '@/features/catalogs/CatalogSection'
import { ListHeader } from '@/features/library/ListHeader'
import { ListSettingsDanger } from '@/features/library/ListSettingsDanger'
import { TemplateSection } from '@/features/library/TemplateSection'

export default async function ListSettingsPage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle: owner, slug } = await params
  const [lang, session] = await Promise.all([getLang(), getSession()])
  const meta = await getListMeta(owner, slug)
  if (!meta) notFound()
  if (!session || session.userId !== meta.ownerId) notFound() // только владелец
  const [collaborators, catalogs] = await Promise.all([getCollaborators(meta.id), getOwnerCatalogs(meta.ownerId)])

  return (
    <>
      <ListHeader owner={owner} slug={slug} active="settings" />
      <div className="mx-auto w-full max-w-[820px] px-4 py-6">
        <CatalogSection templateId={meta.id} currentId={meta.repositoryId} catalogs={catalogs} lang={lang} />
        <CollaboratorsSection templateId={meta.id} collaborators={collaborators} lang={lang} />
        <TemplateSection templateId={meta.id} isTemplate={meta.isTemplate} lang={lang} />
        <ListSettingsDanger templateId={meta.id} slug={meta.slug} visibility={meta.visibility} pinned={meta.pinned} lang={lang} />
      </div>
    </>
  )
}
