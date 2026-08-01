'use client'

import Link from 'next/link'
import { CircleUser, Sparkles } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { Button } from '@/shared/ui/button'
import { DataTableV2 } from '@/shared/ui/data-table/DataTableV2'
import { nodeColumn, numberColumn } from '@/shared/ui/data-table/column-builders'
import { cn } from '@/shared/lib/cn'
import { tr, type Lang } from '@/shared/i18n'
import { selfGenerateNow } from '@/features/admin/actions'
import { Tooltip } from '@/shared/ui/Tooltip'

/**
 * СПИСОК СПЕЦИАЛИСТОВ — ровными столбцами, а настройки у каждого на своей странице.
 *
 * Было: двадцать полных форм на одной странице сеткой в три колонки. Это не «много
 * настроек» — это стена, в которой нельзя ни найти нужного, ни увидеть состав целиком.
 * Настройки списка живут на странице списка; у специалиста ровно та же логика — свой адрес,
 * свои настройки, а здесь СОСТАВ: кто есть, в каком он состоянии и куда нажать.
 *
 * Таблица — DataTableV2 (Ф11, пилот): настоящая <table> с сортировкой по числам,
 * на мобиле строки становятся карточками (первая колонка — заголовок карточки).
 * Приглушение выключенного специалиста живёт ВНУТРИ ячеек: строки рендерит v2,
 * класс на строку повесить больше нельзя.
 */
export interface CouncilRow {
  id: string
  name: string
  profession: string
  guild: string
  role: string
  lifecycle: 'active' | 'idle' | 'dormant' | 'archived'
  enabled: boolean
  handle: string | null
  avatarUrl: string
  domains: string[]
  gens: number
  accepted: number
}

/** Подпись стадии карьеры. Слово «гном» в интерфейсе не появляется — только «специалист». */
function stageLabel(s: CouncilRow['lifecycle'], lang: Lang): { text: string; cls: string } {
  if (s === 'active') return { text: tr({ en: 'in service', ru: 'в строю' }, lang), cls: 'text-ok' }
  if (s === 'idle') return { text: tr({ en: 'at risk', ru: 'под риском' }, lang), cls: 'text-warn' }
  if (s === 'dormant') return { text: tr({ en: 'dormant', ru: 'спит' }, lang), cls: 'text-muted' }
  return { text: tr({ en: 'archived', ru: 'в архиве' }, lang), cls: 'text-muted' }
}

export function CouncilList({ rows, lang, canAssign }: { rows: CouncilRow[]; lang: Lang; canAssign: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <DataTableV2<CouncilRow>
        cardOnMobile
        rowKey={(r) => r.id}
        columns={[
          nodeColumn<CouncilRow>({
            id: 'specialist',
            header: tr({ en: 'Specialist', ru: 'Специалист' }, lang),
            render: (r) => (
              <div className={cn('flex min-w-0 items-center gap-2.5', !r.enabled && 'opacity-60')}>
                <Avatar handle={r.handle ?? r.id} avatarUrl={r.avatarUrl} size={28} />
                <div className="min-w-0">
                  {/* Имя ведёт к настройкам этого специалиста — как список к своим. */}
                  <Link href={`/admin/council/${r.id}`} className="block truncate text-[0.8125rem] font-medium text-ink hover:text-accent">
                    {r.name}
                  </Link>
                  <div className="flex min-w-0 items-center gap-1.5 text-[0.6875rem] text-muted">
                    {r.handle ? (
                      <Link href={`/${r.handle}`} className="truncate hover:text-ink-2">
                        @{r.handle}
                      </Link>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-warn">
                        <CircleUser size={11} /> {tr({ en: 'no account', ru: 'нет аккаунта' }, lang)}
                      </span>
                    )}
                    {!r.enabled && <span>· {tr({ en: 'off', ru: 'выключен' }, lang)}</span>}
                  </div>
                </div>
              </div>
            ),
          }),
          nodeColumn<CouncilRow>({
            id: 'craft',
            header: tr({ en: 'Craft', ru: 'Ремесло' }, lang),
            size: 132,
            render: (r) => (
              <Tooltip label={r.domains.join(', ')}>
                <span className={cn('block min-w-0 truncate text-[0.78125rem] text-ink-2', !r.enabled && 'opacity-60')}>
                  {r.profession || r.guild}
                </span>
              </Tooltip>
            ),
          }),
          nodeColumn<CouncilRow>({
            id: 'stage',
            header: tr({ en: 'Stage', ru: 'Стадия' }, lang),
            size: 120,
            render: (r) => {
              const stage = stageLabel(r.lifecycle, lang)
              return <span className={cn('text-[0.78125rem]', stage.cls, !r.enabled && 'opacity-60')}>{stage.text}</span>
            },
          }),
          numberColumn<CouncilRow>({ id: 'gens', header: tr({ en: 'Councils', ru: 'Советов' }, lang), size: 104, value: (r) => r.gens }),
          numberColumn<CouncilRow>({ id: 'accepted', header: tr({ en: 'Accepted', ru: 'Принято' }, lang), size: 88, value: (r) => r.accepted }),
        ]}
        data={rows}
      />

      {/* Поручить список — действие над СОСТАВОМ, поэтому здесь, а не в настройках каждого.
          Кнопки только когда самогенерация включена: иначе обещали бы запрещённое настройками. */}
      {canAssign && (
        <div className="rounded-lg border border-border bg-surface p-3.5">
          <div className="mb-1 text-[0.78125rem] font-semibold text-ink">{tr({ en: 'Assign a list', ru: 'Поручить список' }, lang)}</div>
          <p className="mb-2.5 text-[0.6875rem] text-ink-2">
            {tr(
              {
                en: 'The specialist picks what his area is missing and writes it. The result is a DRAFT authored by him — you publish it.',
                ru: 'Специалист сам выберет, чего не хватает в его области, и напишет. Результат — ЧЕРНОВИК от его имени, публикуешь вы.',
              },
              lang,
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {rows
              .filter((r) => r.enabled && r.lifecycle !== 'archived' && r.lifecycle !== 'dormant' && !r.domains.includes('*'))
              .map((r) => (
                <form key={r.id} action={selfGenerateNow}>
                  <input type="hidden" name="expertId" value={r.id} />
                  <Button type="submit" size="md">
                    <Sparkles size={13} className="text-muted" /> {r.name}
                  </Button>
                </form>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
