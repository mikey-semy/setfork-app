'use client'

import { useActionState, useId, useState } from 'react'
import { AtSign, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { ActionRow, DangerZone as DangerZoneShell } from '@/shared/ui/DangerZone'
import { OverlayPanel } from '@/shared/ui/OverlayPanel'
import { t, type Lang } from '@/shared/i18n'
import { changeHandle, deleteAccount, type ActionResult } from './actions'

export function DangerZone({ lang, handle }: { lang: Lang; handle: string }) {
  const [delState, delAction, delPending] = useActionState<ActionResult | null, FormData>(deleteAccount, null)
  const [hState, hAction, hPending] = useActionState<ActionResult | null, FormData>(changeHandle, null)
  const [dialog, setDialog] = useState<null | 'delete' | 'handle'>(null)
  // Кнопка отправки живёт в футере окна, вне формы: связываем их атрибутом form.
  const handleFormId = useId()

  return (
    <>
      <DangerZoneShell title={t('dangerZone', lang)}>
        {/* Смена ника */}
        <ActionRow
          title={t('changeHandle', lang)}
          sub={
            <span className="inline-flex items-center gap-1.5">
              <AtSign size={12} /> {handle}
            </span>
          }
        >
          <Button variant="danger" size="md" onClick={() => setDialog('handle')} className="border border-danger/40">
            {t('changeHandle', lang)}
          </Button>
        </ActionRow>

        {/* Удаление аккаунта */}
        <ActionRow title={t('deleteAccount', lang)} sub={t('deleteAccountHint', lang)}>
          <Button variant="danger" size="md" onClick={() => setDialog('delete')} className="gap-2 border border-danger/40">
            <Trash2 size={14} /> {t('deleteAccount', lang)}
          </Button>
        </ActionRow>
      </DangerZoneShell>

      {/* Модалка смены ника: ввод НОВОГО значения + предупреждение о ломке ссылок. */}
      <OverlayPanel
        open={dialog === 'handle'}
        onClose={() => setDialog(null)}
        width={460}
        title={
          <span className="inline-flex items-center gap-1.5 text-danger">
            <AtSign size={14} /> {t('changeHandle', lang)}
          </span>
        }
        closeLabel={t('cancel', lang)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              {t('cancel', lang)}
            </Button>
            <Button type="submit" form={handleFormId} variant="dangerSolid" disabled={hPending}>
              {t('changeHandle', lang)}
            </Button>
          </>
        }
      >
        <form id={handleFormId} action={hAction} className="flex flex-col gap-4">
          <p className="text-body leading-relaxed text-ink-2">{t('changeHandleWarn', lang)}</p>
          <label className="flex flex-col gap-1.5 text-body-sm font-semibold text-ink-2">
            {t('changeHandleField', lang)}
            <div className="mt-0.5 flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 focus-within:border-danger">
              <span className="text-muted">@</span>
              <input
                name="handle"
                defaultValue=""
                autoComplete="off"
                spellCheck={false}
                placeholder={handle}
                className="w-full bg-transparent py-2 font-mono text-body text-ink outline-hidden"
              />
            </div>
          </label>
          {hState?.error && <div className="text-body text-danger">{hState.error}</div>}
        </form>
      </OverlayPanel>

      {/* Серверный режим: deleteAccount повторно сверяет поле confirm с ником. */}
      <ConfirmDialog
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        title={t('deleteAccount', lang)}
        intro={t('deleteAccountHint', lang)}
        confirmPhrase={handle}
        confirmHint={t('deleteConfirmLabel', lang)}
        confirmLabel={t('deleteAccount', lang)}
        cancelLabel={t('cancel', lang)}
        busy={delPending}
        error={delState?.error}
        formAction={delAction}
      />
    </>
  )
}
