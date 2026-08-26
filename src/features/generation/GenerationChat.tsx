'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronRight, RotateCw } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import type { GenerationCandidate } from '@/shared/db'
import type { GenMessage } from '@/shared/ai/generation-messages'
import type { GenerationStatus } from './queries'
import { LIST_KINDS, kindLabel, refineHint } from '@/shared/ai/list-kind'
import { Chip } from '@/shared/ui/Chip'
import { DETAIL_LEVELS, detailLabel, toDetail } from '@/shared/ai/detail-level'
import { CouncilBubble } from './CouncilBubble'
import { MAX_VARIANTS } from './limits'
import { FailureNote } from './FailureNote'
import { CandidateCard } from './CandidateCard'
import { ActionsMenu } from './ActionsMenu'
import { ProvenancePanel } from './ProvenancePanel'
import { ChatComposer } from '@/shared/ui/ChatComposer'
import { acceptCandidate, answerClarify, refineInChat, regenerateCandidate, setGenerationDetail, setGenerationKind } from './actions'
import { t } from '@/shared/i18n'
import { PAGE } from '@/shared/ui/control'

/** Первая буква — заглавная: hint приходит от модели строчными, а это готовое сообщение. */
const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/**
 * Индикатор работы совета — это НЕ реплика (фидбек владельца): без аватара и
 * пузыря, лёгкая строка с анимацией из трёх точек (без текстового «…»). Фразы
 * в характере мастерской и МЕНЯЮТСЯ, пока идёт генерация — «совет живой».
 */
const THINKING_LINES: [string, string][] = [
  ['The council confers', 'Совет совещается'],
  ['Digging the archives', 'Копаемся в архивах'],
  ['Weighing the options', 'Взвешиваем варианты'],
  ['Forging the list', 'Куём список'],
  ['Arguing over details', 'Спорим до искр'],
  ['Sorting it onto shelves', 'Раскладываем по полочкам'],
  ['Hunting for pitfalls', 'Ищем подводные камни'],
]

function ThinkingIndicator({ ru, slow, slowText }: { ru: boolean; slow: boolean; slowText: string }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (slow) return
    const t = setInterval(() => setI((v) => (v + 1) % THINKING_LINES.length), 2600)
    return () => clearInterval(t)
  }, [slow])
  const text = slow ? slowText : THINKING_LINES[i][ru ? 1 : 0]
  return (
    <div className="flex items-center gap-2 pl-1 text-body-sm text-muted">
      <span className="inline-flex items-center gap-[0.1875rem]">
        {[0, 200, 400].map((d) => (
          <span key={d} className="size-[0.25rem] animate-pulse rounded-full bg-current opacity-60" style={{ animationDelay: `${d}ms` }} />
        ))}
      </span>
      <span className="transition-opacity">{text}</span>
    </div>
  )
}

/**
 * Экран генерации — беседа, от первой реплики до результата.
 *
 * Почему так: раньше это был «лоадер, потом результат с табами вариантов», и четыре
 * взаимоисключающие ветки флагов (showGnome / showClarify / showRetry / genFailed). Теперь шелл один:
 * что бы ни происходило — это очередная реплика. Варианты не подменяют друг друга, а остаются в
 * истории: «никогда не теряю то, что генерировал».
 *
 * История живёт в БД (generation_messages), поэтому ушёл и вернулся — видишь продолжение, а не пустоту.
 */

// Пока идёт — следим часто; после DEGRADE_AFTER_MS реже. НЕ сдаёмся совсем: джоба живая, врать
// «зависло» неправильно — честнее сказать «идёт в фоне» и дождаться.
const POLL_FAST_MS = 2000
const POLL_SLOW_MS = 10_000
const DEGRADE_AFTER_MS = 2 * 60_000

/** Реплики совета — второстепенное: их сворачиваем. Реплики пользователя и карточка — нет.
 *  'reply' — ответ гнома на реплику человека (диалог): живёт в той же нити витка. */
const COUNCIL_KINDS = new Set<GenMessage['kind']>(['plan', 'summon', 'seek', 'draft', 'innovate', 'critique', 'synth', 'reply'])

