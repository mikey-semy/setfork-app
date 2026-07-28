import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { canEditList } from '@/core'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { FloatingBack } from '@/shared/ui/FloatingBack'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { requireViewableMeta } from '@/features/library/guard'
import { getSuggestion } from '@/features/library/queries'
import { updateSuggestionItems } from '@/features/library/actions'
import { canEditSuggestionItems } from '@/features/library/suggestion-perms'
import { blocksFrom } from '@/features/library/suggestion-blocks'
import { ListEditor } from '@/features/library/ListEditor'
import { toEditorItems } from '@/features/library/editor'
import { gitCore } from '@/features/git/core'
import type { ProposedItem } from '@/shared/db'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string; id: string }> }) {
  const { handle, slug, id } = await params
  return { title: `Edit suggestion #${id} · ${handle}/${slug}` }
}

/**
 * Правка ПУНКТОВ предложения — тот же редактор, что на /suggest.
 *
 * Отдельная страница, а не режим внутри страницы предложения: редактор большой,
 * а обсуждение рядом с ним превратилось бы в две страницы в одной. Возврат — по
 * той же схеме, что у создания правки (верхняя ссылка + плавающий дубль, потому
 * что на длинном списке верхняя уезжает).
 */
export default async function EditSuggestionPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string; id: string }>
}) {
  const [{ handle: owner, slug, id }, lang, session] = await Promise.all([params, getLang(), getSession()])
  const path = `/${owner}/${slug}/suggestions/${id}`
  if (!session) redirect(`/login?next=${path}/edit`)
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  const sug = await getSuggestion(meta.id, id)
  if (!sug) notFound()
  // Закрытую правку не редактируем: её содержимое — уже история.
  if (sug.status !== 'open' || !canEditList(meta)) redirect(path)
  if (!(await canEditSuggestionItems({ ...sug, template: meta }, session.userId))) redirect(path)

  // Пункты — по общему правилу: у ветки они в tip, у старых предложений в БД.
  const snapshot = sug.branchRef
    ? await gitCore.branchSnapshot({ owner, slug }, sug.branchRef).catch(() => null)
    : null
  if (sug.branchRef && !snapshot) redirect(`${path}?e=not-found`)
  const items: ProposedItem[] = blocksFrom(sug, snapshot)
  const initial = toEditorItems(items as never, lang, {})

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-6 sm:px-6 sm:py-8">
      <Link href={path} className="mb-4 inline-flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft size={15} />
        {/* Длинный заголовок не должен разносить строку — усечение, а не перенос. */}
        <span className="min-w-0 truncate">
          #{sug.number ?? ''} {sug.note || tr(meta.title, lang)}
        </span>
      </Link>
      <FloatingBack href={path} label={sug.note || tr(meta.title, lang) || slug} />

      <form action={updateSuggestionItems.bind(null, sug.id)}>
        <h1 className="mb-1 text-[18px] font-bold text-ink">{t('prEditItems', lang)}</h1>
        <p className="mb-5 text-[13px] text-ink-2">
          {sug.branchRef ? t('prEditItemsHintBranch', lang) : t('prEditItemsHint', lang)}
        </p>

        <ListEditor name="items" initialItems={initial} lang={lang} />

        {/* Primary — внизу справа (зона большого пальца); на мобиле кнопка во всю
            ширину строки действий, чтобы не жаться к краю. */}
        <div className="mt-6 flex justify-end">
          <SubmitButton className="inline-flex h-[38px] items-center justify-center rounded-md bg-primary px-5 text-[13px] font-semibold text-primary-fg max-sm:w-full">
            {t('saveChanges', lang)}
          </SubmitButton>
        </div>
      </form>
    </div>
  )
}
