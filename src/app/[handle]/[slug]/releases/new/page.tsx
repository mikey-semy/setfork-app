import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Tag } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { Input } from '@/shared/ui/input'
import { MarkdownEditor } from '@/shared/ui/MarkdownEditor'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { getVersions } from '@/features/library/queries'
import { requireViewableMeta } from '@/features/library/guard'
import { isCollaborator } from '@/features/collab/queries'
import { ListHeader } from '@/widgets/ListHeader'
import { createRelease } from '@/features/releases/actions'
import { VersionSelect } from '@/features/releases/VersionSelect'

const ERR: Record<string, { ru: string; en: string }> = {
  badtag: { ru: 'Тег: буквы/цифры и .-_ (до 40 символов).', en: 'Tag: letters/digits and .-_ (max 40 chars).' },
  badversion: { ru: 'Такой версии нет.', en: 'No such version.' },
  tagtaken: { ru: 'Тег уже занят другим релизом.', en: 'This tag is already used by another release.' },
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
      <ListHeader owner={owner} slug={slug} active="versions" />
      <div className="mx-auto w-full max-w-[680px] px-4 py-6">
        <h1 className="mb-1 flex items-center gap-2 text-[16px] font-bold text-ink">
          <Tag size={16} className="text-accent" /> {ru ? 'Новый релиз' : 'New release'}
        </h1>
        <p className="mb-5 text-[13px] text-ink-2">
          {ru
            ? 'Версии создаются автоматически при каждой правке; релиз — осознанная публикация одной из них с тегом и описанием.'
            : 'Versions are created automatically on every edit; a release is a deliberate publication of one of them with a tag and notes.'}
        </p>

        {err && (
          <div className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
            {ru ? err.ru : err.en}
          </div>
        )}

        <form action={createRelease.bind(null, meta.id)} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-ink">{ru ? 'Версия' : 'Version'}</span>
              <VersionSelect
                versions={versions.map((v) => v.version)}
                current={meta.currentVersion}
                currentLabel={ru ? '(текущая)' : '(current)'}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-ink">{ru ? 'Тег' : 'Tag'}</span>
              <Input name="tag" placeholder={`v${meta.currentVersion}`} maxLength={40} className="font-mono" />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-semibold text-ink">{ru ? 'Заголовок' : 'Title'}</span>
            <Input name="title" maxLength={200} placeholder={ru ? 'Что вошло в релиз' : 'What’s in this release'} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-semibold text-ink">Notes</span>
            <MarkdownEditor name="notes" rows={8} placeholder={ru ? 'Заметки релиза (markdown)…' : 'Release notes (markdown)…'} maxLength={50000} lang={lang} refScope={{ owner, slug }} />
          </label>
          <div className="flex items-center gap-3">
            <SubmitButton className="rounded-md bg-primary px-4 py-2 text-[13px] font-semibold text-primary-fg">
              {ru ? 'Опубликовать релиз' : 'Publish release'}
            </SubmitButton>
            <Link href={`/${owner}/${slug}/releases`} className="text-[13px] text-ink-2 hover:text-ink">
              {ru ? 'Отмена' : 'Cancel'}
            </Link>
          </div>
        </form>
      </div>
    </>
  )
}
