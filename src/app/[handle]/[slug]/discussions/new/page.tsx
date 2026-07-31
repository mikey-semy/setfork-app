import { notFound, redirect } from 'next/navigation'
import { MessagesSquare } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Input } from '@/shared/ui/input'
import { MarkdownEditor } from '@/shared/ui/MarkdownEditor'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { FloatingBack } from '@/shared/ui/FloatingBack'
import { requireViewableMeta } from '@/features/library/guard'
import { createDiscussion } from '@/features/discussions/actions'
import { DISCUSSION_CATEGORIES } from '@/features/discussions/constants'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle, slug }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('newDiscussion', lang)} · ${handle}/${slug}` }
}

export default async function NewDiscussionPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>
  searchParams: Promise<{ e?: string }>
}) {
  const [{ handle: owner, slug }, { e }, lang, session] = await Promise.all([params, searchParams, getLang(), getSession()])
  const ru = lang === 'ru'
  if (!session) redirect(`/login?next=/${owner}/${slug}/discussions/new`)
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  if (!meta.discussionsEnabled) notFound() // раздел выключен владельцем (Settings → Features)

  return (
    <>
      <div className="mx-auto w-full max-w-[51.25rem] px-4 py-6">
      <FloatingBack href={`/${owner}/${slug}/discussions`} label={t('featDiscussions', lang)} />
        <PageHeader icon={<MessagesSquare size={18} />} title={ru ? 'Новое обсуждение' : 'New discussion'} />
        <form action={createDiscussion} className="flex flex-col gap-3">
          <input type="hidden" name="owner" value={owner} />
          <input type="hidden" name="slug" value={slug} />

          <div>
            <div className="mb-1.5 text-[0.78125rem] font-semibold text-ink-2">{ru ? 'Категория' : 'Category'}</div>
            <div className="flex flex-wrap gap-2">
              {DISCUSSION_CATEGORIES.map((c, i) => (
                <label
                  key={c.key}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[0.8125rem] text-ink has-checked:border-accent has-checked:bg-(--accent-soft)"
                >
                  <input type="radio" name="category" value={c.key} defaultChecked={i === 0} className="sr-only" />
                  {c.icon} {ru ? c.ru : c.en}
                </label>
              ))}
            </div>
          </div>

          <Input
            name="title"
            required
            maxLength={200}
            autoFocus
            className={`px-3 py-2 text-[0.875rem] ${e === 'empty' ? 'border-danger' : ''}`}
            placeholder={ru ? 'Заголовок' : 'Title'}
          />
          <MarkdownEditor name="body" rows={8} placeholder={ru ? 'О чём хотите поговорить?' : 'What do you want to discuss?'} maxLength={20000} lang={lang} refScope={{ owner, slug }} />

          <div className="flex justify-end">
            <SubmitButton>
              {ru ? 'Создать' : 'Start discussion'}
            </SubmitButton>
          </div>
        </form>
      </div>
    </>
  )
}
