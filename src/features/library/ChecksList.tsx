import { Check, AlertTriangle, X, Minus, Clock, ExternalLink } from 'lucide-react'
import type { CheckItem, CheckStatus } from './suggestion-checks'

// Иконка и цвет на статус проверки — как строки чек-ранов в PR: состояние
// читается взглядом, без чтения текста.
const META: Record<CheckStatus, { icon: typeof Check; cls: string }> = {
  ok: { icon: Check, cls: 'text-ok' },
  warn: { icon: AlertTriangle, cls: 'text-warn' },
  fail: { icon: X, cls: 'text-danger' },
  neutral: { icon: Minus, cls: 'text-muted' },
  // Внешняя проверка ещё идёт: длинный прогон отчитывается дважды.
  pending: { icon: Clock, cls: 'text-muted' },
}

/**
 * Список проверок правки. Наверху — сводка «сколько блокирует», потому что
 * именно она отвечает на вопрос «можно ли принимать».
 */
export function ChecksList({ items, labels }: { items: CheckItem[]; labels: { blocking: string; allGood: string; details: string } }) {
  const failed = items.filter((i) => i.status === 'fail').length
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2 px-3.5 py-2 text-body-sm">
        {failed > 0 ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-danger">
            <X size={13} /> {labels.blocking}: {failed}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-semibold text-ok">
            <Check size={13} /> {labels.allGood}
          </span>
        )}
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {items.map((it) => {
          const meta = META[it.status]
          const Icon = meta.icon
          return (
            <li key={it.key} className="flex items-start gap-2.5 px-3.5 py-2.5">
              <Icon size={15} className={`mt-0.5 shrink-0 ${meta.cls}`} />
              <div className="min-w-0 flex-1">
                <div className="text-body text-ink">
                  {it.title}
                  {/* Чужая проверка подписана автором: своё приложение считает само,
                      а это прислали снаружи — и видно, кем. */}
                  {it.reportedBy && <span className="ml-1.5 text-body-sm text-muted">@{it.reportedBy}</span>}
                </div>
                {it.detail && <div className="text-body-sm text-ink-2 [overflow-wrap:anywhere]">{it.detail}</div>}
              </div>
              {it.url && (
                <a
                  href={it.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  aria-label={labels.details}
                  title={labels.details}
                  className="ml-auto grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
                >
                  <ExternalLink size={14} />
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
