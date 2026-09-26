'use client'

import { useState } from 'react'
import { ShieldCheck, Wrench } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { Spinner } from '@/shared/ui/Spinner'
import { ActionResult } from '@/shared/ui/ActionResult'
import { corsCheckText, corsSetupText, type Outcome } from './uploads-cors-text'
import { checkUploadsCorsAction, setupUploadsCorsAction } from './actions'

/**
 * Кнопки «Настроить CORS» и «Проверить» для бакета прямых загрузок. Работают с
 * СОХРАНЁННЫМИ настройками — подсказка говорит сначала сохранить. Сбой самого
 * запроса (сеть, 500) — тоже причина на экране, а не тишина.
 */
export function UploadsCorsPanel({ lang }: { lang: Lang }) {
  const [busy, setBusy] = useState<'setup' | 'check' | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  async function run(kind: 'setup' | 'check') {
    setBusy(kind)
    setOutcome(null)
    try {
      setOutcome(kind === 'setup' ? corsSetupText(await setupUploadsCorsAction(), lang) : corsCheckText(await checkUploadsCorsAction(), lang))
    } catch {
      setOutcome({ ok: false, text: t('admin.uploadsCors.requestFailed', lang) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-body-sm text-muted">{t('admin.uploadsCors.hint', lang)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" touch="grow" onClick={() => run('setup')} disabled={busy !== null}>
          {busy === 'setup' ? <Spinner size="md" /> : <Wrench size={14} />}
          {t('admin.uploadsCors.setup', lang)}
        </Button>
        <Button type="button" touch="grow" onClick={() => run('check')} disabled={busy !== null}>
          {busy === 'check' ? <Spinner size="md" /> : <ShieldCheck size={14} />}
          {t('admin.uploadsCors.check', lang)}
        </Button>
      </div>
      {outcome && <ActionResult ok={outcome.ok}>{outcome.text}</ActionResult>}
    </div>
  )
}
