import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Tag } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Input } from '@/shared/ui/input'
import { Alert } from '@/shared/ui/Alert'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { PageHeader } from '@/shared/ui/PageHeader'
import { getVersions } from '@/features/library/queries'
import { requireViewableMeta } from '@/features/library/guard'
import { isCollaborator } from '@/features/collab/queries'
import { createRelease } from '@/features/releases/actions'
import { VersionSelect } from '@/features/releases/VersionSelect'
import { ReleaseNotesGen } from '@/features/releases/ReleaseNotesGen'

const ERR: Record<string, { ru: string; en: string }> = {
  badtag: { ru: 'Тег: буквы/цифры и .-_ (до 40 символов).', en: 'Tag: letters/digits and .-_ (max 40 chars).' },
  badversion: { ru: 'Такой версии нет.', en: 'No such version.' },
  tagtaken: { ru: 'Тег уже занят другим релизом.', en: 'This tag is already used by another release.' },
  vreserved: {
    ru: 'Имена вида v12 заняты автоматическими версиями — выберите другое, например v1.0 или stable.',
    en: 'Names like v12 are reserved for automatic versions — pick another, e.g. v1.0 or stable.',
  },
  tagfail: {
    ru: 'Не удалось создать git-тег — релиз не опубликован. Попробуйте ещё раз.',
    en: 'Could not create the git tag — the release was not published. Please try again.',
  },
}

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle, slug }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('newRelease', lang)} · ${handle}/${slug}` }
}

export default async function NewReleasePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>
  searchParams: Promise<{ e?: string }>
}) {
  const [{ handle: owner, slug }, sp, lang, session] = await Promise.all([params, searchParams, getLang(), getSession()])
  const ru = lang === 'ru'
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  if (!session) redirect(`/login?next=/${owner}/${slug}/releases/new`)
  const canManage = session.userId === meta.ownerId || (await isCollaborator(meta.id, session.userId))
  if (!canManage) redirect(`/${owner}/${slug}/releases`)
  const versions = await getVersions(meta.id)
  const err = sp.e ? ERR[sp.e] : null

  return (
    <>
      <div className="mx-auto w-full max-w-[42.5rem] px-4 py-6">
        <PageHeader
          icon={<Tag size={16} />}
          title={ru ? 'Новый релиз' : 'New release'}
          subtitle={
            ru
              ? 'Версии создаются автоматически при каждой правке; релиз — осознанная публикация одной из них с тегом и описанием.'
              : 'Versions are created automatically on every edit; a release is a deliberate publication of one of them with a tag and notes.'
          }
        />

        {err && (
          <Alert variant="danger" className="mb-4">
            {ru ? err.ru : err.en}
          </Alert>
        )}

        <form action={createRelease.bind(null, meta.id)} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[0.78125rem] font-semibold text-ink">{ru ? 'Версия' : 'Version'}</span>
              <VersionSelect
                versions={versions.map((v) => v.version)}
                current={meta.currentVersion}
                currentLabel={ru ? '(текущая)' : '(current)'}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[0.78125rem] font-semibold text-ink">{ru ? 'Тег' : 'Tag'}</span>
              {/* Без дефолта v<N>: это имена автотегов версий (#590), релизу нужен свой. */}
              <Input name="tag" required placeholder={`v${meta.currentVersion}.0`} maxLength={40} className="font-mono" />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.78125rem] font-semibold text-ink">{ru ? 'Заголовок' : 'Title'}</span>
            <Input name="title" maxLength={200} placeholder={ru ? 'Что вошло в релиз' : 'What’s in this release'} />
          </label>
          <ReleaseNotesGen
            templateId={meta.id}
            owner={owner}
            slug={slug}
            lang={lang}
            labels={{
              notes: 'Notes',
              generate: t('generateFromChanges', lang),
              empty: t('changelogEmpty', lang),
              placeholder: t('releaseNotesPh', lang),
            }}
          />
          <label className="flex cursor-pointer items-center gap-2.5 text-[0.8125rem]">
            <input type="checkbox" name="prerelease" className="size-4 accent-(--accent)" />
            <span className="font-medium text-ink">{t('preRelease', lang)}</span>
            <span className="text-muted">— {t('preReleaseHint', lang)}</span>
          </label>
          <div className="flex items-center gap-3">
            <SubmitButton>
              {ru ? 'Опубликовать релиз' : 'Publish release'}
            </SubmitButton>
            <Link href={`/${owner}/${slug}/releases`} className="text-[0.8125rem] text-ink-2 hover:text-ink">
              {ru ? 'Отмена' : 'Cancel'}
            </Link>
          </div>
        </form>
      </div>
    </>
  )
}
