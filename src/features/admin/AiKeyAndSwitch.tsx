'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Switch } from '@/shared/ui/switch'

/** Ключ OpenRouter (маскированный) + переключатель генерации.
 *  Переключатель активен только когда ключ уже задан или введён в поле.
 *  Полный ключ на клиент не приходит — показываем лишь маску существующего. */
export function AiKeyAndSwitch({
  enabled,
  hasKey,
  maskedKey,
  ru,
}: {
  enabled: boolean
  hasKey: boolean
  maskedKey: string
  ru: boolean
}) {
  const [keyInput, setKeyInput] = useState('')
  const [reveal, setReveal] = useState(false)
  const [on, setOn] = useState(enabled && hasKey)

  const canEnable = hasKey || keyInput.trim().length > 0
  const checked = on && canEnable

  const lbl = 'mb-1.5 block text-[12.5px] font-semibold text-ink-2'

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[14px] font-medium text-ink">{ru ? 'Черновики включены' : 'Drafting enabled'}</div>
          <p className="text-[12px] text-muted">
            {canEnable
              ? ru
                ? 'Списки можно придумывать автоматически.'
                : 'Lists can be drafted automatically.'
              : ru
                ? 'Сначала укажите API-ключ ниже.'
                : 'Enter an API key below first.'}
          </p>
        </div>
        <Switch name="enabled" checked={checked} onCheckedChange={setOn} disabled={!canEnable} />
      </div>

      <div>
        <label className={lbl}>{ru ? 'API-ключ OpenRouter' : 'OpenRouter API key'}</label>
        <div className="relative">
          <input
            name="apiKey"
            type={reveal ? 'text' : 'password'}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={hasKey ? maskedKey : 'sk-or-v1-…'}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 pr-10 font-mono text-[13px] text-ink outline-hidden focus:border-border-strong"
          />
          <button
            type="button"
            aria-label={reveal ? 'hide' : 'show'}
            onClick={() => setReveal((v) => !v)}
            className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-muted hover:text-ink"
          >
            {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        <p className="mt-1.5 text-[12px] text-muted">
          {hasKey
            ? ru
              ? 'Ключ сохранён (показан замаскированным). Оставьте поле пустым, чтобы не менять.'
              : 'Key saved (shown masked). Leave blank to keep it.'
            : ru
              ? 'Ключ хранится в БД и используется для генерации и эмбеддингов.'
              : 'Stored in the DB, used for generation and embeddings.'}
        </p>
      </div>
    </div>
  )
}
