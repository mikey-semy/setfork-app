import { notFound, redirect } from 'next/navigation'
import { MessagesSquare } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { Input } from '@/shared/ui/input'
import { MarkdownEditor } from '@/shared/ui/MarkdownEditor'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { requireViewableMeta } from '@/features/library/guard'
import { ListHeader } from '@/widgets/ListHeader'
import { createDiscussion } from '@/features/discussions/actions'
import { DISCUSSION_CATEGORIES } from '@/features/discussions/constants'

export default async function NewDiscussionPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>
  searchParams: Promise<{ e?: string }>
}) {
  const { handle: owner, slug } = await params
  const [{ e }, lang, session] = await Promise.all([searchParams, getLang(), getSession()])
  const ru = lang === 'ru'
  if (!session) redirect(`/login?next=/${owner}/${slug}/discussions/new`)
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()

  return (
    <>
      <ListHeader owner={owner} slug={slug} active="discussions" />
      <div className="mx-auto w-full max-w-[820px] px-4 py-6">
        <h1 className="mb-4 flex items-center gap-2 text-[17px] font-bold text-ink">
          <MessagesSquare size={18} className="text-accent" /> {ru ? 'Новое обсуждение' : 'New discussion'}
        </h1>
        <form action={createDiscussion} className="flex flex-col gap-3">
          <input type="hidden" name="owner" value={owner} />
          <input type="hidden" name="slug" value={slug} />

          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-ink-2">{ru ? 'Категория' : 'Category'}</div>
            <div className="flex flex-wrap gap-2">
              {DISCUSSION_CATEGORIES.map((c, i) => (
                <label
                  key={c.key}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[13px] text-ink has-[:checked]:border-accent has-[:checked]:bg-[var(--accent-soft)]"
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
            className={`px-3 py-2 text-[14px] ${e === 'empty' ? 'border-danger' : ''}`}
            placeholder={ru ? 'Заголовок' : 'Title'}
          />
          <MarkdownEditor name="body" rows={8} placeholder={ru ? 'О чём хотите поговорить?' : 'What do you want to discuss?'} maxLength={20000} lang={lang} refScope={{ owner, slug }} />

          <div className="flex justify-end">
            <SubmitButton className="rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-fg">
              {ru ? 'Создать' : 'Start discussion'}
            </SubmitButton>
          </div>
        </form>
      </div>
    </>
  )
}
