'use client'
import { useState } from 'react'
import { CheckCircle2, Loader2, PlugZap } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { Alert } from '@/shared/ui/Alert'
import { Button } from '@/shared/ui/button'
import { mirrorCheckAccess } from './mirror-actions'

/**
 * Ф2: «Проверить доступ» — узнать про неверный токен СЕЙЧАС, а не через сутки по
 * красному статусу.
 *
 * Клиентский компонент, потому что исход показывается на месте: это ответ на
 * нажатие, а не состояние зеркала (статус проверка не трогает — она ничего не
 * меняет на фордже). Форма та же, что у кнопки «Проверить подключение» у
 * провайдеров ИИ: та же пара иконок, тот же `Alert` под кнопкой.
 */
export function MirrorCheckButton({ templateId, lang }: { templateId: string; lang: Lang }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={busy}
        aria-label={t('mirrorCheckAccess', lang)}
        className="min-h-11"
        onClick={async () => {
          setBusy(true)
          setResult(null)
          try {
            const r = await mirrorCheckAccess(templateId)
            setResult({
              ok: r.ok,
              // Текст ошибки приходит из ядра как есть (это вывод git без кредов) —
              // он и есть самое полезное, что можно показать. Подменять его общим
              // «не удалось» значило бы отобрать у владельца единственную подсказку.
              text: r.ok
                ? t('mirrorCheckOk', lang)
                : r.error === 'not-configured'
                  ? t('mirrorCheckNotConfigured', lang)
                  : r.error,
            })
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <PlugZap size={15} />}
        {/* На мобиле только иконка: рядом ещё две кнопки, и три подписи в ряд
            не помещаются в 360px. Название доступно через aria-label. */}
        <span className="hidden md:inline">{t('mirrorCheckAccess', lang)}</span>
      </Button>

      {result && (
        <Alert variant={result.ok ? 'ok' : 'warn'} className="mt-2 w-full">
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {result.ok && <CheckCircle2 size={13} className="mr-1 inline" />}
            {result.text}
          </span>
        </Alert>
      )}
    </>
  )
}
