'use client'

import { useState } from 'react'
import { ChevronRight, Copy } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { parseFailure, type AiFailCode } from '@/shared/ai/failure'
import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/ui/toast'

/**
 * «Почему не получилось» — свёрнуто по умолчанию.
 *
 * Человеку, который просто хотел список, техническая причина не нужна и в пузыре только
 * пугала бы. Но и прятать её совсем нельзя: раньше она оставалась в логах воркера, и на
 * вопрос «что случилось?» ответить было нечем. Поэтому: одна тихая строка «Подробности»,
 * а внутри — готовый к пересылке отчёт с кнопкой «Скопировать».
 */

/** Подпись кода человеку. Код в БД машинный — фразу рисует UI, она не протухает при смене языка. */
function reasonLabel(code: AiFailCode, ru: boolean): string {
  const say = (en: string, rus: string) => (ru ? rus : en)
  switch (code) {
    case 'no_client':
      return say('AI provider is not configured', 'Генератор не настроен')
    case 'ai_off':
      return say('Generation is switched off', 'Генерация выключена')
    case 'budget':
      return say('Daily spend cap reached', 'Исчерпан дневной лимит расхода')
    case 'invalid':
      return say('The model answered, but not with a list', 'Модель ответила, но не списком')
    case 'timeout':
      return say('The model did not answer in time', 'Модель не ответила вовремя')
    case 'error':
      return say('The model call failed', 'Сбой вызова модели')
    case 'internal':
      return say('We failed on our side', 'Сбой на нашей стороне')
    case 'lost':
      return say('The job was interrupted (service restart)', 'Задача оборвалась — сервис перезапустился')
  }
}

export function FailureNote({
  raw,
  generationId,
  attempt,
  at,
  lang,
}: {
  raw: string
  generationId: string
  attempt: number
  at: Date | string
  lang: Lang
}) {
  const ru = lang === 'ru'
  const say = (en: string, rus: string) => (ru ? rus : en)
  const [open, setOpen] = useState(false)
  const fail = parseFailure(raw)
  // Старые витки писали реплику ошибки пустой — показывать нечего, строку не рисуем вовсе.
  if (!fail) return null

  const when = new Date(at)
  // Отчёт для пересылки: одно поле в строке, без JSON — его читает человек, а не парсер.
  const report = [
    say('SetFork — could not build the list', 'SetFork — не удалось собрать список'),
    `${say('Reason', 'Причина')}: ${reasonLabel(fail.code, ru)} (${fail.code})`,
    fail.model ? `${say('Model', 'Модель')}: ${fail.model}` : '',
    `${say('Generation', 'Генерация')}: ${generationId} · ${say('attempt', 'виток')} ${attempt}`,
    `${say('Time', 'Время')}: ${Number.isNaN(when.getTime()) ? String(at) : when.toISOString()}`,
    fail.detail ? `${say('Details', 'Подробности')}:\n${fail.detail}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report)
      toast.success(say('Copied', 'Скопировано'))
    } catch {
      // Буфер закрыт политикой браузера — текст на экране, выделить и скопировать можно руками.
      toast.error(say('Could not copy — select the text manually', 'Не удалось скопировать — выдели текст руками'))
    }
  }

  return (
    <div className="pl-[3.25rem]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md py-2 text-[0.6875rem] text-muted hover:text-ink-2 max-sm:min-h-11"
      >
        <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        {say('Details', 'Подробности')}
      </button>
      {open && (
        <div className="mb-1 overflow-hidden rounded-md border border-border bg-surface-2">
          {/* Служебное действие — в правом верхнем углу контейнера (мобильный стандарт),
              а не в потоке под текстом: при переносе строк оно уплывало бы в середину. */}
          <div className="flex items-center justify-between gap-2 border-b border-border py-1 pl-2.5 pr-1">
            <span className="truncate text-[0.6875rem] uppercase tracking-wide text-muted">{say('What happened', 'Что случилось')}</span>
            {/* На узком — только иконка, но тач-цель полная (44px). Именно min-*, а не h/w:
                высота у кнопки уже задана шкалой контролов, а минимум её честно перебивает
                независимо от порядка классов. */}
            <Button
              variant="ghost"
              size="xs"
              onClick={copy}
              aria-label={say('Copy', 'Скопировать')}
              className="max-sm:min-h-11 max-sm:min-w-11 max-sm:px-0"
            >
              <Copy size={13} />
              <span className="max-sm:hidden">{say('Copy', 'Скопировать')}</span>
            </Button>
          </div>
          {/* Перенос вместо горизонтального скролла: длинный ответ модели не должен уносить страницу вбок. */}
          <pre className="whitespace-pre-wrap px-2.5 py-2 font-mono text-[0.6875rem] leading-[1.55] text-ink-2 [overflow-wrap:anywhere]">
            {report}
          </pre>
        </div>
      )}
    </div>
  )
}
