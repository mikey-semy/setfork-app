'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { ChevronDown, Loader2, Pickaxe, SendHorizontal, X } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { Textarea } from '@/shared/ui/textarea'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { GnomeAvatar } from '@/shared/ui/GnomeAvatar'
import { Markdown } from '@/shared/ui/Markdown'
import { digChatAsk, type DigChatMsg } from './chat-actions'

/**
 * Мини-чат раскопки (редизайн «Копать глубже» по фидбеку владельца): кирка в
 * углу пункта → живой чат в правом нижнем углу. Контекст — список+пункт;
 * дальше любая глубина и направление, собеседник — профильный гном (auto)
 * или выбранный из ростера. UI строго на shadcn-примитивах (Button/Textarea/
 * DropdownMenu) — правило проекта.
 *
 * Открытие — CustomEvent 'setfork:dig-chat' от кирки на шаге: один хост на
 * страницу, повторный клик по другому шагу перезапускает сессию с его контекстом.
 */

export interface DigChatOpenDetail {
  templateId: string
  stepN: number
  stepTitle: string
}

export const DIG_CHAT_EVENT = 'setfork:dig-chat'

export interface GnomeOption {
  id: string
  name: string
  guild: string
}

export function DigChatHost({ gnomes, lang }: { gnomes: GnomeOption[]; lang: Lang }) {
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en) // строки-аргументами (i18n-lint)
  const [ctx, setCtx] = useState<DigChatOpenDetail | null>(null)
  const [gnome, setGnome] = useState('auto')
  const [messages, setMessages] = useState<DigChatMsg[]>([])
  const [followups, setFollowups] = useState<string[]>([])
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastReplyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<DigChatOpenDetail>).detail
      setCtx((cur) => {
        // Другой шаг → новая сессия; тот же — просто поднять окно.
        if (!cur || cur.templateId !== detail.templateId || cur.stepN !== detail.stepN) {
          setMessages([])
          setFollowups([])
          setErr('')
        }
        return detail
      })
    }
    window.addEventListener(DIG_CHAT_EVENT, onOpen)
    return () => window.removeEventListener(DIG_CHAT_EVENT, onOpen)
  }, [])

  useEffect(() => {
    // Пришёл ответ гнома → скроллим к его НАЧАЛУ (читают сверху, не с конца);
    // свой вопрос/индикатор — вниз, как обычно. scrollTo по offsetTop, а не
    // scrollIntoView: последний не должен дёргать скролл самой страницы.
    const box = scrollRef.current
    if (!box) return
    const last = messages[messages.length - 1]
    if (last?.role === 'gnome' && lastReplyRef.current) box.scrollTo({ top: lastReplyRef.current.offsetTop - 8, behavior: 'smooth' })
    else box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' })
  }, [messages, pending])

  if (!ctx) return null

  const errText: Record<string, string> = {
    ai_off: say('Drafting is not configured.', 'ИИ не настроен.'),
    budget: say('AI budget is exhausted for today.', 'Дневной бюджет ИИ исчерпан.'),
    quota: say('Your monthly AI quota is used up.', 'Твоя месячная ИИ-квота исчерпана.'),
    ratelimited: say('Too fast — wait a minute.', 'Слишком часто — подожди минуту.'),
    aifail: say('The gnome got stuck — try again.', 'Гном замешкался — попробуй ещё раз.'),
    'not found': say('Step not found.', 'Шаг не найден.'),
  }

  const send = (preset?: string) => {
    const q = (preset ?? text).trim()
    if (!q || pending) return
    setText('')
    setErr('')
    setFollowups([])
    const history = messages
    setMessages((m) => [...m, { role: 'user', text: q }])
    start(async () => {
      const res = await digChatAsk({ templateId: ctx.templateId, stepN: ctx.stepN, gnome, history, question: q, lang })
      if ('error' in res) setErr(errText[res.error] ?? res.error)
      else {
        setMessages((m) => [...m, { role: 'gnome', who: res.who, text: res.text }])
        setFollowups(res.followups)
      }
    })
  }

  const current = gnomes.find((g) => g.id === gnome)
  // Готовые вопросы на старте: копать можно вообще без клавиатуры — дальше
  // ведут фоллоу-апы самого гнома (кнопки после каждого ответа).
  const starterQuestions = [
    say('Why exactly this way?', 'Почему именно так?'),
    say('What are the pitfalls?', 'Какие подводные камни?'),
    say('Is there an alternative?', 'Какая есть альтернатива?'),
    say('Explain it simpler', 'Объясни проще'),
  ]
  const chips = messages.length === 0 ? starterQuestions : followups
  const chipRow = chips.length > 0 && !pending && (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((q) => (
        <Button key={q} variant="outline" size="xs" className="rounded-full font-normal" onClick={() => send(q)}>
          {q}
        </Button>
      ))}
    </div>
  )

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-h-[70dvh] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Pickaxe size={14} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold text-ink">{ctx.stepTitle}</div>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-ink-2">
              {gnome === 'auto' ? say('Gnome: auto by topic', 'Гном: авто по теме') : `${current?.name ?? gnome}${current?.guild ? ` · ${current.guild}` : ''}`}
              <ChevronDown size={11} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => setGnome('auto')}>{say('Auto by topic', 'Авто по теме')}</DropdownMenuItem>
              {gnomes.map((g) => (
                <DropdownMenuItem key={g.id} onSelect={() => setGnome(g.id)}>
                  {g.name}
                  {g.guild && <span className="ml-1.5 text-[11px] text-muted">{g.guild}</span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Button variant="ghost" size="xs" aria-label={say('Close', 'Закрыть')} onClick={() => setCtx(null)}>
          <X size={15} />
        </Button>
      </div>

      <div ref={scrollRef} className="min-h-[120px] flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <p className="text-[12.5px] leading-relaxed text-muted">
            {say('Ask anything about this step — reasons, pitfalls, alternatives. The gnome digs where you point.', 'Спрашивай что угодно про этот пункт — причины, подводные камни, альтернативы. Гном копает туда, куда покажешь.')}
          </p>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-1.5 text-[13px] leading-[1.5] text-primary-fg">{m.text}</div>
            </div>
          ) : (
            <div key={i} ref={i === messages.length - 1 ? lastReplyRef : undefined} className="flex items-start gap-2">
              <GnomeAvatar src={`/gnomes/${m.who ?? 'generalist'}.webp`} size={32} className="size-8 shrink-0" />
              <div className="min-w-0 rounded-2xl rounded-bl-md bg-(--surface-2) px-3 py-1.5">
                <Markdown codeCards className="text-[13px] leading-[1.5] text-ink-2">{m.text}</Markdown>
              </div>
            </div>
          ),
        )}
        {pending && (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <Loader2 size={13} className="animate-spin" /> {say('digging…', 'копает…')}
          </div>
        )}
        {err && <p className="text-[12px] text-warn">{err}</p>}
        {chipRow}
      </div>

      <div className="border-t border-border px-2.5 py-2">
        <div className="relative">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
              if (e.key === 'Escape') setCtx(null)
            }}
            rows={1}
            placeholder={say('Why exactly this way?', 'Почему именно так?')}
            className="max-h-24 min-h-[38px] w-full resize-none pr-10"
          />
          {/* Кнопка ВНУТРИ поля (фидбек владельца): Enter — отправить, Shift+Enter — перенос, Esc — закрыть. */}
          <Button
            variant="ghost"
            size="xs"
            aria-label={say('Send (Enter)', 'Отправить (Enter)')}
            title={say('Enter — send · Shift+Enter — new line · Esc — close', 'Enter — отправить · Shift+Enter — перенос · Esc — закрыть')}
            onClick={() => send()}
            disabled={!text.trim() || pending}
            className="absolute bottom-1.5 right-1.5 text-accent disabled:text-muted"
          >
            <SendHorizontal size={15} />
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Кирка в углу пункта: открывает чат с контекстом этого шага. */
export function DigChatOpen({ detail, label }: { detail: DigChatOpenDetail; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => window.dispatchEvent(new CustomEvent(DIG_CHAT_EVENT, { detail }))}
      className="grid size-7 shrink-0 place-items-center rounded text-muted transition-colors hover:text-accent"
    >
      <Pickaxe size={14} />
    </button>
  )
}
