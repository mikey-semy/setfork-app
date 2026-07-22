import { notFound } from 'next/navigation'
import { FolderGit2, Image as ImageIcon, Info, LayoutTemplate, SlidersHorizontal, TriangleAlert, Users } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
// eslint-disable-next-line no-restricted-imports -- owner-only: доступ строже canViewList (session.userId === ownerId)
import { getListCover, getListMeta } from '@/features/library/queries'
import { getCollaborators } from '@/features/collab/queries'
import { CollaboratorsSection } from '@/features/collab/CollaboratorsSection'
import { getOwnerCatalogs } from '@/features/catalogs/queries'
import { CatalogSection } from '@/features/catalogs/CatalogSection'
import { ListSettingsDanger } from '@/features/library/ListSettingsDanger'
import { TemplateSection } from '@/features/library/TemplateSection'
import { CoverSection } from '@/features/library/CoverSection'
import { GeneralSection } from '@/features/library/GeneralSection'
import { FeaturesSection } from '@/features/library/FeaturesSection'
import { SettingsShell, type SettingsSection } from '@/features/settings/SettingsShell'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  return { title: `Settings · ${handle}/${slug}` }
}

export default async function ListSettingsPage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle: owner, slug }, lang, session] = await Promise.all([params, getLang(), getSession()])
  const meta = await getListMeta(owner, slug)
  if (!meta) notFound()
  if (!session || session.userId !== meta.ownerId) notFound() // только владелец
  const [collaborators, catalogs, cover] = await Promise.all([getCollaborators(meta.id), getOwnerCatalogs(meta.ownerId), getListCover(meta.id)])

  // Настройки списка на общем SettingsShell (как настройки пользователя/админки):
  // липкое меню секций + scrollspy + поиск. Метка меню = имя секции.
  const sections: SettingsSection[] = [
    {
      id: 'general',
      title: t('generalTitle', lang),
      icon: <Info size={15} />,
      keywords: ['general', 'title', 'name', 'description', 'tags', 'ordered', 'основное', 'название', 'описание', 'теги', 'порядок'],
      content: (
        <GeneralSection
          templateId={meta.id}
          title={meta.title}
          desc={meta.desc}
          tags={meta.tags}
          ordered={meta.ordered}
          lang={lang}
        />
      ),
    },
    {
      id: 'cover',
      title: t('coverTitle', lang),
      icon: <ImageIcon size={15} />,
      keywords: ['cover', 'banner', 'image', 'accent', 'gradient', 'обложка', 'баннер', 'изображение', 'акцент', 'градиент'],
      content: <CoverSection templateId={meta.id} slug={meta.slug} initialCover={cover.coverUrl} initialAccent={cover.accent} lang={lang} />,
    },
    {
      id: 'catalog',
      title: t('catalogHeading', lang),
      icon: <FolderGit2 size={15} />,
      keywords: ['catalog', 'repository', 'group', 'каталог', 'репозиторий', 'группа'],
      content: <CatalogSection templateId={meta.id} currentId={meta.repositoryId} catalogs={catalogs} lang={lang} />,
    },
    {
      id: 'collaborators',
      title: t('collaboratorsHeading', lang),
      icon: <Users size={15} />,
      keywords: ['collaborators', 'access', 'edit', 'team', 'соавторы', 'доступ', 'редактирование', 'команда'],
      content: <CollaboratorsSection templateId={meta.id} collaborators={collaborators} lang={lang} />,
    },
    {
      id: 'features',
      title: t('featuresTitle', lang),
      icon: <SlidersHorizontal size={15} />,
      keywords: ['features', 'issues', 'discussions', 'enable', 'disable', 'разделы', 'задачи', 'обсуждения', 'включить', 'выключить'],
      content: (
        <FeaturesSection
          templateId={meta.id}
          issuesEnabled={meta.issuesEnabled}
          discussionsEnabled={meta.discussionsEnabled}
          lang={lang}
        />
      ),
    },
    {
      id: 'template',
      title: t('templateTitle', lang),
      icon: <LayoutTemplate size={15} />,
      keywords: ['template', 'use this template', 'reuse', 'шаблон', 'использовать шаблон'],
      content: <TemplateSection templateId={meta.id} isTemplate={meta.isTemplate} lang={lang} />,
    },
    {
      id: 'danger',
      title: t('dangerZone', lang),
      icon: <TriangleAlert size={15} />,
      danger: true,
      keywords: ['danger', 'delete', 'remove', 'visibility', 'private', 'pin', 'опасная', 'удалить', 'видимость', 'приватный', 'закрепить'],
      content: (
        <ListSettingsDanger
          templateId={meta.id}
          handle={owner}
          slug={meta.slug}
          visibility={meta.visibility}
          moderation={meta.moderation}
          pinned={meta.pinned}
          lang={lang}
        />
      ),
    },
  ]

  return (
    <>
      <SettingsShell sections={sections} lang={lang} />
    </>
  )
}
