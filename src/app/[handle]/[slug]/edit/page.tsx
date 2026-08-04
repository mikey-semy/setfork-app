import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
// eslint-disable-next-line no-restricted-imports -- write-доступ (canWriteList) строже просмотра; редиректит не-редакторов
import { getStepPreviews, getTemplateDetail, getDraft } from '@/features/library/queries'
import { canWriteList } from '@/features/collab/queries'
import { canEditList } from '@/core'
import { discardDraft, publishEdits, saveDraft } from '@/features/library/actions'
import { ListEditor } from '@/features/library/ListEditor'
import { ListTypeToggle } from '@/features/library/ListTypeToggle'
import { TagInput } from '@/shared/ui/TagInput'
import { Field } from '@/shared/ui/Field'
import { ChangeNoteField } from '@/features/library/ChangeNoteField'
import { toEditorItems } from '@/features/library/editor'
import { FloatingBack } from '@/shared/ui/FloatingBack'
import { PageHeader } from '@/shared/ui/PageHeader'
import { PAGE_NARROW } from '@/shared/ui/control'
import { Alert } from '@/shared/ui/Alert'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { timeAgo } from '@/shared/ui/timeAgo'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle, slug }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('edit', lang)} · ${handle}/${slug}` }
}

export default async function EditPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>
  searchParams: Promise<{ blocked?: string; step?: string; saved?: string; e?: string }>
}) {
  const [{ handle: owner, slug }, sp, lang, session] = await Promise.all([params, searchParams, getLang(), getSession()])
  if (!session) redirect('/login')
  const detail = await getTemplateDetail(owner, slug)
  if (!detail) notFound()
  const { tpl, steps } = detail
  if (!(await canWriteList(tpl.id, tpl.ownerId, session.userId))) redirect(`/${owner}/${slug}`)
  // Архив/заморозка: редактор недоступен (список только-чтение). Разблокировать —
  // разархивировать/разморозить в настройках. Баннер причины покажет сама страница.
  if (!canEditList(tpl)) redirect(`/${owner}/${slug}`)

  // ЧЕРНОВИК ПРАВОК главнее опубликованного состава: человек вернулся дописывать —
  // он должен увидеть свою работу, а не то, что опубликовано (решение владельца
  // 04.08.2026). Черновик у каждого автора свой.
  const draft = await getDraft(tpl.id, session.userId)
  // Превью картинок нужны и черновику: без них редактор показывает пустые слоты
  // вместо загруженных скриншотов, и человек решает, что картинки пропали
  // (находка self-review). Ключи берём из самого черновика.
  const draftImageKeys = (draft?.items ?? []).map((it) => ({
    imageKey: (it.imageKey ?? (typeof it.content?.ref === 'string' ? it.content.ref : null)) as string | null,
  }))
  const initial = draft
    ? toEditorItems(draft.items, lang, await getStepPreviews(draftImageKeys))
    : toEditorItems(steps, lang, await getStepPreviews(steps))
  // Мета правится вместе с блоками, поэтому и восстанавливается из черновика:
  // иначе теги, тип списка и «курс» откатывались бы к опубликованным при перезагрузке.
  const draftTags = draft?.meta.tags ?? tpl.tags
  const draftOrdered = draft?.meta.ordered ?? tpl.ordered
  const draftGated = draft?.meta.gated ?? tpl.gated
  // Черновик, снятый со СТАРОЙ версии: список ушёл вперёд, пока правки лежали.
  const stale = !!draft && draft.baseVersion !== tpl.currentVersion
  const action = saveDraft.bind(null, tpl.id)

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

      {/* Отказ стража исполняемых команд: причина названа словами и привязана к
          номеру шага — иначе кнопка «Сохранить» выглядит как сломанная. */}
      {sp.blocked && (
        <Alert variant="danger" className="mb-4">
          <span className="block font-semibold">{t('destructiveBlockedTitle', lang)}</span>
          <span className="block">
            {t('destructiveBlockedBody', lang)
              .replace('{n}', sp.step ?? '?')
              .replace('{reason}', t(`destructive.${sp.blocked}` as Parameters<typeof t>[0], lang))}
          </span>
        </Alert>
      )}

      <form action={action}>
        {/* Заголовок НЕ обещает новую версию: правки копятся в черновике, а версия
            появляется только при публикации (жалоба владельца: «там всегда смена
            версий»). Куда приедет черновик — написано у самой кнопки публикации. */}
        <PageHeader
          title={
            <>
              {t('edit', lang)} · v{tpl.currentVersion}
              {draft ? <span className="ml-2 text-[0.78125rem] font-normal text-muted">{t('draftEdits', lang)}</span> : null}
            </>
          }
        />

        {/* Ответ на действие: сохранение и отказы. Без него редирект с ?saved=1
            выглядел как «ничего не произошло», а ?e=stale вовсе молчал. */}
        {sp.saved && !sp.e && (
          <Alert variant="ok" className="mb-4">
            <span className="block">{t('draftSaved', lang)}</span>
          </Alert>
        )}
        {sp.e === 'stale' && (
          <Alert variant="danger" className="mb-4">
            <span className="block">{t('draftStaleRefused', lang)}</span>
          </Alert>
        )}
        {sp.e === 'empty' && (
          <Alert variant="warn" className="mb-4">
            <span className="block">{t('draftEmpty', lang)}</span>
          </Alert>
        )}

        {draft && (
          <Alert variant={stale ? 'danger' : 'info'} className="mb-4">
            <span className="block">
              {stale
                ? t('draftStale', lang).replace('{base}', String(draft.baseVersion)).replace('{cur}', String(tpl.currentVersion))
                : t('draftSavedAt', lang).replace('{when}', timeAgo(draft.updatedAt, lang))}
            </span>
          </Alert>
        )}

        <ChangeNoteField templateId={tpl.id} lang={lang} placeholder={t('changeNote', lang)} required={false} initial={draft?.note ?? ''} />

        {/* htmlFor: внутри TagInput чипы с кнопками удаления — оборачивание в label ловило бы их клики. */}
        <Field label={t('tags', lang)} htmlFor="edit-tags" className="mb-6">
          <TagInput initial={draftTags} lang={lang} />
        </Field>

        {/* htmlFor: тумблер типа — группа кнопок, не одиночный контрол. */}
        <Field label={t('listKind', lang)} htmlFor="edit-kind" className="mb-6">
          <ListTypeToggle ordered={draftOrdered} lang={lang} />
        </Field>

        <label className="mb-6 flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 has-checked:border-accent">
          <input type="checkbox" name="gated" defaultChecked={draftGated} className="mt-0.5" />
          <span>
            <span className="block text-[0.8125rem] font-medium text-ink">{lang === 'ru' ? 'Последовательный курс' : 'Sequential course'}</span>
            <span className="block text-[0.78125rem] text-ink-2">{lang === 'ru' ? 'Следующий урок откроется только после сдачи тестов предыдущего' : 'The next lesson unlocks only after passing the previous lesson’s tests'}</span>
          </span>
        </label>

        <label className="mb-2 block text-[0.78125rem] font-semibold text-ink-2">{lang === 'ru' ? 'Пункты' : 'Items'}</label>
        <ListEditor
          name="items"
          initialItems={initial}
          lang={lang}
          ordered={draftOrdered}
          aiRefine={{ title: tr(tpl.title, lang), desc: tr(tpl.desc, lang), tags: tpl.tags }}
        />

        {/* ОБЕ кнопки в одной форме: публикация обязана взять то, что человек видит
            сейчас, а не прошлое сохранение (иначе дописанное пропадает молча).
            SubmitButton сам блокируется на время отправки — публикация это git-коммит,
            и второй клик создавал бы вторую версию. */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <SubmitButton variant="outline" className="h-11 max-sm:flex-1 sm:h-8">
            {t('saveDraft', lang)}
          </SubmitButton>
          {!stale && (
            <SubmitButton variant="primary" className="h-11 max-sm:flex-1 sm:h-8" formAction={publishEdits.bind(null, tpl.id)}>
              {t('publishVersion', lang).replace('{v}', String(tpl.currentVersion + 1))}
            </SubmitButton>
          )}
        </div>
        <p className="mt-2 text-[0.78125rem] text-muted">{t('draftKeepsVersion', lang)}</p>
      </form>

      {draft && (
        <form action={discardDraft.bind(null, tpl.id)} className="mt-3">
          <SubmitButton variant="danger" className="h-11 max-sm:w-full sm:h-8">
            {t('discardDraft', lang)}
          </SubmitButton>
        </form>
      )}
    </div>
  )
}
