import { ArrowRight, Sparkles } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { Textarea } from '@/shared/ui/textarea'

/** Функциональная area над лентой (наш аналог Copilot-бокса у GitHub):
 *  описываешь задачу → GET /generate?q=… (форма prefill'ит GenerateForm). */
export function CreateWithAI({ lang }: { lang: Lang }) {
  const ru = lang === 'ru'
  return (
    <form action="/generate" method="get" className="mb-4 rounded-lg border border-border bg-surface p-3">
      {/* Одна строка и короткий плейсхолдер: длинная подсказка с «Например: «…»»
          переносилась на вторую строку. Плейсхолдер и так читается как пример. */}
      <Textarea
        variant="bare"
        name="q"
        rows={1}
        placeholder={ru ? 'подготовить Postgres к проду' : 'prepare Postgres for production'}
      />
      <div className="mt-1.5 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
          <Sparkles size={12} className="text-accent" /> {ru ? 'Черновик проверит сообщество' : 'The community refines the draft'}
        </span>
        <Button type="submit">
          {ru ? 'Создать список' : 'Draft a list'} <ArrowRight size={13} />
        </Button>
      </div>
    </form>
  )
}
