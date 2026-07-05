import { ArrowRight, Sparkles } from 'lucide-react'
import type { Lang } from '@/shared/i18n'

/** Функциональная area над лентой (наш аналог Copilot-бокса у GitHub):
 *  описываешь задачу → GET /generate?q=… (форма prefill'ит GenerateForm). */
export function CreateWithAI({ lang }: { lang: Lang }) {
  const ru = lang === 'ru'
  return (
    <form action="/generate" method="get" className="mb-4 rounded-lg border border-border bg-surface p-3">
      <textarea
        name="q"
        rows={2}
        placeholder={
          ru
            ? 'Опиши, что нужно сделать — соберём чек-лист. Например: «подготовить Postgres к проду»'
            : 'Describe what you need — we’ll draft a checklist. E.g. “prepare Postgres for production”'
        }
        className="w-full resize-none bg-transparent text-[13.5px] text-ink outline-none placeholder:text-muted"
      />
      <div className="mt-1.5 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
          <Sparkles size={12} className="text-accent" /> {ru ? 'Черновик проверит сообщество' : 'The community refines the draft'}
        </span>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12.5px] font-semibold text-ink hover:border-border-strong"
        >
          {ru ? 'Создать список' : 'Draft a list'} <ArrowRight size={13} />
        </button>
      </div>
    </form>
  )
}
