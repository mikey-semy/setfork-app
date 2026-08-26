'use client'

import { Plus, Power, RefreshCw, Rss, Trash2 } from 'lucide-react'
import { t, tr, type Lang } from '@/shared/i18n'
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
import { Input } from '@/shared/ui/input'
import { cardClass } from '@/shared/ui/card-style'

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
  const ERRS: Record<string, string> = {
    'no-tags': t('admin.topicRequiredNobodyGuesses', lang),
    'bad-url': t('admin.feedAddressMustBe', lang),
    exists: t('admin.thisFeedAlreadySubscribed', lang),
    pull: t('admin.pullFailedReasonRow', lang),
    gone: t('admin.subscriptionNoLongerExists', lang),
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {err && ERRS[err] && <Alert variant="warn">{ERRS[err]}</Alert>}

      {/* ДОБАВИТЬ. Тема — обязательное поле рядом с адресом: подписка без темы бесполезна,
          материал из неё никому не достанется. */}
      <form action={addFeedSource} className={cardClass({ className: 'flex flex-col gap-2 sm:flex-row sm:items-end' })}>
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-caption uppercase tracking-wide text-muted">{t('admin.feedAddress', lang)}</span>
          <Input
            name="url"
            required
            inputMode="url"
            placeholder="https://example.com/feed.xml"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 sm:w-[12.5rem]">
          <span className="text-caption uppercase tracking-wide text-muted">{t('admin.topic', lang)}</span>
          <Input
            name="tags"
            required
            placeholder="devops, ci"
          />
        </label>
        <label className="flex flex-col gap-1 sm:w-[6rem]">
          <span className="text-caption uppercase tracking-wide text-muted">{t('admin.hours', lang)}</span>
          <Input
            name="everyHours"
            type="number"
            min={1}
            max={168}
            defaultValue={6}
          />
        </label>
        <Button type="submit" variant="primary" size="md" className="shrink-0">
          <Plus size={14} /> {t('admin.add', lang)}
        </Button>
      </form>

      <DataTableV2<FeedSourceRow>
        cardOnMobile
        rowKey={(r) => r.id}
        empty={{
          hint: t('admin.noSubscriptionsYetList', lang),
        }}
        columns={[
          nodeColumn<FeedSourceRow>({
            id: 'feed',
            header: t('admin.feed2', lang),
            render: (r) => (
              <div className={cn('min-w-0', !r.enabled && 'opacity-60')}>
                <div className="flex min-w-0 items-center gap-2">
                  <Rss size={13} className={`shrink-0 ${r.lastError ? 'text-warn' : 'text-accent'}`} />
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="min-w-0 truncate text-body text-ink hover:text-accent"
                    title={r.url}
                  >
                    {r.title || r.url.replace(/^https?:\/\//, '')}
                  </a>
                </div>
                {r.lastError && (
                  <Tooltip label={r.lastError}>
                    <div className="mt-0.5 truncate text-caption text-warn">{r.lastError}</div>
                  </Tooltip>
                )}
              </div>
            ),
          }),
          nodeColumn<FeedSourceRow>({
            id: 'topic',
            header: t('admin.topic', lang),
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
            header: t('admin.every', lang),
            size: 92,
            value: (r) => r.everyHours,
            format: (n) => `${n} ${t('admin.h', lang)}`,
          }),
          {
            // «Всего / свежих» — составная ячейка с подсветкой свежих, фабрика такого
            // не умеет: nodeColumn не сортируется, numberColumn не раскрасит fresh.
            // Единственный рукописный def — по образцу numberColumn, сортировка по items.
            id: 'items',
            header: t('admin.itemsFresh', lang),
            size: 116,
            enableSorting: true,
            accessorFn: (r: FeedSourceRow) => r.items,
            cell: ({ row }) => (
              // Числа не приглушаем и у выключенных (как «Раз в»: ячейки numberColumn
              // рендерит фабрика) — правило единое: тускнеет описательное, не метрики.
              <span className="block text-right font-mono tabular-nums text-body-sm text-ink-2">
                {row.original.items} / <span className={row.original.fresh ? 'text-ok' : ''}>{row.original.fresh}</span>
              </span>
            ),
          },
          nodeColumn<FeedSourceRow>({
            id: 'pulled',
            header: t('admin.pulled', lang),
            size: 148,
            render: (r) => (
              <div className="flex items-center justify-end gap-0.5">
                <span className={cn('mr-1 hidden text-caption text-muted sm:inline', !r.enabled && 'opacity-60')}>
                  {r.lastPulledAt ? timeAgo(r.lastPulledAt, lang) : '—'}
                </span>
                {/* Служебные действия — иконками в правом углу строки: на мобиле три подписи не
                    влезут, а иконка с подсказкой понятна и в 360px. */}
                <form action={pullFeedNow}>
                  <input type="hidden" name="id" value={r.id} />
                  <button
                    type="submit"
                    aria-label={t('admin.pullNow', lang)}
                    title={t('admin.pullNow', lang)}
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
                    aria-label={r.enabled ? t('admin.disable', lang) : t('admin.enable', lang)}
                    title={r.enabled ? t('admin.disable', lang) : t('admin.enable', lang)}
                    className={`grid size-11 place-items-center rounded-md hover:bg-surface-2 ${r.enabled ? 'text-ok' : 'text-muted'}`}
                  >
                    <Power size={15} />
                  </button>
                </form>
                <form action={removeFeedSource}>
                  <input type="hidden" name="id" value={r.id} />
                  <button
                    type="submit"
                    aria-label={t('admin.deleteCollectedItems', lang)}
                    title={t('admin.deleteCollectedItems', lang)}
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
