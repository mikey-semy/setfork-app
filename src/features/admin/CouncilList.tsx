import Link from 'next/link'
import { CircleUser, Sparkles } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { Button } from '@/shared/ui/button'
import { DataTable, DataTableRow } from '@/shared/ui/DataTable'
import { tr, type Lang } from '@/shared/i18n'
import { selfGenerateNow } from '@/features/admin/actions'

/**
 * СПИСОК СПЕЦИАЛИСТОВ — ровными столбцами, а настройки у каждого на своей странице.
 *
 * Было: двадцать полных форм на одной странице сеткой в три колонки. Это не «много
 * настроек» — это стена, в которой нельзя ни найти нужного, ни увидеть состав целиком.
 * Настройки списка живут на странице списка; у специалиста ровно та же логика — свой адрес,
 * свои настройки, а здесь СОСТАВ: кто есть, в каком он состоянии и куда нажать.
 *
 * Столбцы фиксированной ширины: `auto` подгоняется под содержимое КАЖДОЙ строки, и шапка со
 * строками разъезжаются «волной» (проверено на щитке моделей). Числа моноширинными цифрами —
 * иначе строки плавают по ширине разряда.
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
      {/* Шапка и строки — ОДИН шаблон колонок (DataTable); скроллится контейнер, страница никогда. */}
      <DataTable
        template="minmax(0,1fr) 132px 120px 104px 88px"
        minWidth={720}
        header={
          <>
            <span>{tr({ en: 'Specialist', ru: 'Специалист' }, lang)}</span>
            <span>{tr({ en: 'Craft', ru: 'Ремесло' }, lang)}</span>
            <span>{tr({ en: 'Stage', ru: 'Стадия' }, lang)}</span>
            <span className="text-right">{tr({ en: 'Councils', ru: 'Советов' }, lang)}</span>
            <span className="text-right">{tr({ en: 'Accepted', ru: 'Принято' }, lang)}</span>
          </>
        }
      >
        {rows.map((r) => {
          const stage = stageLabel(r.lifecycle, lang)
          return (
            <DataTableRow key={r.id} muted={!r.enabled}>
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar handle={r.handle ?? r.id} avatarUrl={r.avatarUrl} size={28} />
                <div className="min-w-0">
                  {/* Вся строка ведёт к настройкам этого специалиста — как список к своим. */}
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
              <span className="min-w-0 truncate text-[0.78125rem] text-ink-2" title={r.domains.join(', ')}>
                {r.profession || r.guild}
              </span>
              <span className={`text-[0.78125rem] ${stage.cls}`}>{stage.text}</span>
              <span className="text-right font-mono tabular-nums text-[0.8125rem] text-ink-2">{r.gens}</span>
              <span className="text-right font-mono tabular-nums text-[0.8125rem] text-ink-2">{r.accepted}</span>
            </DataTableRow>
          )
        })}
      </DataTable>

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
