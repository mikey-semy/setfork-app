'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { Check, GitFork } from 'lucide-react'
import { Field } from '@/shared/ui/Field'
import { Alert } from '@/shared/ui/Alert'
import { forkNameStatus, forkTemplate } from './actions'
import { buttonClass } from '@/shared/ui/button-style'
import { Spinner } from '@/shared/ui/Spinner'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'

export interface ForkLabels {
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

/** Форма форка — «Create a new fork» отдельной СТРАНИЦЕЙ (как GitHub), не модалкой.
 *  Живая проверка доступности имени в пространстве текущего пользователя; отправка
 *  вызывает серверный forkTemplate (редиректит на созданный форк, ошибку возвращает). */
export function ForkForm({
  templateId,
  defaultSlug,
  viewerHandle,
  cancelHref,
  labels,
}: {
  templateId: string
  defaultSlug: string
  viewerHandle: string
  cancelHref: string
  labels: ForkLabels
}) {
  const [name, setName] = useState(defaultSlug)
  const [desc, setDesc] = useState('')
  const [status, setStatus] = useState<{ slug: string; available: boolean } | null>(null)
  const [checking, startCheck] = useTransition()
  const [submitting, startSubmit] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Живая проверка доступности имени (дебаунс). Сброс stale-статуса — в onChange.
  useEffect(() => {
    const h = setTimeout(() => startCheck(async () => setStatus(await forkNameStatus(name))), 350)
    return () => clearTimeout(h)
  }, [name])

  const submit = () =>
    startSubmit(async () => {
      setError(null)
      const res = (await forkTemplate(templateId, { name, description: desc })) as { error?: string } | undefined
      // Успех → сервер редиректит на форк; сюда доходит только ошибка.
      if (res?.error) setError(res.error)
    })

  const canSubmit = !!name.trim() && status?.available === true && !submitting

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-end gap-2">
        <Field label={labels.ownerLabel}>
          <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2 text-body text-ink-2">{viewerHandle}</div>
        </Field>
        <span className="pb-2 text-body-lg text-muted">/</span>
        <Field label={labels.nameLabel} className="min-w-0 flex-1">
          <Input value={name}
            onChange={(e) => {
              setName(e.target.value)
              setStatus(null)
            }}
            spellCheck={false}
            autoCapitalize="off" className="w-full font-mono" />
        </Field>
      </div>

      {/* Индикатор доступности (как «EcoPlay is available ✓» на GitHub). */}
      <div className="-mt-1.5 min-h-4 text-body-sm">
        {checking ? (
          <span className="inline-flex items-center gap-1 text-muted">
            <Spinner size="xs" />
          </span>
        ) : status ? (
          status.available ? (
            <span className="inline-flex items-center gap-1 text-ok">
              <Check size={12} /> <span className="font-mono">{status.slug}</span> — {labels.available}
            </span>
          ) : (
            <span className="text-danger">
              <span className="font-mono">{status.slug}</span> — {labels.taken}
            </span>
          )
        ) : null}
      </div>

      <p className="-mt-2 text-caption leading-snug text-muted">{labels.nameHint}</p>

      <Field label={labels.descLabel}>
        <Textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          rows={2}
          placeholder={labels.descPlaceholder}
          maxLength={350}
          className="resize-none"
        />
      </Field>

      {error && <Alert variant="danger">{error}</Alert>}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3.5">
        <Link href={cancelHref} className={buttonClass()}>
          {labels.cancel}
        </Link>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className={buttonClass({ className: 'border-accent bg-accent text-white disabled:opacity-50' })}
        >
          {submitting && <Spinner size="md" />}
          <GitFork size={14} /> {labels.create}
        </button>
      </div>
    </div>
  )
}
