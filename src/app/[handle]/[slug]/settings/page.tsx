import { notFound } from 'next/navigation'
import { BadgeCheck, FolderGit2, GitFork, GitPullRequest, Image as ImageIcon, Info, LayoutTemplate, Radio, SlidersHorizontal, TriangleAlert, Users } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
// eslint-disable-next-line no-restricted-imports -- owner-only: доступ строже canViewList (session.userId === ownerId)
import { getListCover, getListMeta } from '@/features/library/queries'
import { getCollaborators } from '@/features/collab/queries'
import { getPendingTransfer } from '@/features/transfer/queries'
import { CollaboratorsSection } from '@/features/collab/CollaboratorsSection'
import { MirrorSection } from '@/features/library/MirrorSection'
import { getOwnerCatalogs } from '@/features/catalogs/queries'
import { CatalogSection } from '@/features/catalogs/CatalogSection'
import { VerificationSection } from '@/features/library/VerificationSection'
import { ListSettingsDanger } from '@/features/library/ListSettingsDanger'
import { TemplateSection } from '@/features/library/TemplateSection'
import { CoverSection } from '@/features/library/CoverSection'
import { GeneralSection } from '@/features/library/GeneralSection'
import { FeaturesSection } from '@/features/library/FeaturesSection'
import { LivingSection } from '@/features/library/LivingSection'
import { PrSettingsSection } from '@/features/library/PrSettingsSection'
import { withPrDefaults } from '@/features/library/pr-settings'
import { SettingsShell, type SettingsSection } from '@/features/settings/SettingsShell'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle, slug }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('settings', lang)} · ${handle}/${slug}` }
}

export default async function ListSettingsPage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle: owner, slug }, lang, session] = await Promise.all([params, getLang(), getSession()])
  const meta = await getListMeta(owner, slug)
  if (!meta) notFound()
  if (!session || session.userId !== meta.ownerId) notFound() // только владелец
  const [collaborators, catalogs, cover, pendingTransfer] = await Promise.all([
    getCollaborators(meta.id),
    getOwnerCatalogs(meta.ownerId, session.userId),
    getListCover(meta.id),
    getPendingTransfer(meta.id),
  ])

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
      id: 'verification',
      title: t('verify.heading', lang),
      icon: <BadgeCheck size={15} />,
      keywords: ['verification', 'verified', 'level', 'проверка', 'уровень', 'прогон'],
      content: (
        <VerificationSection
          templateId={meta.id}
          level={meta.verificationLevel}
          env={meta.verifiedEnv}
          version={meta.currentVersion}
          lang={lang}
        />
      ),
    },
    {
      id: 'mirror',
      title: t('mirrorTitle', lang),
      icon: <GitFork size={15} />,
      keywords: ['mirror', 'github', 'gitlab', 'push', 'backup', 'зеркало', 'бэкап'],
      content: (
        <MirrorSection
          templateId={meta.id}
          url={meta.mirrorUrl}
          hasToken={!!meta.mirrorHasToken}
          syncedAt={meta.mirrorSyncedAt}
          error={meta.mirrorError}
          attempts={meta.mirrorAttempts}
          lang={lang}
        />
      ),
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
      id: 'suggestions',
      title: t('prSettingsTitle', lang),
      icon: <GitPullRequest size={15} />,
      keywords: ['pull request', 'suggestions', 'merge', 'approvals', 'предложения', 'слияние', 'одобрения', 'ревью'],
      content: <PrSettingsSection templateId={meta.id} settings={withPrDefaults(meta.prSettings)} lang={lang} />,
    },
    {
      id: 'living',
      title: t('common.livingList', lang),
      icon: <Radio size={15} />,
      keywords: ['living', 'feed', 'fresh', 'news', 'updates', 'живой', 'лента', 'свежесть', 'новости', 'обновления'],
      content: <LivingSection templateId={meta.id} living={meta.living} lang={lang} />,
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
      keywords: ['danger', 'delete', 'remove', 'visibility', 'private', 'publish', 'draft', 'archive', 'freeze', 'lock', 'transfer', 'опасная', 'удалить', 'видимость', 'приватный', 'опубликовать', 'черновик', 'архив', 'заморозить', 'передать'],
      content: (
        <ListSettingsDanger
          templateId={meta.id}
          handle={owner}
          slug={meta.slug}
          title={tr(meta.title, lang)}
          visibility={meta.visibility}
          status={meta.status}
          moderation={meta.moderation}
          archived={meta.archivedAt != null}
          frozen={meta.frozenAt != null}
          mirrored={!!meta.mirrorUrl}
          pendingTransfer={pendingTransfer}
          lang={lang}
        />
      ),
    },
  ]

  return <SettingsShell sections={sections} lang={lang} />
}
