'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Award, Ban, Check, CircleAlert, CircleCheckBig, Flag, GraduationCap, Info, RotateCcw, Square, SquareCheckBig, Trash2 } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { t } from '@/shared/i18n'
import type { StepLevel } from '@/shared/db'
import { CopyRow } from '@/shared/ui/CopyRow'
import { Tooltip } from '@/shared/ui/Tooltip'
import { useConfirm } from '@/shared/ui/use-confirm'
import { Markdown } from '@/shared/ui/Markdown'
import { StepLevelBadge } from '@/shared/ui/StepLevelBadge'
import { SafeLink } from '@/shared/ui/SafeLink'
import { ProductBlock, type ProductLinkVM } from '@/shared/ui/ProductBlock'
// dig-чат («кирка» на шаге) — UI-фича, переиспользуем в прогоне (как и в детали списка).
// eslint-disable-next-line boundaries/dependencies -- кирка/dig-чат из features/dig
import { DIG_SAVED_EVENT, DigChatHost, DigChatOpen, type GnomeOption } from '@/features/dig/DigChat'
import { linkLabel } from '@/shared/lib/link-label'
import { blockStep, deleteRun, failRun, finishRun, reopenRun, reportBlockedStep, toggleStep, toggleSubtask, unblockStep } from './actions'
import { PAGE_NARROW } from '@/shared/ui/control'
import { buttonClass } from '@/shared/ui/button-style'
import { cardClass } from '@/shared/ui/card-style'
import { IconButton } from '@/shared/ui/IconButton'
import { Textarea } from '@/shared/ui/textarea'

export interface RunStepVM {
  id: string
  n: number
  type: string // 'step' (чекается) | 'text' | 'image' (контекст)
  text: string // markdown text-блока
  caption: string // подпись image-блока
  productTitle: string // заголовок подборки product-блока
  products: ProductLinkVM[] // товары product-блока (href — трекинговый /api/go)
  title: string
  /** Подпись блока в шапке чата раскопки: заголовок, секция-урок, первая
   *  читаемая Markdown-строка или имя типа (считает blockChatTitle). */
  digTitle: string
  desc: string
  command: string
  level: StepLevel
  why: string
  subtasks: string[]
  // href — трекинговый /api/go/<stepId>/<i> (журнал кликов); url — прямая ссылка.
  refs: { label: string; url?: string; href?: string }[]
  done: boolean
  blocked: boolean
  reason: string
  subtasksDone: number[]
  /** Последняя AI-подсказка «помощи на шаге» (не используется в UI — заменено «киркой»). */
  assist: string
}

