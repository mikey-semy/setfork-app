'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { ChevronDown, Heart, Loader2, Pickaxe, X } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { ChatComposer } from '@/shared/ui/ChatComposer'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { GnomeAvatar } from '@/shared/ui/GnomeAvatar'
import { Markdown } from '@/shared/ui/Markdown'
import { Tooltip } from '@/shared/ui/Tooltip'
import { CopyButton } from '@/shared/ui/CopyButton'
import { digChatAsk, getDigChatHistory, thankGnome, type DigChatMsg } from './chat-actions'

/**
 * Мини-чат раскопки (редизайн «Копать глубже» по фидбеку владельца): кирка в
 * углу пункта → живой чат в правом нижнем углу. Контекст — список+пункт;
 * дальше любая глубина и направление, собеседник — профильный гном (auto)
 * или выбранный из ростера. Поле ввода — общий ChatComposer (дом гномов, UI):
 * тот же композер, что в чате генерации; остальное на shadcn-примитивах.
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
  const [thanked, setThanked] = useState<Set<number>>(new Set()) // индексы реплик, за которые сказали спасибо
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastReplyRef = useRef<HTMLDivElement>(null)
  const ctxRef = useRef<DigChatOpenDetail | null>(null) // актуальный ctx без stale-замыкания в слушателе

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<DigChatOpenDetail>).detail
      const cur = ctxRef.current
      const isNew = !cur || cur.templateId !== detail.templateId || cur.stepN !== detail.stepN
      ctxRef.current = detail
      setCtx(detail) // апдейтер БЕЗ побочных эффектов (React-варнинг «setState во время рендера»)
      if (isNew) {
        // Другой шаг → грузим ЕГО сессию из БД (беседа сохраняется). Тот же — просто поднять окно.
        setMessages([])
        setFollowups([])
        setErr('')
        void getDigChatHistory(detail.templateId, detail.stepN)
          .then((h) => setMessages((m) => (m.length === 0 ? h : m))) // не перетираем начатую сессию
          .catch(() => {})
      }
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
    aifail: say('The master got stuck — try again.', 'Мастер замешкался — попробуй ещё раз.'),
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
        // Реплик может быть НЕСКОЛЬКО: гном мог реально созвать коллегу — тот входит
        // в чат отдельным участником. Фоллоу-апы берём у ПОСЛЕДНЕГО ответившего.
        setMessages((m) => [...m, ...res.replies.map((r) => ({ role: 'gnome' as const, who: r.who, text: r.text }))])
        setFollowups(res.replies[res.replies.length - 1]?.followups ?? [])
      }
    })
  }

  const thank = (i: number, who: string) => {
    if (thanked.has(i)) return
    setThanked((s) => new Set(s).add(i)) // оптимистично: благодарность — не критичный путь
    void thankGnome(who).catch(() => {})
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
  // Гном ВСЕГДА ведёт вглубь (договорённость с владельцем): если модель не выдала
  // свои NEXT-вопросы (длинный ответ съел бюджет / модель забыла) — не оставляем
  // гостя без направлений, показываем универсальные «копающие» кнопки.
  const deeperFallback = [
    say('Dig deeper', 'Копни глубже'),
    say('What could go wrong?', 'А что может пойти не так?'),
    say('Give an example', 'Приведи пример'),
    say('Any alternatives?', 'Какие есть альтернативы?'),
  ]
  const chips = messages.length === 0 ? starterQuestions : followups.length ? followups : deeperFallback
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
              {gnome === 'auto' ? say('Auto by topic', 'Авто по теме') : `${current?.name ?? gnome}${current?.guild ? ` · ${current.guild}` : ''}`}
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
            {say('Ask anything about this step — reasons, pitfalls, alternatives. The master digs where you point.', 'Спрашивай что угодно про этот пункт — причины, подводные камни, альтернативы. Мастер копает туда, куда покажешь.')}
          </p>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-1.5 text-[13px] leading-[1.5] text-primary-fg">{m.text}</div>
            </div>
          ) : (
            <div key={i} ref={i === messages.length - 1 ? lastReplyRef : undefined} className="group flex items-start gap-2">
              <GnomeAvatar src={`/gnomes/${m.who ?? 'generalist'}.webp`} size={32} className="size-8 shrink-0" />
              <div className="min-w-0 rounded-2xl rounded-bl-md bg-(--surface-2) px-3 py-1.5">
                <Markdown codeCards className="text-[13px] leading-[1.5] text-ink-2">{m.text}</Markdown>
                {/* «Спасибо» гному (одушевление) + копировать — проявляются при наведении. */}
                <div className="mt-1 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <ThankButton who={m.who ?? 'generalist'} thanked={thanked.has(i)} onThank={() => thank(i, m.who ?? 'generalist')} lang={lang} />
                  <CopyButton text={m.text} />
                </div>
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
        {/* Композер — общий дом гномов (UI): то же поле+круглая кнопка+хоткеи, что в
            чате генерации. Esc закрывает окно раскопки (специфика этой поверхности). */}
        <ChatComposer
          value={text}
          onChange={setText}
          onSend={() => send()}
          placeholder={say('Why exactly this way?', 'Почему именно так?')}
          sendDisabled={!text.trim() || pending}
          pending={pending}
          sendAriaLabel={say('Send (Enter)', 'Отправить (Enter)')}
          sendTooltip={say('Enter — send · Shift+Enter — new line · Esc — close', 'Enter — отправить · Shift+Enter — перенос · Esc — закрыть')}
          onEscape={() => setCtx(null)}
        />
      </div>
    </div>
  )
}

/** «Спасибо» гному за реплику (одушевление): сердечко, после клика — заполненное. */
function ThankButton({ who, thanked, onThank, lang }: { who: string; thanked: boolean; onThank: () => void; lang: Lang }) {
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en)
  void who
  return (
    <Tooltip label={thanked ? say('Thanked', 'Спасибо сказано') : say('Say thanks', 'Сказать спасибо')}>
      <button
        type="button"
        aria-label={say('Say thanks', 'Сказать спасибо')}
        onClick={onThank}
        disabled={thanked}
        className={thanked ? 'text-accent' : 'text-muted transition-colors hover:text-accent'}
      >
        <Heart size={13} className={thanked ? 'fill-current' : ''} />
      </button>
    </Tooltip>
  )
}

/** Кирка в углу пункта: открывает чат с контекстом этого шага. hasSession —
 *  точка-индикатор «здесь уже копали» (у пункта есть сохранённая беседа). */
export function DigChatOpen({ detail, label, hasSession }: { detail: DigChatOpenDetail; label: string; hasSession?: boolean }) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={() => window.dispatchEvent(new CustomEvent(DIG_CHAT_EVENT, { detail }))}
        className="relative grid size-7 shrink-0 place-items-center rounded text-muted transition-colors hover:text-accent"
      >
        <Pickaxe size={14} />
        {hasSession && <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-accent" aria-hidden />}
      </button>
    </Tooltip>
  )
}
