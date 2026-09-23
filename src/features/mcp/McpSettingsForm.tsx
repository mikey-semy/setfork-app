'use client'

import { useState, useTransition } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Field } from '@/shared/ui/Field'
import { Spinner } from '@/shared/ui/Spinner'
import { t, type Lang } from '@/shared/i18n'
import { setCommiticsMethod } from './admin-actions'

/**
 * Метод Commitics для сценария MCP `commitics`.
 *
 * Поле — адрес списка, как его видно на сайте; сохраняется id найденного списка (см.
 * `setCommiticsMethod`). Состояние «задан, но пропал» показывается отдельно: список
 * удалили или закрыли, и сценарий у агентов уже говорит «метод не настроен».
 */
export function McpSettingsForm({ current, lang }: { current: { address: string | null; broken: boolean }; lang: Lang }) {
  const [value, setValue] = useState(current.address ?? '')
  const [address, setAddress] = useState(current.address)
  const [broken, setBroken] = useState(current.broken)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()

  const save = () =>
    start(async () => {
      setErr(null)
      setSaved(false)
      const r = await setCommiticsMethod(value)
      if ('error' in r) {
        setErr(t(r.error === 'notFound' ? 'admin.mcp.methodNotFound' : 'admin.mcp.methodNotPublic', lang))
        return
      }
      setAddress(r.address)
      setValue(r.address ?? '')
      setBroken(false)
      setSaved(true)
    })

  return (
    <div className="flex flex-col gap-4">
      <Field label={t('admin.mcp.commiticsLabel', lang)} hint={t('admin.mcp.commiticsHint', lang)}>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="handle/slug"
          className="w-panel-lg max-w-full font-mono"
        />
      </Field>
      <p className="text-body-sm text-ink-2">
        {broken
          ? t('admin.mcp.methodBroken', lang)
          : address
            ? `${t('admin.mcp.methodNow', lang)} ${address}`
            : t('admin.mcp.methodUnset', lang)}
      </p>
      <div className="flex items-center gap-3">
        <Button type="button" variant="primary" onClick={save} disabled={pending}>
          {pending ? <Spinner size="md" /> : <Check size={15} />} {t('common.save', lang)}
        </Button>
        {saved && <span className="text-body text-ok">{t('admin.saved', lang)}</span>}
        {err && <span className="text-body text-danger">{err}</span>}
      </div>
    </div>
  )
}
