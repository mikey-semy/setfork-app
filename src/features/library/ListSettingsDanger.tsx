'use client'

import { useState, useTransition } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { t, type Lang } from '@/shared/i18n'
import { deleteListAction } from './actions'

export function ListSettingsDanger({
  templateId,
  slug,
  moderation,
  lang,
}: {
  templateId: string
  slug: string
  moderation: string
  lang: Lang
}) {
  const [pending, start] = useTransition()
  const [confirm, setConfirm] = useState('')
  const matches = confirm.trim() === slug
  // Снятый модерацией список владелец удалить не может (сервер блокирует — стирание
  // fingerprint'а открывало бы отмывку повторной заливкой). Показываем причину.
  const lockedByModeration = moderation === 'flagged' || moderation === 'hidden'

  return (
    <section className="rounded-lg border border-danger/40 bg-danger/5 p-5">
      <div className="mb-4 font-semibold text-danger">{t('dangerZone', lang)}</div>

      {/* Удаление */}
      <div>
        <div className="mb-1 text-[14px] font-medium text-ink">{t('deleteList', lang)}</div>
        {lockedByModeration ? (
          <p className="text-[12.5px] text-ink-2">{t('deleteLockedModeration', lang)}</p>
        ) : (
          <>
            <p className="mb-3 text-[12.5px] text-ink-2">{t('deleteListHint', lang)}</p>
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={slug}
                className="w-[240px] rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[13px] text-ink outline-hidden focus:border-danger"
              />
              <Button
                variant="dangerSolid"
                size="md"
                onClick={() => start(() => deleteListAction(templateId))}
                disabled={!matches || pending}
                className="gap-2"
              >
                <Trash2 size={14} /> {t('deleteList', lang)}
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
