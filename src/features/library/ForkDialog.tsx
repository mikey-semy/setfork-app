'use client'

import { useEffect, useState, useTransition } from 'react'
import { Check, GitFork, Loader2 } from 'lucide-react'
import { OverlayPanel } from '@/shared/ui/OverlayPanel'
import { forkNameStatus, forkTemplate } from './actions'

export interface ForkLabels {
  fork: string
  title: string
  ownerLabel: string
  nameLabel: string
  nameHint: string
  available: string
  taken: string
  descLabel: string
  descPlaceholder: string
  create: string
  cancel: string
}

/** «Create a new fork» как на GitHub: диалог с именем (живая проверка доступности в
 *  пространстве текущего пользователя) и опциональным описанием — вместо мгновенного
 *  форка с суффиксом `-fork`. Отправка вызывает серверный forkTemplate (он редиректит
 *  на созданный форк; при занятом имени возвращает ошибку). */
export function ForkDialog({
  templateId,
  defaultSlug,
  viewerHandle,
  count,
  grouped = false,
  labels,
}: {
  templateId: string
  defaultSlug: string
  viewerHandle: string
  count?: number
  /** В сплит-группе (кнопка Fork + счётчик-ссылка в дерево форков): без рамки и без счётчика. */
  grouped?: boolean
  labels: ForkLabels
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(defaultSlug)
  const [desc, setDesc] = useState('')
  const [status, setStatus] = useState<{ slug: string; available: boolean } | null>(null)
  const [checking, startCheck] = useTransition()
  const [submitting, startSubmit] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Живая проверка доступности имени (дебаунс), пока панель открыта. Сброс stale-статуса —
  // в onChange инпута (не синхронно в эффекте, чтобы не плодить каскадные рендеры).
  useEffect(() => {
    if (!open) return
    const h = setTimeout(() => startCheck(async () => setStatus(await forkNameStatus(name))), 350)
    return () => clearTimeout(h)
  }, [name, open])

  const submit = () =>
    startSubmit(async () => {
      setError(null)
      const res = (await forkTemplate(templateId, { name, description: desc })) as { error?: string } | undefined
      // Успех → сервер редиректит на форк; сюда доходит только ошибка.
      if (res?.error) setError(res.error)
    })

  const canSubmit = !!name.trim() && status?.available === true && !submitting

  return (
    <>
      <button
        onClick={() => {
          setName(defaultSlug)
          setDesc('')
          setError(null)
          setOpen(true)
        }}
        className={
          grouped
            ? 'inline-flex h-full items-center gap-2 px-3.5 text-[13px] font-semibold text-ink hover:bg-surface-2'
            : 'inline-flex h-9 items-center gap-2 rounded-md border border-border px-3.5 text-[13px] font-semibold text-ink hover:border-border-strong'
        }
      >
        <GitFork size={14} /> <span className="hidden sm:inline">{labels.fork}</span>
        {!grouped && count != null && <span className="font-mono text-[12px] text-muted">{count}</span>}
      </button>

      <OverlayPanel open={open} onClose={() => setOpen(false)} title={labels.title} width={420}>
        <div className="flex flex-col gap-3.5 px-3.5 py-3.5">
          <div className="flex items-end gap-2">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-ink-2">{labels.ownerLabel}</label>
              <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2 text-[13px] text-ink-2">{viewerHandle}</div>
            </div>
            <span className="pb-2 text-[15px] text-muted">/</span>
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-[12px] font-medium text-ink-2">{labels.nameLabel}</label>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setStatus(null)
                }}
                spellCheck={false}
                autoCapitalize="off"
                className="w-full rounded-md border border-border bg-surface px-2.5 py-2 font-mono text-[13px] text-ink outline-hidden focus:border-accent"
              />
            </div>
          </div>

          {/* Индикатор доступности (как «EcoPlay is available ✓» на GitHub). */}
          <div className="-mt-1.5 min-h-[16px] text-[12px]">
            {checking ? (
              <span className="inline-flex items-center gap-1 text-muted">
                <Loader2 size={12} className="animate-spin" />
              </span>
            ) : status ? (
              status.available ? (
                <span className="inline-flex items-center gap-1 text-[color:var(--success,#16a34a)]">
                  <Check size={12} /> <span className="font-mono">{status.slug}</span> — {labels.available}
                </span>
              ) : (
                <span className="text-danger">
                  <span className="font-mono">{status.slug}</span> — {labels.taken}
                </span>
              )
            ) : null}
          </div>

          <p className="-mt-2 text-[11.5px] leading-snug text-muted">{labels.nameHint}</p>

          <div>
            <label className="mb-1 block text-[12px] font-medium text-ink-2">{labels.descLabel}</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={2}
              placeholder={labels.descPlaceholder}
              maxLength={350}
              className="w-full resize-none rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-ink outline-hidden focus:border-accent"
            />
          </div>

          {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-2 text-[12.5px] text-danger">{error}</div>}

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="rounded-md border border-border px-3 py-2 text-[13px] font-semibold text-ink hover:border-border-strong"
            >
              {labels.cancel}
            </button>
            <button
              onClick={submit}
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 rounded-md border border-accent bg-accent px-3.5 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              <GitFork size={14} /> {labels.create}
            </button>
          </div>
        </div>
      </OverlayPanel>
    </>
  )
}
