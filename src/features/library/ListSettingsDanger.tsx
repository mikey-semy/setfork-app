'use client'

import { useState, useTransition } from 'react'
import { Globe, Loader2, Lock, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { t, type Lang } from '@/shared/i18n'
import { deleteListAction, setListVisibility } from './actions'

// Опасная зона списка (аналог GitHub Danger Zone): опасные действия собраны
// в одном месте, каждое — через модалку. Удаление подтверждается вводом
// ВИДИМОГО идентификатора handle/slug (как «owner/repo»), а не скрытого slug.
export function ListSettingsDanger({
  templateId,
  handle,
  slug,
  visibility,
  moderation,
  lang,
}: {
  templateId: string
  handle: string
  slug: string
  visibility: 'public' | 'private'
  moderation: string
  lang: Lang
}) {
  const [pending, start] = useTransition()
  const [dialog, setDialog] = useState<null | 'visibility' | 'delete'>(null)
  const fullName = `${handle}/${slug}` // видимый идентификатор для подтверждения
  const isPublic = visibility === 'public'
  // Снятый модерацией список владелец удалить не может (сервер блокирует — стирание
  // fingerprint'а открывало бы отмывку повторной заливкой). Показываем причину.
  const lockedByModeration = moderation === 'flagged' || moderation === 'hidden'

  const row = 'flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0'

  return (
    <>
      {/* Pin убран из настроек — теперь кнопкой над списком (шапка). */}
      {/* Опасная зона: обведённая красным рамка со строками-действиями. */}
      <section className="overflow-hidden rounded-lg border border-danger/40">
        <div className="border-b border-danger/40 bg-danger/5 px-5 py-2.5 font-semibold text-danger">{t('dangerZone', lang)}</div>
        <div className="divide-y divide-border px-5">
          {/* Видимость */}
          <div className={row}>
            <div className="min-w-0">
              <div className="text-[14px] font-medium text-ink">{t('changeVisibility', lang)}</div>
              <p className="mt-0.5 inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
                {isPublic ? <Globe size={12} /> : <Lock size={12} />}
                {t('visibilityCurrent', lang)} {t(isPublic ? 'publicLabel' : 'privateLabel', lang).toLowerCase()}.
              </p>
            </div>
            <Button variant="danger" size="md" onClick={() => setDialog('visibility')} className="border border-danger/40">
              {t(isPublic ? 'makePrivate' : 'makePublic', lang)}
            </Button>
          </div>

          {/* Удаление */}
          <div className={row}>
            <div className="min-w-0">
              <div className="text-[14px] font-medium text-ink">{t('deleteList', lang)}</div>
              <p className="mt-0.5 text-[12.5px] text-ink-2">
                {lockedByModeration ? t('deleteLockedModeration', lang) : t('deleteListHint', lang)}
              </p>
            </div>
            {!lockedByModeration && (
              <Button variant="danger" size="md" onClick={() => setDialog('delete')} className="gap-2 border border-danger/40">
                <Trash2 size={14} /> {t('deleteList', lang)}
              </Button>
            )}
          </div>
        </div>
      </section>

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
