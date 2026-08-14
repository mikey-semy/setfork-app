import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { canEditList } from '@/core'
import { ArrowLeft } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { getStepPreviews } from '@/features/library/queries'
import { requireViewableDetail } from '@/features/library/guard'
import { submitSuggestion } from '@/features/library/actions'
import { ListEditor } from '@/features/library/list-editor/ListEditor'
import { ChangeNoteField } from '@/features/library/ChangeNoteField'
import { toEditorItems } from '@/features/library/editor'
import { FloatingBack } from '@/shared/ui/FloatingBack'
import { PageHeader } from '@/shared/ui/PageHeader'
import { PAGE_NARROW } from '@/shared/ui/control'
import { buttonClass } from '@/shared/ui/button-style'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle, slug }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('suggestEdit', lang)} · ${handle}/${slug}` }
}

export default async function SuggestPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>
}) {
  const [{ handle: owner, slug }, lang, session] = await Promise.all([params, getLang(), getSession()])
  if (!session) redirect('/login')
  // Чокпоинт: полный canViewList (не только visibility — ещё draft/flagged/hidden).
  // Раньше проверялось только visibility==='private' → черновик/снятый модерацией список
  // был доступен для /suggest любому залогиненному.
  const detail = await requireViewableDetail(owner, slug)
  if (!detail) notFound()
  const { tpl, steps } = detail
  // Предложения запрещены в архиве и заморозке (список только-чтение).
  if (!canEditList(tpl)) redirect(`/${owner}/${slug}`)

  const initial = toEditorItems(steps, lang, await getStepPreviews(steps))
  const action = submitSuggestion.bind(null, tpl.id)

  return (
    <div className={PAGE_NARROW}>
      <Link
        href={`/${owner}/${slug}`}
        className="mb-4 inline-flex items-center gap-2 text-[0.8125rem] text-ink-2 hover:text-ink"
      >
        <ArrowLeft size={15} /> {tpl.owner.handle} / {tr(tpl.title, lang) || tpl.slug}
      </Link>
      {/* На длинном списке верхняя ссылка уезжает — плавающий дубль слева-внизу (фидбек владельца). */}
      <FloatingBack href={`/${owner}/${slug}`} label={tr(tpl.title, lang) || `${tpl.owner.handle}/${tpl.slug}`} />

      <form action={action}>
        <PageHeader
          title={t('suggestEdit', lang)}
          subtitle={
            lang === 'ru'
              ? 'Правь пункты. Автор списка примет правку новой версией или отклонит.'
              : 'Edit the items. The maintainer will accept it as a new version or reject it.'
          }
        />

        <div className="mb-6">
          <ChangeNoteField templateId={tpl.id} lang={lang} placeholder={t('changeNote', lang)} />
        </div>

        <ListEditor name="items" initialItems={initial} lang={lang} />

        <button type="submit" className={buttonClass({ variant: 'primary', size: 'lg', className: 'mt-6' })}>
          {t('sendSuggestion', lang)}
        </button>
      </form>
    </div>
  )
}
