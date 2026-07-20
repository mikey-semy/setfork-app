'use client'

import { useActionState, useState } from 'react'
import { Flag } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { legalUrl } from '@/shared/docs'
import { OverlayPanel } from '@/shared/ui/OverlayPanel'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { REPORT_BODY_MAX, type ReportReason } from './validate'
import { submitReport, type ReportResult } from './actions'

const REASONS = [
  { value: 'illegal', label: 'rpReasonIllegal' },
  { value: 'spam', label: 'rpReasonSpam' },
  { value: 'copyright', label: 'rpReasonCopyright' },
  { value: 'privacy', label: 'rpReasonPrivacy' },
  { value: 'other', label: 'rpReasonOther' },
] as const

export function ReportButton({ templateId, lang }: { templateId: string; lang: Lang }) {
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

      <OverlayPanel open={open} onClose={() => setOpen(false)} title={t('reportTitle', lang)} width={440}>
        {state?.ok ? (
          <div className="p-4 text-center">
            <div className="mb-1 text-[15px] font-bold text-ink">{t('rpThanks', lang)}</div>
            <p className="text-[13px] text-ink-2">{t('rpThanksBody', lang)}</p>
          </div>
        ) : (
          <form action={action} className="flex flex-col gap-3 p-4">
            <p className="text-[12.5px] text-ink-2">{t('rpIntro', lang)}</p>

            <div className="flex flex-col gap-1.5">
              {REASONS.map((r) => (
                <label key={r.value} className="inline-flex items-center gap-2 text-[13px] text-ink">
                  <input
                    type="radio"
                    name="reason"
                    value={r.value}
                    required
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    className="accent-current"
                  />
                  {t(r.label, lang)}
                </label>
              ))}
            </div>

            {reason === 'copyright' && (
              <p className="rounded-md bg-warn/10 px-3 py-2 text-[12px] leading-relaxed text-ink-2">
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
              <p className="mt-1 text-[11.5px] text-muted">{t('fbEmailHint', lang)}</p>
            </div>

            {/* Honeypot: люди поле не видят; непустое значение = бот. */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute -left-[9999px] h-0 w-0 opacity-0"
            />
            <input type="hidden" name="templateId" value={templateId} />

            {state?.error && <div className="text-[12.5px] text-danger">{state.error}</div>}
            <Button type="submit" variant="primary" disabled={pending} className="px-4 py-2 text-[13px] disabled:opacity-60">
              {t('rpSend', lang)}
            </Button>
          </form>
        )}
      </OverlayPanel>
    </>
  )
}
