'use client'

import { useActionState, useId, useRef, useState, useTransition } from 'react'
import { Archive, Globe, Link2, Lock, Snowflake, Trash2, UserRoundPlus } from 'lucide-react'
import { slugify } from '@/shared/lib/slugify'
import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { ActionRow, DangerZone } from '@/shared/ui/DangerZone'
import { OverlayPanel } from '@/shared/ui/OverlayPanel'
import { t, type Lang } from '@/shared/i18n'
import { cancelTransfer, initiateTransfer, type TransferResult } from '@/features/transfer/actions'
// Прямые модули, а не фасад './actions': бочка тянет в клиентский бандл все экшены
// библиотеки разом (react-doctor/no-barrel-import).
import { deleteListAction, setListArchived, setListFrozen, setListVisibility } from './actions/list-settings'
import { renameList, type RenameResult } from './actions/rename'

// Опасная зона списка (аналог GitHub Danger Zone): опасные действия собраны
// в одном месте, каждое — через модалку. Удаление подтверждается вводом
// ВИДИМОГО идентификатора handle/slug (как «owner/repo»), а не скрытого slug.
export function ListSettingsDanger({
  templateId,
  handle,
  slug,
  title,
  visibility,
  moderation,
  archived,
  frozen,
  pendingTransfer,
  lang,
}: {
  templateId: string
  handle: string
  slug: string
  /** Заголовок на текущем языке — только чтобы предложить адрес по кнопке. */
  title: string
  visibility: 'public' | 'private'
  moderation: string
  archived: boolean
  frozen: boolean
  pendingTransfer: { id: string; toHandle: string } | null
  lang: Lang
}) {
  const [pending, start] = useTransition()
  const [dialog, setDialog] = useState<null | 'visibility' | 'delete' | 'archive' | 'freeze' | 'transfer' | 'rename'>(null)
  // Кнопка отправки живёт в футере окна, вне формы: связываем их атрибутом form.
  const transferFormId = useId()
  const renameFormId = useId()
  const slugInput = useRef<HTMLInputElement>(null)
  const [trState, trAction, trPending] = useActionState<TransferResult | null, FormData>(initiateTransfer.bind(null, templateId), null)
  const [rnState, rnAction, rnPending] = useActionState<RenameResult | null, FormData>(renameList.bind(null, templateId), null)

  const fullName = `${handle}/${slug}` // видимый идентификатор для подтверждения
  const isPublic = visibility === 'public'
  // Снятый модерацией список владелец удалить не может (сервер блокирует — стирание
  // fingerprint'а открывало бы отмывку повторной заливкой). Показываем причину.
  const lockedByModeration = moderation === 'flagged' || moderation === 'hidden'

  return (
    <>
      {/* Pin убран из настроек — теперь кнопкой над списком (шапка, #389). */}

      {/* Опасная зона: обведённая красным рамка со строками-действиями. */}
      <DangerZone title={t('dangerZone', lang)}>
        {/* Видимость */}
        <ActionRow
          title={t('changeVisibility', lang)}
          sub={`${t('visibilityCurrent', lang)} ${t(isPublic ? 'publicLabel' : 'privateLabel', lang).toLowerCase()}.`}
        >
          <Button variant="danger" size="md" onClick={() => setDialog('visibility')} className="border border-danger/40">
            {isPublic ? <Lock size={14} /> : <Globe size={14} />} {t(isPublic ? 'makePrivate' : 'makePublic', lang)}
          </Button>
        </ActionRow>

        {/* Заморозка правок (защита) */}
        <ActionRow title={t(frozen ? 'unfreezeList' : 'freezeList', lang)} sub={t(frozen ? 'frozenOn' : 'freezeHint', lang)}>
          <Button variant="danger" size="md" onClick={() => setDialog('freeze')} className="border border-danger/40">
            <Snowflake size={14} /> {t(frozen ? 'unfreezeList' : 'freezeList', lang)}
          </Button>
        </ActionRow>

        {/* Архив (read-only) */}
        <ActionRow title={t(archived ? 'unarchiveList' : 'archiveList', lang)} sub={t(archived ? 'archivedOn' : 'archiveHint', lang)}>
          <Button variant="danger" size="md" onClick={() => setDialog('archive')} className="border border-danger/40">
            <Archive size={14} /> {t(archived ? 'unarchiveList' : 'archiveList', lang)}
          </Button>
        </ActionRow>

        {/* Передача владения */}
        <ActionRow
          title={t('transferOwnership', lang)}
          sub={pendingTransfer ? `${t('transferPendingTo', lang)} @${pendingTransfer.toHandle}` : t('transferHint', lang)}
        >
          {pendingTransfer ? (
            <Button
              variant="danger"
              size="md"
              onClick={() => start(() => cancelTransfer(pendingTransfer.id))}
              disabled={pending}
              className="border border-danger/40"
            >
              {t('transferCancel', lang)}
            </Button>
          ) : (
            <Button variant="danger" size="md" onClick={() => setDialog('transfer')} className="border border-danger/40">
              <UserRoundPlus size={14} /> {t('transferOwnership', lang)}
            </Button>
          )}
        </ActionRow>

        {/* Смена адреса — прежний продолжает вести сюда же (list_redirects). */}
        <ActionRow title={t('renameList', lang)} sub={t('renameHint', lang)}>
          <Button variant="danger" size="md" onClick={() => setDialog('rename')} className="border border-danger/40">
            <Link2 size={14} /> {t('renameList', lang)}
          </Button>
        </ActionRow>

        {/* Удаление */}
        <ActionRow
          title={t('deleteList', lang)}
          sub={lockedByModeration ? t('deleteLockedModeration', lang) : t('deleteListHint', lang)}
        >
          {!lockedByModeration && (
            <Button variant="danger" size="md" onClick={() => setDialog('delete')} className="border border-danger/40">
              <Trash2 size={14} /> {t('deleteList', lang)}
            </Button>
          )}
        </ActionRow>
      </DangerZone>

      {/* Модалка передачи — ввод ника получателя (реальная смена — при принятии им). */}
      <OverlayPanel
        open={dialog === 'transfer'}
        onClose={() => setDialog(null)}
        width={460}
        title={
          <span className="inline-flex items-center gap-1.5 text-danger">
            <UserRoundPlus size={14} /> {t('transferOwnership', lang)}
          </span>
        }
        closeLabel={t('cancel', lang)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              {t('cancel', lang)}
            </Button>
            <Button type="submit" form={transferFormId} variant="dangerSolid" disabled={trPending}>
              {t('transferOwnership', lang)}
            </Button>
          </>
        }
      >
        <form id={transferFormId} action={trAction} className="flex flex-col gap-4">
          <p className="text-[0.8125rem] leading-relaxed text-ink-2">{t('transferWarn', lang)}</p>
          <label className="flex flex-col gap-1.5 text-[0.78125rem] font-semibold text-ink-2">
            {t('transferRecipientField', lang)}
            <div className="mt-0.5 flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 focus-within:border-danger">
              <span className="text-muted">@</span>
              <input name="toHandle" autoComplete="off" spellCheck={false} className="w-full bg-transparent py-2 font-mono text-[0.8125rem] text-ink outline-hidden" />
            </div>
          </label>
          {trState?.error && <div className="text-[0.8125rem] text-danger">{trState.error}</div>}
          {trState?.ok && <div className="text-[0.8125rem] text-ok">✓</div>}
        </form>
      </OverlayPanel>

      {/* Модалка смены адреса. Заголовок списка тут НЕ трогается: он живёт своей
          жизнью и правится в обычных настройках — здесь только адрес. */}
      <OverlayPanel
        open={dialog === 'rename'}
        onClose={() => setDialog(null)}
        width={460}
        title={
          <span className="inline-flex items-center gap-1.5 text-danger">
            <Link2 size={14} /> {t('renameList', lang)}
          </span>
        }
        closeLabel={t('cancel', lang)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              {t('cancel', lang)}
            </Button>
            <Button type="submit" form={renameFormId} variant="dangerSolid" disabled={rnPending}>
              {t('renameSubmit', lang)}
            </Button>
          </>
        }
      >
        <form key={slug} id={renameFormId} action={rnAction} className="flex flex-col gap-4">
          <p className="text-[0.8125rem] leading-relaxed text-ink-2">{t('renameHint', lang)}</p>
          <div className="text-[0.78125rem] text-ink-2">
            {t('renameCurrent', lang)}: <span className="font-mono text-ink">{fullName}</span>
          </div>
          <label className="flex flex-col gap-1.5 text-[0.78125rem] font-semibold text-ink-2">
            {t('renameNewLabel', lang)}
            <div className="mt-0.5 flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 focus-within:border-danger">
              <span className="shrink-0 font-mono text-muted">{handle}/</span>
              {/* Поле НЕконтролируемое, а начальное значение задаёт key={slug}: копия
                  пропа в useState устаревала бы после переименования (поле показывало бы
                  прежний адрес). Кнопка ниже пишет в него напрямую. */}
              <input
                ref={slugInput}
                name="slug"
                defaultValue={slug}
                autoComplete="off"
                spellCheck={false}
                className="w-full bg-transparent py-2 font-mono text-[0.8125rem] text-ink outline-hidden"
              />
            </div>
          </label>
          {/* Подставить адрес из названия — тем же slugify, что и при создании, поэтому
              человек видит ровно то, что получится, и может поправить руками. */}
          <button
            type="button"
            onClick={() => {
              if (slugInput.current) slugInput.current.value = slugify(title)
            }}
            className="self-start text-[0.78125rem] text-accent hover:underline"
          >
            {t('renameSuggest', lang)}
          </button>
          {rnState?.error && (
            <div className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-danger">
              {rnState.error}
              {/* Занято — но вот свободный похожий: клик подставляет его в поле. */}
              {rnState.suggestion && (
                <button
                  type="button"
                  onClick={() => {
                    if (slugInput.current) slugInput.current.value = rnState.suggestion!
                  }}
                  className="font-mono text-accent hover:underline"
                >
                  {handle}/{rnState.suggestion}
                </button>
              )}
            </div>
          )}
        </form>
      </OverlayPanel>

      {/* Модалка смены видимости — с последствиями, без ввода имени. */}
      <ConfirmDialog
        open={dialog === 'visibility'}
        onClose={() => setDialog(null)}
        title={t(isPublic ? 'makePrivate' : 'makePublic', lang)}
        intro={t(isPublic ? 'makePrivateEffects' : 'makePublicEffects', lang)}
        confirmLabel={t(isPublic ? 'makePrivate' : 'makePublic', lang)}
        cancelLabel={t('cancel', lang)}
        busy={pending}
        onConfirm={() =>
          start(async () => {
            await setListVisibility(templateId, isPublic ? 'private' : 'public')
            setDialog(null)
          })
        }
      />

      {/* Модалка заморозки — обратимо, без ввода имени. */}
      <ConfirmDialog
        open={dialog === 'freeze'}
        onClose={() => setDialog(null)}
        title={t(frozen ? 'unfreezeList' : 'freezeList', lang)}
        intro={t(frozen ? 'unfreezeEffects' : 'freezeEffects', lang)}
        confirmLabel={t(frozen ? 'unfreezeList' : 'freezeList', lang)}
        cancelLabel={t('cancel', lang)}
        busy={pending}
        onConfirm={() =>
          start(async () => {
            await setListFrozen(templateId, !frozen)
            setDialog(null)
          })
        }
      />

      {/* Модалка архива — обратимо, без ввода имени. */}
      <ConfirmDialog
        open={dialog === 'archive'}
        onClose={() => setDialog(null)}
        title={t(archived ? 'unarchiveList' : 'archiveList', lang)}
        intro={t(archived ? 'unarchiveEffects' : 'archiveEffects', lang)}
        confirmLabel={t(archived ? 'unarchiveList' : 'archiveList', lang)}
        cancelLabel={t('cancel', lang)}
        busy={pending}
        onConfirm={() =>
          start(async () => {
            await setListArchived(templateId, !archived)
            setDialog(null)
          })
        }
      />

      {/* Модалка удаления — ввод handle/slug. */}
      <ConfirmDialog
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        title={t('deleteList', lang)}
        intro={t('deleteListCascade', lang)}
        confirmPhrase={fullName}
        confirmHint={t('dangerConfirmHint', lang)}
        confirmLabel={t('deleteList', lang)}
        cancelLabel={t('cancel', lang)}
        busy={pending}
        onConfirm={() => start(() => deleteListAction(templateId))}
      />
    </>
  )
}