/** Ход совета: пока виток идёт — раскрыт (это и есть лоадер), отработал — свёрнут в одну строку. */
function CouncilTrail({ messages, lang, defaultOpen, avatars, repBadges }: { messages: GenMessage[]; lang: Lang; defaultOpen: boolean; avatars: Record<string, string>; repBadges: Record<string, string> }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md py-0.5 text-caption text-muted hover:text-ink-2"
      >
        <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        {t('generation.councilLines', lang).replace('{n}', String(messages.length))}
      </button>
      {open && (
        <ol className="mt-2 flex flex-col gap-3">
          {messages.map((m) => (
            <li key={m.id} className="animate-fadein">
              <CouncilBubble
                who={m.who ?? undefined}
                name={m.name ?? undefined}
                badge={m.who ? repBadges[m.who] : undefined}
                badgeTitle={t('generation.shareCouncilListsPeople', lang)}
                src={m.who ? avatars[m.who] : undefined}
              >
                {m.text}
              </CouncilBubble>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

interface Props {
  generationId: string
  lang: Lang
  candidates: GenerationCandidate[]
  status: GenerationStatus
  messages: GenMessage[]
  /** Тип списка (ADR-0010) — подсвечиваем в переключателе; null у старых генераций. */
  listKind: string | null
  /** Объём (short/normal/detailed); null у старых генераций → обычный. */
  detail: string | null
  /** id → своя картинка эксперта (сменили в админке). Нет записи → встроенная по who. */
  avatars: Record<string, string>
  /** id → отображаемое имя гнома на языке зрителя (для родословной, где хранится только id). */
  gnomeNames: Record<string, string>
  /** who → бейдж репутации «✓ N%» (HQ §6) — считается на сервере, ниже порога записи нет. */
  repBadges: Record<string, string>
  error?: string
  clarifyQuestions?: string[]
}

export function GenerationChat({ generationId, lang, candidates, status, messages, listKind, detail, avatars, gnomeNames, repBadges, error, clarifyQuestions }: Props) {
  const detailNow = toDetail(detail)
  const ru = lang === 'ru'
  const router = useRouter()
  const [pending, start] = useTransition()

  const last = candidates[candidates.length - 1]
  const [selId, setSelId] = useState<string | undefined>(last?.id)
  const [note, setNote] = useState('')
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [slow, setSlow] = useState(false)
  const startedAt = useRef(0) // ставим в эффекте: Date.now() в рендере — нечистый вызов

  const working = status === 'pending' || pending
  const showClarify = status === 'clarify' && !!clarifyQuestions?.length && !pending

  // Новый вариант приехал — выбираем его: обычно смотрят на свежий.
  const [seenLast, setSeenLast] = useState(last?.id)
  if (last?.id !== seenLast) {
    setSeenLast(last?.id)
    setSelId(last?.id)
  }

  // Поллинг лёгкого JSON: как только беседа/статус сдвинулись — обновляем страницу.
  // router.refresh() раньше дёргался сам по себе раз в 2.5с и перерисовывал всё; теперь он
  // срабатывает только по факту изменения.
  useEffect(() => {
    if (status !== 'pending') {
      setSlow(false)
      startedAt.current = 0
      return
    }
    if (!startedAt.current) startedAt.current = Date.now()
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (stop) return
      const degraded = Date.now() - startedAt.current > DEGRADE_AFTER_MS
      setSlow(degraded)
      try {
        const r = await fetch(`/api/generate/${generationId}/live`, { cache: 'no-store' })
        if (r.ok) {
          const d: { status: GenerationStatus; messages: GenMessage[] } = await r.json()
          if (d.status !== 'pending' || d.messages.length !== messages.length) router.refresh()
        }
      } catch {
        // Сеть моргнула — не страшно, повторим на следующем тике.
      }
      if (!stop) timer = setTimeout(tick, degraded ? POLL_SLOW_MS : POLL_FAST_MS)
    }
    timer = setTimeout(tick, POLL_FAST_MS)
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [status, generationId, messages.length, router])

  const submitNote = () => {
    const t = note.trim()
    if (!t || working) return
    setNote('')
    start(() => refineInChat(generationId, t))
  }

  const byAttempt = (n: number) => candidates.find((c) => c.idx === n)
  // Витки — по репликам И по кандидатам: кандидат без реплик (старые генерации, чужой воркер)
  // обязан остаться видимым, иначе получается «потерял то, что сгенерировал».
  const attempts = [...new Set([...messages.map((m) => m.attempt), ...candidates.map((c) => c.idx)])].sort((a, b) => a - b)
  const errText: Record<string, string> = {
    ratelimited: t('generation.tooManyRequestsPlease', lang),
    variantcap: t('generation.variantLimit', lang).replace('{n}', String(MAX_VARIANTS)),
    ai_quota: t('generation.monthlyDraftLimitReached2', lang),
    list_quota: t('generation.listLimitReachedDelete', lang),
    aifail: t('generation.couldNotComeUp', lang),
  }

  return (
    // Контейнер минимум во весь экран под шапкой (она sticky, 53px) — иначе на коротком чате
    // sticky-поле ввода прижималось бы к концу текста, а не к низу окна, как в мессенджерах.
    // Ширина — общая рамка сайта (была своя, 1040): на десктопе половина экрана
    // пустовала при 720, а своя ширина у одной страницы — тот же разнобой.
    <div className={`${PAGE} flex min-h-[calc(100dvh-53px)] flex-col`}>
      {/* Переключатель типа списка (ADR-0010): не тот тип? — жми, будет новый вариант в нужной форме.
          Дешевле и без трения, чем уточняющий вопрос; каждый клик — сигнал, что автоугадывание промахнулось.
          На узком — горизонтальный скролл, на sm+ — перенос строк: пилюли не должны уходить за экран. */}
      <div className="no-scrollbar -mx-4 mb-4 flex items-center gap-1.5 overflow-x-auto px-4 sm:-mx-6 sm:flex-wrap sm:overflow-x-visible sm:px-6">
        {LIST_KINDS.map((k) => (
          <Chip
            key={k}
            onClick={() => k !== listKind && start(() => setGenerationKind(generationId, k))}
            disabled={working}
            selected={k === listKind}
          >
            {kindLabel(k, ru)}
          </Chip>
        ))}
        <span className="mx-1 h-4 w-px shrink-0 bg-border" />
        {/* Объём — вторая ось рядом с типом: «слишком куце / слишком много» лечится одним
            кликом, новый вариант приходит в ленту, старые остаются для сравнения. */}
        {DETAIL_LEVELS.map((lv) => (
          <Chip
            key={lv}
            onClick={() => lv !== detailNow && start(() => setGenerationDetail(generationId, lv))}
            disabled={working}
            selected={lv === detailNow}
          >
            {detailLabel(lv, ru)}
          </Chip>
        ))}
      </div>

      {error && errText[error] && (
        <div className="mb-3 rounded-md border border-warn/50 bg-surface px-3 py-2 text-body-sm text-warn">{errText[error]}</div>
      )}

      {/* Беседа. flex-1 — забирает всё свободное место, чтобы поле ввода ушло вниз окна. */}
      <ol className="flex flex-1 flex-col gap-3">
        {attempts.map((n) => {
          const mine = messages.filter((m) => m.attempt === n)
          const said = mine.filter((m) => m.kind === 'user' || m.kind === 'again')
          const trail = mine.filter((m) => COUNCIL_KINDS.has(m.kind))
          // Последняя, а не первая: задача ретраится (maxAttempts: 2), и причина второго
          // падения свежее — показывать надо её.
          const failMsg = mine.filter((m) => m.kind === 'error').at(-1)
          const failed = !!failMsg
          const cand = byAttempt(n)
          return (
            <li key={n} className="flex flex-col gap-3">
              {said.map((m) => (
                <div key={m.id} className="flex animate-fadein justify-end">
                  {/* Кап 640px: на широком контейнере пузырь на 85% превращался в строку во весь экран. */}
                  <div className="w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-body leading-[1.5] text-primary-fg sm:max-w-prose">
                    {m.kind === 'again' ? t('generation.anotherVariant', lang) : m.text}
                  </div>
                </div>
              ))}
              {/* Ход совета — второстепенное: свёрнут, когда виток уже отработал. Пока идёт — раскрыт. */}
              {trail.length > 0 && <CouncilTrail messages={trail} lang={lang} defaultOpen={!cand && !failed} avatars={avatars} repBadges={repBadges} />}
              {failMsg && (
                <div>
                  <CouncilBubble who="council" name={t('generation.council', lang)}>
                    <span className="text-warn">{t('generation.couldNotFinishOne', lang)}</span>
                  </CouncilBubble>
                  {/* Причина — свёрнутой: человеку она не нужна, но открыть и переслать нам он может. */}
                  <FailureNote raw={failMsg.text} generationId={generationId} attempt={n} at={failMsg.createdAt} lang={lang} />
                </div>
              )}
              {cand && (
                <div id={`cand-${cand.id}`} className="animate-fadein">
                  {/* «Что поменялось ключевое» — берём у самого кандидата: реплики может не быть
                      (старые генерации), а вариант обязан быть виден всегда. */}
                  {cand.summary && <div className="mb-1 pl-1 text-caption text-muted">{cand.summary}</div>}
                  <CandidateCard cand={cand} selected={cand.id === selId} onSelect={() => setSelId(cand.id)} lang={lang} />
                  {/* Родословная (HQ §6): под карточкой, а не внутри — карточка сама <button>,
                      вложенные интерактивы в неё класть нельзя. */}
                  <ProvenancePanel provenance={cand.provenance ?? {}} gnomeNames={gnomeNames} lang={lang} />
                </div>
              )}
            </li>
          )
        })}

        {working && (
          <li className="animate-fadein">
            <ThinkingIndicator ru={ru} slow={slow} slowText={t('generation.stillWorkingRunsBackground', lang)} />
          </li>
        )}

        {showClarify && (
          <li className="animate-fadein">
            <CouncilBubble who="reporter" name={t('common.reporter', lang)}>
              {t('generation.aCoupleDetailsList', lang)}
            </CouncilBubble>
            <div className="mt-2 space-y-3 pl-13">
              {/* Вопрос может нести быстрые варианты после «|»: «Какой стек? | Node.js | Docker».
                  Чип — ответ в один клик (кладёт значение в поле: можно уточнить руками). */}
              {(clarifyQuestions ?? []).map((raw, i) => {
                const [q, ...opts] = raw.split('|').map((s) => s.trim()).filter(Boolean)
                return (
                  <div key={i}>
                    <label className="mb-1 block text-body-sm text-ink-2">{q}</label>
                    <input
                      value={answers[i] ?? ''}
                      onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
                      className="w-full rounded-md border border-border bg-surface px-3 py-2 text-body text-ink outline-hidden focus:border-border-strong"
                    />
                    {opts.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {opts.map((o) => (
                          <button
                            key={o}
                            type="button"
                            onClick={() => setAnswers((a) => ({ ...a, [i]: o }))}
                            className={`rounded-full border px-3 py-1 text-body-sm transition-colors ${
                              (answers[i] ?? '') === o ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-2 hover:text-ink'
                            }`}
                          >
                            {o}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
              <button
                type="button"
                onClick={() =>
                  start(() =>
                    answerClarify(
                      generationId,
                      (clarifyQuestions ?? []).map((_, i) => (answers[i] ?? '').trim()),
                    ),
                  )
                }
                disabled={pending}
                className="rounded-md bg-primary px-3.5 py-2 text-body font-semibold text-primary-fg disabled:opacity-50"
              >
                {t('generation.send', lang)}
              </button>
            </div>
          </li>
        )}
      </ol>

      {/* Дополнить прямо здесь: реплика уходит в нить, следующий вариант учитывает ВСЮ беседу.
          Композер как у ChatGPT/Claude (фидбек владельца со скринов): кнопки ВНУТРИ поля —
          «+» (действия с вариантами) слева, отправка справа; над полем — чипы дальнейших
          действий, появляются сами вместе с готовым вариантом. */}
      <div data-sticky-input className="sticky bottom-0 -mx-4 mt-4 border-t border-border bg-canvas/85 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        {/* Ряд действий нужен и когда варианта НЕТ: сорвалось — «ещё раз» единственный
            выход, а раньше при провале ряд не рисовался вовсе и на экране не оставалось
            ни одной кнопки (фидбек владельца со скрина). */}
        {!working && (last || status === 'failed') && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {last && (
              <Chip disabled={!selId} onClick={() => selId && start(() => acceptCandidate(generationId, selId))} selected className="font-medium">
                <Check size={13} /> {t('generation.useOne', lang)}
              </Chip>
            )}
            {candidates.length < MAX_VARIANTS && (
              <Chip onClick={() => start(() => regenerateCandidate(generationId))}>
                {/* Сравнивать нечего — значит это не «ещё вариант», а повтор того же запроса. */}
                <RotateCw size={13} /> {last ? t('generation.anotherVariant', lang) : t('generation.tryAgain', lang)}
              </Chip>
            )}
            {(last?.hint || '').trim() && (
              <Chip onClick={() => setNote(capFirst(last.hint ?? ''))} className="max-w-panel text-muted">
                <span className="truncate">{capFirst(last.hint ?? '')}</span>
              </Chip>
            )}
          </div>
        )}
        {/* Композер — общий компонент (дом гномов, UI): плейсхолдер КОРОТКИЙ (не дублирует
            подсказку-чип над полем и не переносится на мобиле); полную подсказку по теме
            подхватывает Tab/→ (onTab); «+» слева — действия с вариантами. */}
        <ChatComposer
          value={note}
          onChange={setNote}
          onSend={submitNote}
          placeholder={t('generation.yourReply', lang)}
          sendDisabled={!note.trim() || working}
          pending={working}
          sendAriaLabel={t('generation.send2', lang)}
          onTab={() => setNote(capFirst(last?.hint || refineHint(listKind, ru)))}
          leftSlot={
            <ActionsMenu
              candidates={candidates}
              selId={selId}
              working={working}
              lang={lang}
              onPick={setSelId}
              onAccept={() => selId && start(() => acceptCandidate(generationId, selId))}
              onRegen={() => start(() => regenerateCandidate(generationId))}
            />
          }
        />
      </div>
    </div>
  )
}