export function RunView({
  runId,
  templateId,
  status,
  ordered,
  title,
  backHref,
  steps: initial,
  lang,
  certificateHref,
  courseCompleted,
  digEnabled,
  digGnomes,
  digSteps,
}: {
  runId: string
  templateId: string
  status: 'active' | 'done' | 'abandoned' | 'failed'
  ordered: boolean
  title: string
  backHref: string
  steps: RunStepVM[]
  lang: Lang
  certificateHref?: string
  // Курс уже пройден РАНЬШЕ (courseCompletions) — сертификат доступен и в новом
  // прогоне с нуля, повторное прохождение ради «бумажки» не требуется.
  courseCompleted?: boolean
  /** «Кирка» (dig-чат «в шахту») доступна: ИИ включён и есть ростер собеседников. */
  digEnabled?: boolean
  digGnomes?: GnomeOption[]
  /** Номера шагов, где у зрителя уже есть сохранённая dig-беседа (точка на кирке). */
  digSteps?: number[]
}) {
  const [steps, setSteps] = useState(initial)
  const [, start] = useTransition()
  const { confirm, confirmDialog } = useConfirm()
  const [blockingId, setBlockingId] = useState<string | null>(null)
  const [reasonDraft, setReasonDraft] = useState('')
  // Точку на кирке зажигаем СРАЗУ при сохранении сессии (событие dig-saved), а не
  // только после перезагрузки (серверный digSteps — начальный снимок).
  const [dugLocal, setDugLocal] = useState<Set<number>>(() => new Set(digSteps ?? []))
  useEffect(() => {
    const onSaved = (e: Event) => {
      const d = (e as CustomEvent<{ templateId: string; stepN: number }>).detail
      if (d?.templateId !== templateId) return
      setDugLocal((s) => (s.has(d.stepN) ? s : new Set(s).add(d.stepN)))
    }
    window.addEventListener(DIG_SAVED_EVENT, onSaved)
    return () => window.removeEventListener(DIG_SAVED_EVENT, onSaved)
  }, [templateId])
  // Прогресс — только по шаг-блокам (text/image — контекст, не чекаются).
  const isStep = (s: RunStepVM) => !s.type || s.type === 'step'
  const total = steps.filter(isStep).length
  const done = steps.filter((s) => isStep(s) && s.done).length
  const blockedCount = steps.filter((s) => isStep(s) && s.blocked).length
  const pct = total ? Math.round((done / total) * 100) : 0
  const closed = status === 'done' || status === 'failed' || status === 'abandoned'
  // Прохождение курса — факт с сервера: снимок при рендере (courseCompleted) плюс
  // ответ отметки шага, которая могла завершить курс уже после него.
  const [completedNow, setCompletedNow] = useState(false)
  const completed = courseCompleted || completedNow

  const patch = (i: number, p: Partial<RunStepVM>) => setSteps((xs) => xs.map((s, idx) => (idx === i ? { ...s, ...p } : s)))

  function toggle(i: number) {
    const s = steps[i]
    patch(i, { done: !s.done, blocked: false })
    start(async () => {
      // Признак зажигаем ТОЛЬКО по ответу сервера: он знает про обе стороны курса
      // (шаги и тесты), а страница после отметки шага не перерисовывается.
      if (await toggleStep(runId, s.id)) setCompletedNow(true)
    })
  }
  function toggleSub(i: number, idx: number) {
    const s = steps[i]
    const has = s.subtasksDone.includes(idx)
    patch(i, { subtasksDone: has ? s.subtasksDone.filter((x) => x !== idx) : [...s.subtasksDone, idx] })
    start(() => toggleSubtask(runId, s.id, idx))
  }
  function confirmBlock(i: number) {
    const s = steps[i]
    const reason = reasonDraft.trim()
    patch(i, { blocked: true, done: false, reason })
    setBlockingId(null)
    setReasonDraft('')
    start(() => blockStep(runId, s.id, reason))
  }
  function unblock(i: number) {
    const s = steps[i]
    patch(i, { blocked: false, reason: '' })
    start(() => unblockStep(runId, s.id))
  }

  return (
    <div className={PAGE_NARROW}>
      <Link href={backHref} className="mb-4 inline-flex items-center gap-1.5 text-body text-ink-2 hover:text-ink">
        <ArrowLeft size={14} /> {backHref.replace(/^\//, '')}
      </Link>

      {/* Прогресс. Кнопки одной высоты (32px шкалы): «Завершить» текстом, остальное — иконки. */}
      <div className={cardClass({ className: 'sticky top-[4rem] z-10 mb-5 bg-surface/95 backdrop-blur-sm' })}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-title font-semibold text-ink">{title}</div>
            <div className="text-body-sm text-ink-2">
              {status === 'done' ? (
                t('runDone', lang)
              ) : status === 'failed' ? (
                <span className="text-danger">
                  {t('runFailed', lang)}
                  {blockedCount > 0 && ` · ${blockedCount} ${t('runBlockedLabel', lang)}`}
                </span>
              ) : (
                `${done} / ${total} · ${pct}%${blockedCount > 0 ? ` · ${blockedCount} ${t('runBlockedLabel', lang)}` : ''}`
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {closed ? (
              <button
                type="button"
                onClick={() => start(() => reopenRun(runId))}
                className={buttonClass()}
              >
                <RotateCcw size={14} /> {t('runReopen', lang)}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => start(() => finishRun(runId))}
                  className={buttonClass({ variant: 'primary' })}
                >
                  <CircleCheckBig size={15} /> {t('runFinish', lang)}
                </button>
                {/* «Остановить как неудачу» — иконкой (был длинный текст, фидбек владельца). */}
                <Tooltip label={t('runFailAction', lang)}>
                  <IconButton variant="danger" label={t('runFailAction', lang)} className="text-danger hover:bg-danger/10" onClick={async () => {
                      const ok = await confirm({
                        title: t('runFailAction', lang),
                        intro: t('runFailConfirm', lang),
                        confirmLabel: t('runFailAction', lang),
                        cancelLabel: t('cancel', lang),
                      })
                      if (ok) start(() => failRun(runId))
                    }}>
                    <CircleAlert size={16} />
                  </IconButton>
                </Tooltip>
              </>
            )}
            {/* Delete — реально удаляет прогон (в отличие от «завершить/неудача»), уводит на /runs */}
            <Tooltip label={t('runDelete', lang)}>
              <IconButton variant="ghost" label={t('runDelete', lang)} className="text-muted hover:text-danger" onClick={async () => {
                  const ok = await confirm({
                    title: t('runDelete', lang),
                    intro: t('runDeleteConfirm', lang),
                    confirmLabel: t('runDelete', lang),
                    cancelLabel: t('cancel', lang),
                  })
                  if (ok) start(() => deleteRun(runId))
                }}>
                <Trash2 size={16} />
              </IconButton>
            </Tooltip>
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-ok transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Хост dig-чата («в шахту») — одна модалка на страницу, открывают кирки на шагах. */}
      {digEnabled && digGnomes && <DigChatHost gnomes={digGnomes} lang={lang} />}

      {/* Курс ПРОЙДЕН (запись есть) → ссылка на сертификат. Показывать по «все шаги
          отмечены» нельзя: на версии с тестами это половина условия, и плашка обещала
          бы сертификат, который страница выдачи честно не даёт. Отмеченные шаги здесь
          только выбирают формулировку — завершено сейчас или уже было раньше. */}
      {certificateHref && completed && (
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-ok/40 bg-ok/10 px-4 py-3">
          <GraduationCap size={18} className="shrink-0 text-ok" />
          <span className="min-w-0 flex-1 text-body font-medium text-ink">
            {total > 0 && done === total && blockedCount === 0 ? t('courseAllStepsDone', lang) : t('courseCompletedEarlier', lang)}
          </span>
          <Link href={certificateHref} className={buttonClass({ className: 'border-ok/40 text-ok hover:bg-ok/15' })}>
            <Award size={14} /> {t('courseCertificate', lang)}
          </Link>
        </div>
      )}

      {/* Шаги */}
      <div className="flex flex-col gap-3">
        {steps.map((s, i) => {
          // Презентационные блоки — контекст: без чекбокса и контролов.
          if (!isStep(s)) {
            if (s.type === 'text') {
              // Текст-блок — как шаг: контейнер + «кирка» для углублённого изучения
              // (dig-чат), но презентационный: без чекбокса и «не получается».
              return s.text ? (
                <div key={s.id} className={cardClass({ className: 'relative' })}>
                  {digEnabled && (
                    <div className="absolute right-2 top-2">
                      <DigChatOpen detail={{ templateId, stepN: s.n, stepTitle: s.digTitle }} label={t('digStep', lang)} hasSession={dugLocal.has(s.n)} />
                    </div>
                  )}
                  <Markdown className={`text-body-lg leading-relaxed text-ink-2${digEnabled ? ' pr-10' : ''}`}>{s.text}</Markdown>
                </div>
              ) : null
            }
            if (s.type === 'product') {
              return s.products.length ? <ProductBlock key={s.id} title={s.productTitle} items={s.products} lang={lang} /> : null
            }
            return s.caption ? (
              <div key={s.id} className="px-1 text-body italic text-muted">🖼 {s.caption}</div>
            ) : null
          }
          // Порядковый номер шага (только по шаг-блокам).
          const stepNo = steps.slice(0, i).filter(isStep).length + 1
          const showFail = !closed && !s.done && !s.blocked && blockingId !== s.id
          return (
            <div
              key={s.id}
              // eslint-disable-next-line no-restricted-syntax -- цвет рамки меняется по состоянию шага прогона
              className={`relative rounded-lg border p-4 transition-colors ${
                s.blocked ? 'border-danger/40 bg-danger/5' : s.done ? 'border-ok/40 bg-ok/5' : 'border-border bg-surface'
              }`}
            >
              {/* Служебные иконки — правый верхний угол (mobile-ui: absolute, без текста, тултипы):
                  «Шаг не получается» (красная) + «кирка» (dig-чат «в шахту»). */}
              {(showFail || digEnabled) && (
                <div className="absolute right-2 top-2 flex items-center gap-1">
                  {showFail && (
                    <Tooltip label={t('runCantComplete', lang)}>
                      <IconButton variant="ghost" label={t('runCantComplete', lang)} className="text-muted hover:text-danger" onClick={() => {
                          setBlockingId(s.id)
                          setReasonDraft('')
                        }}>
                        <Ban size={16} />
                      </IconButton>
                    </Tooltip>
                  )}
                  {digEnabled && <DigChatOpen detail={{ templateId, stepN: s.n, stepTitle: s.digTitle }} label={t('digStep', lang)} hasSession={dugLocal.has(s.n)} />}
                </div>
              )}

              {/* Шапка: чекбокс (верх-лево) + номер + заголовок + уровень. pr — под угловые иконки. */}
              <div className="flex items-start gap-2.5 pr-14">
                {/* Это ФЛАЖОК, а не кнопка: диктор обязан сказать «отмечено / не отмечено», иначе
                    человек слышит «кнопка check» и не узнаёт состояние шага. Роль ставим руками —
                    вид тут крупная иконка на всю тач-цель, нативный флажок так не рисуется.
                    Подпись была английским литералом ('check'/'uncheck') в русском интерфейсе.
                    ui-parity-ok: флажок шага — крупный значок на всю тач-цель, нативным input не рисуется */}
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={s.done}
                  onClick={() => toggle(i)}
                  aria-label={t(s.done ? 'runStepUncheck' : 'runStepCheck', lang)}
                  className={`grid size-8 shrink-0 place-items-center ${s.done ? 'text-ok' : 'text-muted hover:text-ink'}`}
                >
                  {s.done ? <SquareCheckBig size={20} /> : <Square size={20} />}
                </button>
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2 pt-1">
                  {ordered && <span className="font-mono text-body-sm text-muted">{stepNo}</span>}
                  {/* Заголовок шага пишет человек: без переноса длинное слово уносит страницу (замер 976px при экране 390). */}
                  <span className={`min-w-0 text-body-lg font-semibold [overflow-wrap:anywhere] ${s.done ? 'text-ink-2 line-through' : 'text-ink'}`}>{s.title}</span>
                  <StepLevelBadge level={s.level} lang={lang} />
                </div>
              </div>

              {/* Тело — во всю ширину карточки (без отступа под чекбокс, «данные к краю»). */}
              <div className="mt-2 flex flex-col gap-3">
                {s.desc && <Markdown>{s.desc}</Markdown>}
                {s.why && (
                  <div className="flex gap-1.5 text-body-sm text-ink-2">
                    <Info size={13} className="mt-0.5 shrink-0 text-muted" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <span className="font-medium">{t('whyLabel', lang)}:</span> {s.why}
                    </span>
                  </div>
                )}

                {s.command && (
                  <CopyRow value={s.command} lang={lang} prompt />
                )}

                {s.subtasks.length > 0 && (
                  <ul className="flex flex-col gap-1.5">
                    {s.subtasks.map((sub, idx) => {
                      const checked = s.subtasksDone.includes(idx)
                      return (
                        <li key={idx}>
                          {/* Подпункт — тот же флажок: имя ему даёт собственный текст, не хватало только состояния.
                              ui-parity-ok: флажок подпункта, значок и текст в одной строке — нативным input не рисуется */}
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={checked}
                            onClick={() => toggleSub(i, idx)}
                            className="flex items-start gap-2 text-left text-body text-ink-2"
                          >
                            <span className={`mt-0.5 shrink-0 ${checked ? 'text-ok' : 'text-muted'}`}>{checked ? <Check size={14} /> : <Square size={14} />}</span>
                            <span className={`min-w-0 [overflow-wrap:anywhere] ${checked ? 'line-through opacity-70' : ''}`}>{sub}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}

                {s.refs.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {s.refs.map((r) =>
                      r.url ? (
                        <SafeLink key={`${r.label}:${r.url}`} href={r.href ?? r.url} rel="nofollow noreferrer" className="min-w-0 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-caption text-accent [overflow-wrap:anywhere]">
                          {linkLabel(r.label, r.url)}
                        </SafeLink>
                      ) : (
                        <span key={`${r.label}:`} className="min-w-0 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-caption text-ink-2 [overflow-wrap:anywhere]">
                          {linkLabel(r.label, r.url)}
                        </span>
                      ),
                    )}
                  </div>
                )}

                {/* Ввод причины «не получилось» (открывает угловая иконка Ban). */}
                {blockingId === s.id && (
                  <div className={cardClass({ tone: 'danger', pad: 'sm' })}>
                    <Textarea
                      autoFocus
                      value={reasonDraft}
                      onChange={(e) => setReasonDraft(e.target.value)}
                      rows={2}
                      aria-label={t('runReasonPh', lang)}
                      placeholder={t('runReasonPh', lang)}
                      className="resize-none"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button type="button" onClick={() => confirmBlock(i)} className={buttonClass({ variant: 'dangerSolid', className: 'bg-danger text-white' })}>
                        <Ban size={13} /> {t('runBlockAction', lang)}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setBlockingId(null)
                          setReasonDraft('')
                        }}
                        className={buttonClass({ variant: 'ghost' })}
                      >
                        {t('cancel', lang)}
                      </button>
                    </div>
                  </div>
                )}

                {/* Состояние «застрял»: причина + сообщить/снять (помощь теперь через «кирку» в углу). */}
                {s.blocked && blockingId !== s.id && (
                  <div className={cardClass({ tone: 'danger', pad: 'sm', className: 'text-body-sm' })}>
                    <div className="flex items-center gap-1.5 font-semibold text-danger">
                      <Ban size={13} /> {t('runBlockedLabel', lang)}
                      {s.reason ? ':' : ''}
                    </div>
                    {s.reason && <div className="mt-0.5 text-ink-2">{s.reason}</div>}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => start(() => reportBlockedStep(runId, s.id))}
                        className={buttonClass()}
                      >
                        <Flag size={12} /> {t('runReport', lang)}
                      </button>
                      {!closed && (
                        <button type="button" onClick={() => unblock(i)} className={buttonClass({ variant: 'ghost' })}>
                          {t('runUnblock', lang)}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {confirmDialog}
    </div>
  )
}
