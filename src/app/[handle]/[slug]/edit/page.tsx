import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
// eslint-disable-next-line no-restricted-imports -- write-доступ (canWriteList) строже просмотра; редиректит не-редакторов
import { getStepPreviews, getTemplateDetail, getDraft } from '@/features/library/queries'
import { canWriteList } from '@/features/collab/queries'
import { canEditList } from '@/core'
import { discardDraft, publishEdits, saveDraft } from '@/features/library/actions'
import { BackLink } from '@/shared/ui/BackLink'
import { ListEditor } from '@/features/library/list-editor/ListEditor'
import { GatedToggle, ListTypeToggle } from '@/features/library/ListFormToggles'
import { ListSettingsSheet } from '@/features/library/ListSettingsSheet'
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
      <BackLink href={`/${owner}/${slug}`} label={`${tpl.owner.handle} / ${tr(tpl.title, lang) || tpl.slug}`} className="mb-1" />
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
        {sp.e === 'outofsync' && (
          <Alert variant="danger" className="mb-4">
            <span className="block">{t('draftOutOfSync', lang)}</span>
          </Alert>
        )}
        {sp.e === 'nodraft' && (
          <Alert variant="warn" className="mb-4">
            <span className="block">{t('draftNothing', lang)}</span>
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

        {/* Свойства списка — в боковой панели: экран правки принадлежит пунктам, а
            теги, тип и режим курса меняют куда реже, чем сам состав (решение владельца).
            Панель не уходит в портал — её поля остаются полями ЭТОЙ формы.
            Видимость здесь не правится: она живёт в опасной зоне настроек (как
            «Change visibility» у GitHub). */}
        <div className="mb-6">
          <ListSettingsSheet lang={lang}>
            {/* htmlFor: внутри TagInput чипы с кнопками удаления — оборачивание в label ловило бы их клики. */}
            <Field label={t('tags', lang)} htmlFor="edit-tags">
              <TagInput initial={draftTags} lang={lang} />
            </Field>

            {/* htmlFor: внутри тумблеров свои label — вложенные невалидны. */}
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
              <Field label={t('listKind', lang)} htmlFor="edit-kind">
                <ListTypeToggle ordered={draftOrdered} lang={lang} />
              </Field>
              <Field label={t('gatedShort', lang)} htmlFor="edit-gated">
                <GatedToggle gated={draftGated} lang={lang} />
              </Field>
            </div>
          </ListSettingsSheet>
        </div>

        <label className="mb-2 block text-[0.78125rem] font-semibold text-ink-2">{t('listItems', lang)}</label>
        <ListEditor
          name="items"
          initialItems={initial}
          lang={lang}
          ordered={draftOrdered}
          aiRefine={{ title: tr(tpl.title, lang), desc: tr(tpl.desc, lang), tags: tpl.tags }}
          // Ф4: канон собирает ядро по СУЩЕСТВУЮЩЕМУ списку — здесь он есть.
          // На странице создания списка его нет, и режим «код» там не предлагается.
          canonOf={tpl.id}
        />

        {/* ОБЕ кнопки в одной форме: публикация обязана взять то, что человек видит
            сейчас, а не прошлое сохранение (иначе дописанное пропадает молча).
            SubmitButton сам блокируется на время отправки — публикация это git-коммит,
            и второй клик создавал бы вторую версию. */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <SubmitButton variant="outline" className="max-sm:flex-1">
            {t('saveDraft', lang)}
          </SubmitButton>
          {!stale && (
            <SubmitButton variant="primary" className="max-sm:flex-1" formAction={publishEdits.bind(null, tpl.id)}>
              {t('publishVersion', lang).replace('{v}', String(tpl.currentVersion + 1))}
            </SubmitButton>
          )}
        </div>
        <p className="mt-2 text-[0.78125rem] text-muted">{t('draftKeepsVersion', lang)}</p>
      </form>

      {draft && (
        <form action={discardDraft.bind(null, tpl.id)} className="mt-3">
          <SubmitButton variant="danger" className="max-sm:w-full">
            {t('discardDraft', lang)}
          </SubmitButton>
        </form>
      )}
    </div>
  )
}
