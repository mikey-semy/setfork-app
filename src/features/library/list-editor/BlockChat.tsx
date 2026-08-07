'use client'

import { useState, useTransition } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { ChatDock, type ChatBubble } from '@/shared/ui/ChatDock'
import { iconSizeFor } from '@/shared/ui/control'
import { IconButton } from '@/shared/ui/IconButton'
import { Tooltip } from '@/shared/ui/Tooltip'
import { t, type Lang, type TKey } from '@/shared/i18n'
import { refineBlock } from '../actions'
import type { EditorBlockPatch, EditorItem } from '../editor'

/** Отказ модели → своя строка. Незнакомая причина не выдаётся за известную. */
const REFINE_ERROR: Record<string, TKey> = { ratelimited: 'editor.refineRateLimited', ai_quota: 'editor.refineQuota' }

/**
 * Правка блока разговором: кнопка в углу карточки открывает чат, где просят
 * доработать ИМЕННО этот пункт.
 *
 * Пришла на смену панели «Улучшить» над списком. Та переписывала ВЕСЬ состав по одной
 * фразе и стирала скриншоты — пользоваться ею было страшно, а сформулировать «поправь
 * третий шаг» в такой форме невозможно. Здесь предмет разговора задан самим местом
 * кнопки, а результат виден до применения: предложение приходит репликой, и человек
 * решает, брать его или просить иначе.
 *
 * Оболочка чата — общая (ChatDock), та же, что у раскопки пункта: окно, лента,
 * подсказки и композер живут в одном месте, а фичи приносят только собеседника.
 */
export function BlockChat({
  item,
  context,
  onApply,
  lang,
}: {
  item: EditorItem
  /** Название и описание списка — контекст для модели, чтобы правка не выпадала из темы. */
  context: { title: string; desc: string }
  onApply: (patch: EditorBlockPatch) => void
  lang: Lang
}) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatBubble[]>([])
  // Предложения по индексу реплики: у каждой своя кнопка «Применить».
  const [patches, setPatches] = useState<Record<number, EditorBlockPatch>>({})
  const [applied, setApplied] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()

  const send = (preset?: string) => {
    const ask = (preset ?? text).trim()
    if (!ask || pending) return
    setText('')
    setError('')
    setMessages((m) => [...m, { role: 'user', text: ask }])
    start(async () => {
      const res = await refineBlock({
        block: {
          title: item.title,
          desc: item.desc,
          command: item.command,
          level: item.level,
          why: item.why,
          subtasks: item.subtasks,
          refs: item.refs,
        },
        instruction: ask,
        context,
      })
      if ('error' in res) {
        setError(t(REFINE_ERROR[res.error] ?? 'editor.refineFailed', lang))
        return
      }
      setMessages((m) => {
        const next = [...m, { role: 'gnome' as const, text: preview(res.block, lang) }]
        setPatches((p) => ({ ...p, [next.length - 1]: res.block }))
        return next
      })
    })
  }

  const label = t('editor.improveBlock', lang)
  return (
    <>
      <Tooltip label={label}>
        <IconButton variant="ghost" size="sm" label={label} onClick={() => setOpen(true)} className="text-muted hover:text-accent">
          <Sparkles size={iconSizeFor('sm')} />
        </IconButton>
      </Tooltip>
      {open && (
        <ChatDock
          icon={<Sparkles size={14} />}
          title={item.title.trim() || t('editor.improveBlock', lang)}
          messages={messages}
          emptyHint={t('editor.improveBlockHint', lang)}
          chips={messages.length === 0 ? [t('editor.chipClearer', lang), t('editor.chipShorter', lang), t('editor.chipAddCommand', lang), t('editor.chipWhy', lang)] : undefined}
          pending={pending}
          pendingLabel={t('editor.refining', lang)}
          error={error}
          value={text}
          onChange={setText}
          onSend={send}
          onClose={() => setOpen(false)}
          placeholder={t('editor.improveBlockPh', lang)}
          sendAriaLabel={t('dig.sendEnter', lang)}
          sendTooltip={t('dig.enterSendShiftEnter', lang)}
          lang={lang}
          bubbleActions={(i) =>
            patches[i] ? (
              <IconButton
                size="sm"
                variant="ghost"
                label={t('editor.applyToBlock', lang)}
                className={applied === i ? 'text-ok' : ''}
                onClick={() => {
                  onApply(patches[i])
                  setApplied(i)
                }}
              >
                <Check size={iconSizeFor('sm')} />
              </IconButton>
            ) : null
          }
        />
      )}
    </>
  )
}

/** Предложение модели — читаемой репликой: что станет с полями блока. */
function preview(patch: EditorBlockPatch, lang: Lang): string {
  const lines = [`**${patch.title || t('editor.untitledBlock', lang)}**`]
  if (patch.desc.trim()) lines.push(patch.desc)
  if (patch.command.trim()) lines.push('```\n' + patch.command + '\n```')
  if (patch.why.trim()) lines.push(`_${t('editor.why', lang)}: ${patch.why}_`)
  if (patch.subtasks.filter((s) => s.trim()).length) lines.push(patch.subtasks.filter((s) => s.trim()).map((s) => `- ${s}`).join('\n'))
  return lines.join('\n\n')
}
