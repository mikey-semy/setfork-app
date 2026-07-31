import { Plus, Power, RefreshCw, Rss, Trash2 } from 'lucide-react'
import { tr, type Lang } from '@/shared/i18n'
import { timeAgo } from '@/shared/ui/timeAgo'
import { TagChip } from '@/shared/ui/TagChip'
import { Alert } from '@/shared/ui/Alert'
import { EmptyState } from '@/shared/ui/EmptyState'
import { addFeedSource, pullFeedNow, removeFeedSource, setFeedSourceEnabled } from '@/features/admin/feed-actions'
import type { FeedSourceRow } from '@/features/admin/feed-queries'

/**
 * ПОДПИСКИ НА ПОТОК — состав ровными столбцами, как состав специалистов.
 *
 * Столбцы фиксированной ширины: `auto` подгоняется под содержимое КАЖДОЙ строки, и шапка со
 * строками разъезжаются «волной». Скроллится контейнер таблицы, страница — никогда.
 *
 * Основное действие над источником — выключить (он остаётся с историей). Удаление уносит и
 * собранные материалы, поэтому стоит последним и подписано.
 */

const COLS = 'grid-cols-[minmax(0,1fr)_160px_92px_116px_104px]'

export function FeedSourceList({ rows, lang, err }: { rows: FeedSourceRow[]; lang: Lang; err?: string }) {
  const say = (en: string, ru: string) => tr({ en, ru }, lang)
  const ERRS: Record<string, string> = {
    'no-tags': say('Topic is required: nobody guesses it for you.', 'Тема обязательна: угадывать её за вас никто не будет.'),
    'bad-url': say('Feed address must be http(s).', 'Адрес потока должен быть http(s).'),
    exists: say('This feed is already subscribed.', 'На этот поток уже подписаны.'),
    pull: say('Pull failed — the reason is in the row.', 'Сбор не удался — причина в строке.'),
    gone: say('Subscription no longer exists.', 'Подписки больше нет.'),
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {err && ERRS[err] && <Alert variant="warn">{ERRS[err]}</Alert>}

      {/* ДОБАВИТЬ. Тема — обязательное поле рядом с адресом: подписка без темы бесполезна,
          материал из неё никому не достанется. */}
      <form action={addFeedSource} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3.5 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[11.5px] uppercase tracking-wide text-muted">{say('Feed address', 'Адрес потока')}</span>
          <input
            name="url"
            required
            inputMode="url"
            placeholder="https://example.com/feed.xml"
            className="h-[38px] w-full rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-ink outline-hidden focus:border-border-strong"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 sm:w-[200px]">
          <span className="text-[11.5px] uppercase tracking-wide text-muted">{say('Topic', 'Тема')}</span>
          <input
            name="tags"
            required
            placeholder="devops, ci"
            className="h-[38px] w-full rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-ink outline-hidden focus:border-border-strong"
          />
        </label>
        <label className="flex flex-col gap-1 sm:w-[96px]">
          <span className="text-[11.5px] uppercase tracking-wide text-muted">{say('Hours', 'Часы')}</span>
          <input
            name="everyHours"
            type="number"
            min={1}
            max={168}
            defaultValue={6}
            className="h-[38px] w-full rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-ink outline-hidden focus:border-border-strong"
          />
        </label>
        <button className="inline-flex h-[38px] shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-primary-fg">
          <Plus size={14} /> {say('Add', 'Добавить')}
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <div className={`grid min-w-[760px] ${COLS} gap-4 border-b border-border px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted`}>
          <span>{say('Feed', 'Поток')}</span>
          <span>{say('Topic', 'Тема')}</span>
          <span className="text-right">{say('Every', 'Раз в')}</span>
          <span className="text-right">{say('Items / fresh', 'Всего / свежих')}</span>
          <span className="text-right">{say('Pulled', 'Собран')}</span>
        </div>
        {rows.length === 0 && (
          <EmptyState
            variant="inline"
            hint={say('No subscriptions yet — a list can only stay alive while something arrives.', 'Подписок пока нет — список живёт, только пока в него что-то приходит.')}
          />
        )}
        {rows.map((r) => (
          <div key={r.id} className={`grid min-w-[760px] ${COLS} items-center gap-4 border-b border-border px-4 py-2.5 last:border-0 ${r.enabled ? '' : 'opacity-60'}`}>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <Rss size={13} className={`shrink-0 ${r.lastError ? 'text-warn' : 'text-accent'}`} />
                <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 truncate text-[13px] text-ink hover:text-accent" title={r.url}>
                  {r.title || r.url.replace(/^https?:\/\//, '')}
                </a>
              </div>
              {r.lastError && <div className="mt-0.5 truncate text-[11.5px] text-warn" title={r.lastError}>{r.lastError}</div>}
            </div>
            <div className="flex min-w-0 flex-wrap gap-1">
              {r.tags.map((t) => (
                <TagChip key={t} slug={t} />
              ))}
            </div>
            <span className="text-right font-mono tabular-nums text-[12.5px] text-ink-2">{r.everyHours} {say('h', 'ч')}</span>
            <span className="text-right font-mono tabular-nums text-[12.5px] text-ink-2">
              {r.items} / <span className={r.fresh ? 'text-ok' : ''}>{r.fresh}</span>
            </span>
            <div className="flex items-center justify-end gap-0.5">
              <span className="mr-1 hidden text-[11.5px] text-muted sm:inline">{r.lastPulledAt ? timeAgo(r.lastPulledAt, lang) : '—'}</span>
              {/* Служебные действия — иконками в правом углу строки: на мобиле три подписи не
                  влезут, а иконка с подсказкой понятна и в 360px. */}
              <form action={pullFeedNow}>
                <input type="hidden" name="id" value={r.id} />
                <button type="submit" aria-label={say('Pull now', 'Тянуть сейчас')} title={say('Pull now', 'Тянуть сейчас')} className="grid size-11 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink">
                  <RefreshCw size={15} />
                </button>
              </form>
              <form action={setFeedSourceEnabled}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="enabled" value={r.enabled ? 'false' : 'true'} />
                <button
                  type="submit"
                  aria-label={r.enabled ? say('Disable', 'Выключить') : say('Enable', 'Включить')}
                  title={r.enabled ? say('Disable', 'Выключить') : say('Enable', 'Включить')}
                  className={`grid size-11 place-items-center rounded-md hover:bg-surface-2 ${r.enabled ? 'text-ok' : 'text-muted'}`}
                >
                  <Power size={15} />
                </button>
              </form>
              <form action={removeFeedSource}>
                <input type="hidden" name="id" value={r.id} />
                <button
                  type="submit"
                  aria-label={say('Delete with collected items', 'Удалить вместе с собранным')}
                  title={say('Delete with collected items', 'Удалить вместе с собранным')}
                  className="grid size-11 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-danger"
                >
                  <Trash2 size={15} />
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
