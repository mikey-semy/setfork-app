'use client'

import { useActionState, useId, useState } from 'react'
import { Flag } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { legalUrl } from '@/shared/docs'
import { OverlayPanel } from '@/shared/ui/OverlayPanel'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { REPORT_BODY_MAX, type ReportReason } from './validate'
import { submitReport, type ReportResult } from './actions'
import { Radio } from '@/shared/ui/checkbox'

const REASONS = [
  { value: 'illegal', label: 'rpReasonIllegal' },
  { value: 'spam', label: 'rpReasonSpam' },
  { value: 'copyright', label: 'rpReasonCopyright' },
  { value: 'privacy', label: 'rpReasonPrivacy' },
  { value: 'other', label: 'rpReasonOther' },
] as const

export function ReportButton({ templateId, lang }: { templateId: string; lang: Lang }) {
  const formId = useId()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ReportReason | ''>('')
  const [state, action, pending] = useActionState<ReportResult, FormData>(submitReport, null)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 text-left text-muted transition-colors hover:text-ink-2"
      >
        <Flag size={14} /> {t('reportList', lang)}
      </button>

      <OverlayPanel
        open={open}
        onClose={() => setOpen(false)}
        title={t('reportTitle', lang)}
        width={440}
        closeLabel={t('close', lang)}
        // Кнопка отправки — в общей нижней полосе окна; форма связана с ней
        // атрибутом `form`, поэтому переносить её наружу не нужно.
        footer={
          state?.ok ? undefined : (
            <Button type="submit" form={formId} variant="primary" disabled={pending}>
              {t('rpSend', lang)}
            </Button>
          )
        }
      >
        {state?.ok ? (
          <div className="text-center">
            <div className="mb-1 text-title font-bold text-ink">{t('rpThanks', lang)}</div>
            <p className="text-body text-ink-2">{t('rpThanksBody', lang)}</p>
          </div>
        ) : (
          <form id={formId} action={action} className="flex flex-col gap-3">
            <p className="text-body-sm text-ink-2">{t('rpIntro', lang)}</p>

            <div className="flex flex-col gap-1.5">
              {REASONS.map((r) => (
                <label key={r.value} className="inline-flex items-center gap-2 text-body text-ink">
                  <Radio
                    name="reason"
                    value={r.value}
                    required
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)} />
                  {t(r.label, lang)}
                </label>
              ))}
            </div>

            {reason === 'copyright' && (
              <p className="rounded-md bg-warn/10 px-3 py-2 text-body-sm leading-relaxed text-ink-2">
                {t('rpCopyrightNote', lang)}{' '}
                <a
                  href={legalUrl('copyright', lang)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-accent hover:underline"
                >
                  Copyright Policy
                </a>
              </p>
            )}

            <Textarea
              name="body"
              required
              minLength={10}
              maxLength={REPORT_BODY_MAX}
              rows={4}
              placeholder={t('rpBodyPlaceholder', lang)}
            />

            <div>
              <Input name="email" type="email" autoComplete="email" placeholder={t('fbEmailPlaceholder', lang)} />
              <p className="mt-1 text-caption text-muted">{t('fbEmailHint', lang)}</p>
            </div>

            {/* Honeypot: люди поле не видят; непустое значение = бот. */}
            <Input type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true" className="absolute -left-[624.9375rem] w-0 opacity-0" />
            <Radio type="hidden" name="templateId" value={templateId} />

            {state?.error && <div className="text-body-sm text-danger">{state.error}</div>}
          </form>
        )}
      </OverlayPanel>
    </>
  )
}
