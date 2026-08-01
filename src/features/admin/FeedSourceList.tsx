'use client'

import { Plus, Power, RefreshCw, Rss, Trash2 } from 'lucide-react'
import { tr, type Lang } from '@/shared/i18n'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/button'
import { DataTableV2 } from '@/shared/ui/data-table/DataTableV2'
import { nodeColumn, numberColumn } from '@/shared/ui/data-table/column-builders'
import { timeAgo } from '@/shared/ui/timeAgo'
import { TagChip } from '@/shared/ui/TagChip'
import { Alert } from '@/shared/ui/Alert'
import { addFeedSource, pullFeedNow, removeFeedSource, setFeedSourceEnabled } from '@/features/admin/feed-actions'
import type { FeedSourceRow } from '@/features/admin/feed-queries'
import { Tooltip } from '@/shared/ui/Tooltip'

/**
 * ПОДПИСКИ НА ПОТОК — состав ровными столбцами, как состав специалистов.
 *
 * Таблица — DataTableV2 (Ф11, пилот вместе с CouncilList): настоящая <table>
 * с сортировкой по числам, на мобиле строки становятся карточками (ячейка
 * «Поток» — заголовок карточки). Приглушение выключенной подписки живёт
 * ВНУТРИ информационных ячеек (строки рендерит v2); кнопки-действия не
 * приглушаем — Power для включения обратно должен оставаться заметным.
 *
 * Основное действие над источником — выключить (он остаётся с историей). Удаление уносит и
 * собранные материалы, поэтому стоит последним и подписано.
 */

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
          <span className="text-[0.6875rem] uppercase tracking-wide text-muted">{say('Feed address', 'Адрес потока')}</span>
          <input
            name="url"
            required
            inputMode="url"
            placeholder="https://example.com/feed.xml"
            className="h-[2.375rem] w-full rounded-md border border-border bg-surface-2 px-2.5 text-[0.8125rem] text-ink outline-hidden focus:border-border-strong"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 sm:w-[12.5rem]">
          <span className="text-[0.6875rem] uppercase tracking-wide text-muted">{say('Topic', 'Тема')}</span>
          <input
            name="tags"
            required
            placeholder="devops, ci"
            className="h-[2.375rem] w-full rounded-md border border-border bg-surface-2 px-2.5 text-[0.8125rem] text-ink outline-hidden focus:border-border-strong"
          />
        </label>
        <label className="flex flex-col gap-1 sm:w-[6rem]">
          <span className="text-[0.6875rem] uppercase tracking-wide text-muted">{say('Hours', 'Часы')}</span>
          <input
            name="everyHours"
            type="number"
            min={1}
            max={168}
            defaultValue={6}
            className="h-[2.375rem] w-full rounded-md border border-border bg-surface-2 px-2.5 text-[0.8125rem] text-ink outline-hidden focus:border-border-strong"
          />
        </label>
        <Button type="submit" variant="primary" size="md" className="shrink-0">
          <Plus size={14} /> {say('Add', 'Добавить')}
        </Button>
      </form>

      <DataTableV2<FeedSourceRow>
        cardOnMobile
        rowKey={(r) => r.id}
        empty={{
          hint: say('No subscriptions yet — a list can only stay alive while something arrives.', 'Подписок пока нет — список живёт, только пока в него что-то приходит.'),
        }}
        columns={[
          nodeColumn<FeedSourceRow>({
            id: 'feed',
            header: say('Feed', 'Поток'),
            render: (r) => (
              <div className={cn('min-w-0', !r.enabled && 'opacity-60')}>
                <div className="flex min-w-0 items-center gap-2">
                  <Rss size={13} className={`shrink-0 ${r.lastError ? 'text-warn' : 'text-accent'}`} />
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="min-w-0 truncate text-[0.8125rem] text-ink hover:text-accent"
                    title={r.url}
                  >
                    {r.title || r.url.replace(/^https?:\/\//, '')}
                  </a>
                </div>
                {r.lastError && (
                  <Tooltip label={r.lastError}>
                    <div className="mt-0.5 truncate text-[0.6875rem] text-warn">{r.lastError}</div>
                  </Tooltip>
                )}
              </div>
            ),
          }),
          nodeColumn<FeedSourceRow>({
            id: 'topic',
            header: say('Topic', 'Тема'),
            size: 160,
            render: (r) => (
              <div className={cn('flex min-w-0 flex-wrap gap-1', !r.enabled && 'opacity-60')}>
                {r.tags.map((t) => (
                  <TagChip key={t} slug={t} />
                ))}
              </div>
            ),
          }),
          numberColumn<FeedSourceRow>({
            id: 'every',
            header: say('Every', 'Раз в'),
            size: 92,
            value: (r) => r.everyHours,
            format: (n) => `${n} ${say('h', 'ч')}`,
          }),
          {
            // «Всего / свежих» — составная ячейка с подсветкой свежих, фабрика такого
            // не умеет: nodeColumn не сортируется, numberColumn не раскрасит fresh.
            // Единственный рукописный def — по образцу numberColumn, сортировка по items.
            id: 'items',
            header: say('Items / fresh', 'Всего / свежих'),
            size: 116,
            enableSorting: true,
            accessorFn: (r: FeedSourceRow) => r.items,
            cell: ({ row }) => (
              // Числа не приглушаем и у выключенных (как «Раз в»: ячейки numberColumn
              // рендерит фабрика) — правило единое: тускнеет описательное, не метрики.
              <span className="block text-right font-mono tabular-nums text-[0.78125rem] text-ink-2">
                {row.original.items} / <span className={row.original.fresh ? 'text-ok' : ''}>{row.original.fresh}</span>
              </span>
            ),
          },
          nodeColumn<FeedSourceRow>({
            id: 'pulled',
            header: say('Pulled', 'Собран'),
            size: 148,
            render: (r) => (
              <div className="flex items-center justify-end gap-0.5">
                <span className={cn('mr-1 hidden text-[0.6875rem] text-muted sm:inline', !r.enabled && 'opacity-60')}>
                  {r.lastPulledAt ? timeAgo(r.lastPulledAt, lang) : '—'}
                </span>
                {/* Служебные действия — иконками в правом углу строки: на мобиле три подписи не
                    влезут, а иконка с подсказкой понятна и в 360px. */}
                <form action={pullFeedNow}>
                  <input type="hidden" name="id" value={r.id} />
                  <button
                    type="submit"
                    aria-label={say('Pull now', 'Тянуть сейчас')}
                    title={say('Pull now', 'Тянуть сейчас')}
                    className="grid size-11 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
                  >
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
            ),
          }),
        ]}
        data={rows}
      />
    </div>
  )
}
