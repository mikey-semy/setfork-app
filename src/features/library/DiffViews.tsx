import type { ReactNode } from 'react'
import { t, type Lang } from '@/shared/i18n'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Markdown } from '@/shared/ui/Markdown'
import { safeHref } from '@/shared/lib/safe-url'
import { DiffStat } from '@/shared/ui/DiffStat'
import { StepLevelBadge } from '@/shared/ui/StepLevelBadge'
import { blockLabel, diffSteps, isStepBlock, lineDiff, serializeSteps, type CmpStep, type DiffEntry } from './diff'
import { DiffComments, type DiffCommentLabels, type RowThread } from './DiffComments'
import { ViewedToggle } from './ViewedToggle'
import { blockFingerprint, isStaleMark } from './viewed-fingerprint'

// Два вида диффа версий — ОДИН источник правды для сравнения версий И для правки
// (PR). Раньше «код»/«список» жили локальными функциями внутри страницы
// сравнения, а на странице правки было третье, более краткое представление:
// одно и то же изменение выглядело по-разному в зависимости от того, откуда
// смотришь. Теперь вид один, отличается только обвязка вокруг.

const STATUS: Record<DiffEntry['status'], { color: string | null; key: 'diffAdded' | 'diffRemoved' | 'diffChanged' | 'diffMoved' | null }> = {
  added: { color: 'var(--ok)', key: 'diffAdded' },
  removed: { color: 'var(--danger)', key: 'diffRemoved' },
  changed: { color: 'var(--warn)', key: 'diffChanged' },
  moved: { color: 'var(--accent)', key: 'diffMoved' },
  unchanged: { color: null, key: null },
}
const mix = (c: string, pct: number, base = 'transparent') => `color-mix(in srgb, ${c} ${pct}%, ${base})`

export type DiffView = 'code' | 'list'

