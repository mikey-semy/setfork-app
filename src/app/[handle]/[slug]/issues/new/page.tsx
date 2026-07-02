import { notFound, redirect } from 'next/navigation'
import { CircleDot } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { getListMeta } from '@/features/library/queries'
import { ListHeader } from '@/features/library/ListHeader'
import { createIssue } from '@/features/issues/actions'
import { LabelPicker } from '@/features/issues/LabelPicker'

const inputCls = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] text-ink outline-none focus:border-border-strong'

export default async function NewIssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>
  searchParams: Promise<{ e?: string }>
}) {
  const { handle: owner, slug } = await params
  const sp = await searchParams
  const [lang, session] = await Promise.all([getLang(), getSession()])
  if (!session) redirect(`/login?next=/${owner}/${slug}/issues/new`)
  const meta = await getListMeta(owner, slug)
  if (!meta) notFound()

  return (
    <>
      <ListHeader owner={owner} slug={slug} active="issues" />
      <div className="mx-auto w-full max-w-[820px] px-4 py-6">
        <h1 className="mb-4 flex items-center gap-2 text-[17px] font-bold text-ink">
          <CircleDot size={18} className="text-ok" /> {t('newIssue', lang)}
        </h1>
        {sp.e === 'empty' && (
          <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">
            {t('titleRequired', lang)}
          </div>
        )}
        <form action={createIssue} className="flex flex-col gap-3">
          <input type="hidden" name="owner" value={owner} />
          <input type="hidden" name="slug" value={slug} />
          <input name="title" className={inputCls} placeholder={t('issueTitlePh', lang)} autoFocus maxLength={200} />
          <textarea name="body" rows={8} className={`${inputCls} resize-y font-normal`} placeholder={t('issueBodyPh', lang)} maxLength={20000} />
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-ink-2">{t('labelsLabel', lang)}</div>
            <LabelPicker lang={lang} />
          </div>
          <div className="flex justify-end">
            <button className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13.5px] font-semibold text-primary-fg">
              {t('submitNewIssue', lang)}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
