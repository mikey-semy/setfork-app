'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { ChevronDown, Heart, Loader2, Pickaxe, X } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { ChatDock } from '@/shared/ui/ChatDock'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
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
// Сессия шага СОХРАНЕНА (первый ответ гнома записан) — чтобы точку на кирке можно было
// зажечь сразу, без перезагрузки. detail: { templateId, stepN }.
export const DIG_SAVED_EVENT = 'setfork:dig-saved'

export interface GnomeOption {
  id: string
  name: string
  guild: string
}

export function DigChatHost({ gnomes, lang }: { gnomes: GnomeOption[]; lang: Lang }) {
  const [ctx, setCtx] = useState<DigChatOpenDetail | null>(null)
  const [gnome, setGnome] = useState('auto')
  const [messages, setMessages] = useState<DigChatMsg[]>([])
  const [followups, setFollowups] = useState<string[]>([])
  const [thanked, setThanked] = useState<Set<number>>(new Set()) // индексы реплик, за которые сказали спасибо
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
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


  if (!ctx) return null

  const errText: Record<string, string> = {
    ai_off: t('dig.draftingNotConfigured', lang),
    budget: t('dig.aIBudgetExhaustedToday', lang),
    quota: t('dig.yourMonthlyAiQuota', lang),
    ratelimited: t('dig.tooFastWaitMinute', lang),
    aifail: t('dig.theMasterGotStuck', lang),
    'not found': t('dig.stepNotFound', lang),
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
        // Сессия шага сохранена → зажечь точку на кирке сразу (слушают RunView/деталь).
        window.dispatchEvent(new CustomEvent(DIG_SAVED_EVENT, { detail: { templateId: ctx.templateId, stepN: ctx.stepN } }))
      }
    })
  }

  const thank = (i: number, who: string) => {
    if (thanked.has(i)) return
    setThanked((s) => new Set(s).add(i)) // оптимистично: благодарность — не критичный путь
    void thankGnome(who).catch(() => {})
  }

  const current = gnomes.find((g) => g.id === gnome)

  /**
   * Ответ гнома → фрагмент переписки для буфера: предшествующий вопрос и подпись
   * отвечавшего. Копия голого текста теряла, КТО это сказал и НА ЧТО — вставлять
   * такое в задачу или переписку бессмысленно.
   */
  const transcriptOf = (i: number): string => {
    const m = messages[i]
    if (!m) return ''
    const who = gnomes.find((g) => g.id === m.who)?.name ?? m.who ?? t('dig.expert', lang)
    const asked = [...messages.slice(0, i)].reverse().find((x) => x.role === 'user')
    const q = asked ? `**${t('dig.you', lang)}:** ${asked.text}

` : ''
    return `${q}**${who}:** ${m.text}`
  }
  // Готовые вопросы на старте: копать можно вообще без клавиатуры — дальше
  // ведут фоллоу-апы самого гнома (кнопки после каждого ответа).
  const starterQuestions = [
    t('dig.whyExactlyWay', lang),
    t('dig.whatPitfalls', lang),
    t('dig.isThereAlternative', lang),
    t('dig.explainSimpler', lang),
  ]
  // Гном ВСЕГДА ведёт вглубь (договорённость с владельцем): если модель не выдала
  // свои NEXT-вопросы (длинный ответ съел бюджет / модель забыла) — не оставляем
  // гостя без направлений, показываем универсальные «копающие» кнопки.
  const deeperFallback = [
    t('dig.digDeeper', lang),
    t('dig.whatCouldGoWrong', lang),
    t('dig.giveExample', lang),
    t('dig.anyAlternatives', lang),
  ]
  const chips = messages.length === 0 ? starterQuestions : followups.length ? followups : deeperFallback
  // Собеседника выбирают под заголовком: «авто по теме» или конкретный гном ростера.
  const gnomePicker = (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-1 text-[0.6875rem] text-muted hover:text-ink-2">
        {gnome === 'auto' ? t('dig.autoByTopic', lang) : `${current?.name ?? gnome}${current?.guild ? ` · ${current.guild}` : ''}`}
        <ChevronDown size={11} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => setGnome('auto')}>{t('dig.autoByTopic', lang)}</DropdownMenuItem>
        {gnomes.map((g) => (
          <DropdownMenuItem key={g.id} onSelect={() => setGnome(g.id)}>
            {g.name}
            {g.guild && <span className="ml-1.5 text-[0.6875rem] text-muted">{g.guild}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <ChatDock
      icon={<Pickaxe size={14} />}
      title={ctx.stepTitle}
      subtitle={gnomePicker}
      messages={messages}
      emptyHint={t('dig.askAnythingAboutStep', lang)}
      chips={chips}
      pending={pending}
      pendingLabel={t('dig.digging', lang)}
      error={err}
      value={text}
      onChange={setText}
      onSend={(preset) => send(preset)}
      onClose={() => setCtx(null)}
      placeholder={t('dig.whyExactlyWay', lang)}
      sendAriaLabel={t('dig.sendEnter', lang)}
      sendTooltip={t('dig.enterSendShiftEnter', lang)}
      lang={lang}
      bubbleActions={(i, m) => (
        <>
          <ThankButton who={m.who ?? 'generalist'} thanked={thanked.has(i)} onThank={() => thank(i, m.who ?? 'generalist')} lang={lang} />
          {/* Копируем КАК ИЗ ЧАТА: с вопросом и подписью отвечавшего — иначе
              вставленный кусок теряет, кто это сказал и на что. */}
          <CopyButton text={transcriptOf(i)} lang={lang} />
        </>
      )}
    />
  )
}

/** «Спасибо» гному за реплику (одушевление): сердечко, после клика — заполненное. */
function ThankButton({ who, thanked, onThank, lang }: { who: string; thanked: boolean; onThank: () => void; lang: Lang }) {
  void who
  return (
    <Tooltip label={thanked ? t('dig.thanked', lang) : t('dig.sayThanks', lang)}>
      <button
        type="button"
        aria-label={t('dig.sayThanks', lang)}
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
        className="relative grid size-7 shrink-0 place-items-center rounded-md text-muted transition-colors hover:text-accent"
      >
        <Pickaxe size={14} />
        {hasSession && <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-accent" aria-hidden />}
      </button>
    </Tooltip>
  )
}