export function CodeDiff({ fromSteps, toSteps, ordered, lang }: { fromSteps: CmpStep[]; toSteps: CmpStep[]; ordered: boolean; lang: Lang }) {
  const { rows, added, removed } = lineDiff(serializeSteps(fromSteps, ordered), serializeSteps(toSteps, ordered))
  if (added + removed === 0) return <EmptyState hint={t('diffNothing', lang)} />
  return (
    <>
      <DiffStat counts={{ added, removed }} squares className="mb-3" />
      <div className="overflow-x-auto rounded-lg border border-border font-mono text-[12.5px] leading-[1.55]">
        {rows.map((r) => {
          const clr = r.type === 'add' ? 'var(--ok)' : r.type === 'del' ? 'var(--danger)' : ''
          const rowStyle = clr ? { backgroundColor: `color-mix(in srgb, ${clr} 13%, transparent)` } : undefined
          const sign = r.type === 'add' ? '+' : r.type === 'del' ? '−' : ''
          const signColor = r.type === 'add' ? 'text-ok' : r.type === 'del' ? 'text-danger' : 'text-transparent'
          return (
            <div key={`${r.oldNo ?? ''}:${r.newNo ?? ''}`} style={rowStyle} className="flex">
              <span className="w-10 shrink-0 select-none border-r border-border px-1.5 text-right text-[11px] text-muted">
                {r.oldNo ?? ''}
              </span>
              <span className="w-10 shrink-0 select-none border-r border-border px-1.5 text-right text-[11px] text-muted">
                {r.newNo ?? ''}
              </span>
              <span className={`w-4 shrink-0 select-none text-center ${signColor}`}>{sign}</span>
              <span className="whitespace-pre-wrap wrap-break-word px-2 text-ink">
                {r.segs
                  ? r.segs.map((seg, k) =>
                      seg.changed ? (
                        <span key={k} className="rounded-sm" style={{ backgroundColor: `color-mix(in srgb, ${clr} 38%, transparent)` }}>
                          {seg.text}
                        </span>
                      ) : (
                        <span key={k}>{seg.text}</span>
                      ),
                    )
                  : r.text || ' '}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}

export function ListDiff({
  fromSteps,
  toSteps,
  lang,
  comments,
  viewed,
}: {
  fromSteps: CmpStep[]
  toSteps: CmpStep[]
  lang: Lang
  /** Review-комментарии к пунктам (только на странице правки). */
  comments?: {
    owner: string
    slug: string
    suggestionId: string
    canComment: boolean
    /** Право применить предложенную правку — то же, что право править пункты. */
    canApply: boolean
    labels: DiffCommentLabels
    byBlock: Map<string, RowThread[]>
  }
  /** Личные отметки «просмотрено» текущего зрителя (null — не залогинен). */
  viewed?: {
    suggestionId: string
    /** blockId → отпечаток содержимого и язык, на котором отмечали. */
    marks: Map<string, { fp: string; lang: string }>
    labels: { mark: string; unmark: string; stale: string }
  } | null
}) {
  const { entries, summary } = diffSteps(fromSteps, toSteps)
  if (summary.added + summary.removed + summary.changed + summary.moved === 0)
    return <EmptyState hint={t('diffNothing', lang)} />
  return (
    <>
      <DiffStat counts={summary} squares className="mb-3" />
      <div className="flex flex-col gap-2.5">
        {entries.map((e, i) => {
          const st = STATUS[e.status]
          const cardStyle = st.color
            ? { borderColor: mix(st.color, 55, 'var(--border)'), backgroundColor: mix(st.color, 6) }
            : undefined
          // У презентационного блока title пуст, а содержимое лежит в content —
          // берём подпись и тело оттуда, иначе карточка выходит безымянной и пустой.
          const block = !isStepBlock(e)
          const body = block ? (e.type === 'text' ? String(e.content?.md ?? '') : '') : e.desc
          return (
            <div key={e.blockId ?? `${e.status}:${e.type ?? 'step'}:${i}`} style={cardStyle} className={`group relative rounded-lg border p-4 ${comments ? 'pr-12' : ''} ${st.color ? '' : 'border-border opacity-60'}`}>
              {/* Отметка «просмотрено» — СТРОГО в углу карточки, а не в потоке
                  заголовка: при переносе строки она уплыла бы в середину. */}
              {viewed && e.blockId && (
                <span className="absolute right-1.5 top-1.5 z-10">
                  <ViewedToggle
                    suggestionId={viewed.suggestionId}
                    blockId={e.blockId}
                    fingerprint={blockFingerprint(e)}
                    viewed={viewed.marks.has(e.blockId)}
                    // Отпечаток берётся с локализованного текста, поэтому сравнивать
                    // его можно только с отметкой ТОГО ЖЕ языка: иначе смена языка
                    // интерфейса гасила бы все отметки разом.
                    stale={isStaleMark(viewed.marks.get(e.blockId), blockFingerprint(e), lang)}
                    labels={viewed.labels}
                  />
                </span>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[14px] font-semibold text-ink ${e.status === 'removed' ? 'line-through opacity-70' : ''}`}>{blockLabel(e)}</span>
                {!block && <StepLevelBadge level={e.level} lang={lang} />}
                {st.key && st.color && (
                  <span
                    className="rounded-md border px-1.5 py-0.5 text-[11px] font-medium"
                    style={{ color: st.color, borderColor: mix(st.color, 55) }}
                  >
                    {t(st.key, lang)}
                  </span>
                )}
              </div>
              {e.status !== 'removed' && body && <Markdown className="mt-1">{body}</Markdown>}
              {e.status === 'removed' && body && <div className="mt-1 whitespace-pre-wrap text-[13px] text-ink-2 line-through opacity-70">{body}</div>}
              {e.status === 'changed' && e.before && (
                <div className="mt-2 space-y-1 border-l-2 border-warn/40 pl-2.5 text-[12.5px] text-ink-2">
                  {e.changes.includes('level') && (
                    <div>
                      level: <span className="line-through opacity-70">{e.before.level}</span> → <b>{e.level}</b>
                    </div>
                  )}
                  {e.changes.includes('command') && (
                    <div className="font-mono">
                      {e.before.command && <span className="line-through opacity-70">{e.before.command}</span>}
                      {e.command && <> → {e.command}</>}
                    </div>
                  )}
                  {e.changes.includes('desc') && e.before.desc && (
                    <div>
                      {t('diffWas', lang)}: <span className="line-through opacity-70">{e.before.desc}</span>
                    </div>
                  )}
                  {(e.changes.includes('subtasks') || e.changes.includes('why') || e.changes.includes('refs')) && (
                    <div className="text-muted">
                      {e.changes.filter((c) => c === 'subtasks' || c === 'why' || c === 'refs').join(', ')}{' '}
                      {t('diffChanged', lang).toLowerCase()}
                    </div>
                  )}
                </div>
              )}
              {e.status !== 'removed' && e.command && !e.changes.includes('command') && (
                <code className="mt-2 block rounded-md bg-surface-2 px-2 py-1 font-mono text-[12.5px] text-ink">{e.command}</code>
              )}
              {e.status !== 'removed' && e.refs && e.refs.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {e.refs.map((r, k) => {
                    const cls = 'inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px]'
                    // Ссылка без URL — не делаем «#»-якорь на верх страницы, показываем как текст.
                    return r.url ? (
                      <a key={k} href={safeHref(r.url) || undefined} target="_blank" rel="noreferrer" className={`${cls} text-accent hover:underline`}>
                        {r.label || r.url}
                      </a>
                    ) : (
                      <span key={k} className={`${cls} text-ink-2`}>
                        {r.label}
                      </span>
                    )
                  })}
                </div>
              )}
              {/* Review-комментарии к пункту — только на странице правки (в PR).
                  Кнопка живёт в жёлобе строки, поэтому карточке добавлен pr-12. */}
              {comments && (
                <DiffComments
                  owner={comments.owner}
                  slug={comments.slug}
                  suggestionId={comments.suggestionId}
                  blockId={e.blockId ?? null}
                  rowThreads={(e.blockId && comments.byBlock.get(e.blockId)) || []}
                  canComment={comments.canComment}
                  canApply={comments.canApply}
                  lang={lang}
                  labels={comments.labels}
                />
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
