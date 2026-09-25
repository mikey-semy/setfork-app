'use client'

import { useActionState } from 'react'
import { Download } from 'lucide-react'
import { Input } from '@/shared/ui/input'
import { Alert } from '@/shared/ui/Alert'
import { SubmitButton } from '@/shared/ui/SubmitButton'

/**
 * «Импортировать скилл с GitHub» на странице нового списка. Свёрнуто по умолчанию: основное
 * на этой странице — редактор, импорт — второй путь к тому же черновику.
 */
export function SkillImportForm({
  texts,
  importAction,
}: {
  texts: { title: string; hint: string; button: string; placeholder: string; required: string }
  /** Серверное действие импорта (живёт в app: оно зовёт слой MCP). */
  importAction: (prev: { error: string } | null, formData: FormData) => Promise<{ error: string } | null>
}) {
  const [state, action] = useActionState(importAction, null)
  return (
    <details className="mb-5 rounded-md border border-border bg-surface px-3 py-2" open={state !== null}>
      <summary className="flex cursor-pointer items-center gap-2 text-body font-medium text-ink">
        <Download size={15} aria-hidden /> {texts.title}
      </summary>
      <form action={action} className="mt-3 flex flex-col gap-2">
        <p className="text-caption text-ink-2">{texts.hint}</p>
        {state?.error ? <Alert variant="danger">{state.error === 'url' ? texts.required : state.error}</Alert> : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input name="url" type="text" inputMode="url" required placeholder={texts.placeholder} className="min-w-0 flex-1" />
          <SubmitButton className="shrink-0">
            {texts.button}
          </SubmitButton>
        </div>
      </form>
    </details>
  )
}
