'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { ChatComposer } from './ChatComposer'
import { PanelFoot, PanelHead } from './panel-parts'
import { GnomeAvatar } from './GnomeAvatar'
import { Markdown } from './Markdown'
import { Button } from './button'
import { LAYER, PANEL_PAD } from './control'
import { useViewportBottom } from './use-viewport-bottom'
import { t, type Lang } from '@/shared/i18n'
import { Spinner } from '@/shared/ui/Spinner'

/**
 * Окно чата в углу экрана: лента реплик, подсказки-кнопки и композер.
 *
 * Вид и поведение окна одни на все чаты приложения — раскопку пункта, правку блока,
 * что появится дальше. Разное у них ровно одно: кто отвечает и что делать с ответом,
 * поэтому оболочка ничего об этом не знает — сообщения и обработчик отправки приходят
 * снаружи.
 *
 * Позицию считаем от ВИДИМОГО низа (use-viewport-bottom): при расхождении layout и
 * visual viewport — панели мобильного браузера, открытая клавиатура — окно иначе
 * встаёт посреди экрана. `data-sticky-input` — общий признак нижней панели, по нему
 * кнопка «наверх» садится выше.
 */
export type ChatBubble = { role: 'user' | 'gnome'; text: string; who?: string }

export function ChatDock({
  icon,
  title,
  subtitle,
  messages,
  emptyHint,
  chips,
  pending,
  pendingLabel,
  error,
  value,
  onChange,
  onSend,
  onClose,
  placeholder,
  sendAriaLabel,
  sendTooltip,
  bubbleActions,
  footer,
  lang,
}: {
  icon: ReactNode
  title: string
  /** Строка под заголовком: у раскопки — выбор собеседника, у правки — имя блока. */
  subtitle?: ReactNode
  messages: ChatBubble[]
  emptyHint: string
  /** Готовые вопросы/команды: чат ведут кнопками, без клавиатуры. */
  chips?: string[]
  pending: boolean
  pendingLabel: string
  error?: string
  value: string
  onChange: (v: string) => void
  onSend: (preset?: string) => void
  onClose: () => void
  placeholder: string
  sendAriaLabel: string
  sendTooltip: string
  /** Действия под ответом: «спасибо» и копирование у раскопки, «применить» у правки. */
  bubbleActions?: (index: number, message: ChatBubble) => ReactNode
  /** Постоянная строка под лентой — например, предупреждение о перезаписи. */
  footer?: ReactNode
  lang: Lang
}) {
  const { gap, visibleHeight } = useViewportBottom()
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastReplyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Ответ собеседника → прокрутка к его НАЧАЛУ (читают сверху), свой вопрос и
    // индикатор — вниз. scrollTo по offsetTop, а не scrollIntoView: последний дёргал
    // бы скролл всей страницы.
    const box = scrollRef.current
    if (!box) return
    const last = messages[messages.length - 1]
    if (last?.role === 'gnome' && lastReplyRef.current) box.scrollTo({ top: lastReplyRef.current.offsetTop - 8, behavior: 'smooth' })
    else box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' })
  }, [messages, pending])

  return (
    <div
      data-sticky-input
      style={gap ? { bottom: gap + 16, maxHeight: Math.round(visibleHeight * 0.7) } : undefined}
      className={`fixed right-4 bottom-4 flex cap-screen w-panel-xl cap-viewport flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-card ${LAYER.modal}`}
    >
      <PanelHead
        icon={icon}
        title={
          <>
            <div className="truncate">{title}</div>
            {subtitle}
          </>
        }
        onClose={onClose}
        closeLabel={t('close', lang)}
      />

      <div ref={scrollRef} className={`min-h-30 flex-1 space-y-3 overflow-y-auto ${PANEL_PAD}`}>
        {messages.length === 0 && <p className="text-body-sm leading-relaxed text-muted">{emptyHint}</p>}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-1.5 text-body leading-[1.5] text-primary-fg">{m.text}</div>
            </div>
          ) : (
            <div key={i} ref={i === messages.length - 1 ? lastReplyRef : undefined} className="group flex items-start gap-2">
              <GnomeAvatar src={`/gnomes/${m.who ?? 'generalist'}.webp`} size={32} className="size-8 shrink-0" />
              <div className="min-w-0 rounded-2xl rounded-bl-md bg-surface-2 px-3 py-1.5">
                <Markdown className="text-body leading-[1.5] text-ink-2">{m.text}</Markdown>
                {bubbleActions && (
                  <div className="mt-1 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100">
                    {bubbleActions(i, m)}
                  </div>
                )}
              </div>
            </div>
          ),
        )}
        {pending && (
          <div className="flex items-center gap-2 text-body-sm text-muted">
            <Spinner size="sm" /> {pendingLabel}
          </div>
        )}
        {error && <p className="text-body-sm text-warn">{error}</p>}
        {chips && chips.length > 0 && !pending && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((q) => (
              <Button key={q} variant="outline" size="xs" className="rounded-full font-normal" onClick={() => onSend(q)}>
                {q}
              </Button>
            ))}
          </div>
        )}
        {footer}
      </div>

      <PanelFoot align="stretch">
        <ChatComposer
          value={value}
          onChange={onChange}
          onSend={() => onSend()}
          placeholder={placeholder}
          sendDisabled={!value.trim() || pending}
          pending={pending}
          sendAriaLabel={sendAriaLabel}
          sendTooltip={sendTooltip}
          onEscape={onClose}
        />
      </PanelFoot>
    </div>
  )
}
