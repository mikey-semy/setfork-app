'use client'

import { useState, useTransition } from 'react'
import { Loader2, Pin, PinOff, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { t, type Lang } from '@/shared/i18n'
import { deleteListAction, setListPinned } from './actions'

export function ListSettingsDanger({
  templateId,
  slug,
  moderation,
  pinned,
  lang,
}: {
  templateId: string
  slug: string
  moderation: string
  pinned: boolean
  lang: Lang
}) {
  const [pending, start] = useTransition()
  const [pinPending, startPin] = useTransition()
  const [confirm, setConfirm] = useState('')
  const matches = confirm.trim() === slug
  // Снятый модерацией список владелец удалить не может (сервер блокирует — стирание
  // fingerprint'а открывало бы отмывку повторной заливкой). Показываем причину.
  const lockedByModeration = moderation === 'flagged' || moderation === 'hidden'

  return (
    <>
    <section className="mb-6 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Pin size={17} className="mt-0.5 text-ink-2" />
          <div>
            <div className="text-[14px] font-medium text-ink">{t('pinToProfile', lang)}</div>
            <p className="text-[12.5px] text-ink-2">{pinned ? t('pinnedOn', lang) : t('pinHint', lang)}</p>
          </div>
        </div>
        <button
          onClick={() => startPin(() => setListPinned(templateId, !pinned))}
          disabled={pinPending}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3.5 py-2 text-[13px] font-semibold text-ink hover:border-border-strong disabled:opacity-60"
        >
          {pinPending ? <Loader2 size={14} className="animate-spin" /> : pinned ? <PinOff size={14} /> : <Pin size={14} />}
          {pinned ? t('unpin', lang) : t('pin', lang)}
        </button>
      </div>
    </section>

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
    </>
  )
}
