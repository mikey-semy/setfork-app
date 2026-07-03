import { tr } from '@/shared/i18n'
import type { DiffRow, DiffStep, DiffSummary } from './suggestion-diff'

type Lang = Parameters<typeof tr>[1]

const FIELD_LABEL: Record<string, { ru: string; en: string }> = {
  title: { ru: 'заголовок', en: 'title' },
  desc: { ru: 'описание', en: 'description' },
  command: { ru: 'команда', en: 'command' },
  level: { ru: 'уровень', en: 'level' },
  why: { ru: 'зачем', en: 'why' },
  section: { ru: 'секция', en: 'section' },
  subtasks: { ru: 'подзадачи', en: 'subtasks' },
  refs: { ru: 'ссылки', en: 'refs' },
}

// Метаданные по типу строки: знак, цвет рамки/фона.
const KIND = {
  add: { sign: '+', bar: 'border-ok', bg: 'bg-ok/10' },
  del: { sign: '−', bar: 'border-danger', bg: 'bg-danger/10' },
  mod: { sign: '~', bar: 'border-warn', bg: 'bg-warn/10' },
  same: { sign: ' ', bar: 'border-transparent', bg: '' },
} as const

function Title({ step, lang, strike }: { step: DiffStep; lang: Lang; strike?: boolean }) {
  const title = tr(step.title, lang)
  const desc = tr(step.desc, lang)
  return (
    <div className="min-w-0">
      <span className={`text-[13.5px] text-ink ${strike ? 'line-through opacity-70' : ''}`}>{title || '—'}</span>
      {desc && <span className="text-[13px] text-ink-2"> — {desc}</span>}
    </div>
  )
}

export function SuggestionDiff({
  rows,
  summary,
  lang,
}: {
  rows: DiffRow[]
  summary: DiffSummary
  lang: Lang
}) {
  const L = (ru: string, en: string) => (lang === 'ru' ? ru : en)
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-2 px-3.5 py-2 text-[12px]">
        <span className="font-mono uppercase tracking-[0.12em] text-muted">{L('изменения', 'changes')}</span>
        <span className="font-semibold text-ok">+{summary.added}</span>
        <span className="font-semibold text-warn">~{summary.modified}</span>
        <span className="font-semibold text-danger">−{summary.removed}</span>
        {summary.unchanged > 0 && (
          <span className="text-muted">
            · {summary.unchanged} {L('без изменений', 'unchanged')}
          </span>
        )}
      </div>

      <ol className="flex flex-col divide-y divide-border">
        {rows.map((r, idx) => {
          const meta = KIND[r.kind]
          return (
            <li key={idx} className={`flex gap-2.5 border-l-2 px-3 py-2 ${meta.bar} ${meta.bg}`}>
              <span
                className={`mt-0.5 select-none font-mono text-[13px] font-bold ${
                  r.kind === 'add' ? 'text-ok' : r.kind === 'del' ? 'text-danger' : r.kind === 'mod' ? 'text-warn' : 'text-muted'
                }`}
              >
                {meta.sign}
              </span>
              <div className="min-w-0 flex-1">
                <Title step={r.step} lang={lang} strike={r.kind === 'del'} />
                {r.kind === 'mod' && (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {r.changes.map((c, k) => (
                      <li key={k} className="text-[12px] leading-snug">
                        <span className="text-muted">{FIELD_LABEL[c.field] ? L(FIELD_LABEL[c.field].ru, FIELD_LABEL[c.field].en) : c.field}: </span>
                        <span className="text-danger line-through">{c.before || '∅'}</span>
                        <span className="text-muted"> → </span>
                        <span className="text-ok">{c.after || '∅'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
