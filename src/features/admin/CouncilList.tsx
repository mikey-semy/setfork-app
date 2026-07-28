import Link from 'next/link'
import { CircleUser, Sparkles } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
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

const COLS = 'grid-cols-[minmax(0,1fr)_132px_120px_104px_88px]'

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
      {/* Шапка и строки — ОДИН шаблон колонок; скроллится контейнер, страница никогда. */}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <div className={`grid min-w-[720px] ${COLS} gap-4 border-b border-border px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted`}>
          <span>{tr({ en: 'Specialist', ru: 'Специалист' }, lang)}</span>
          <span>{tr({ en: 'Craft', ru: 'Ремесло' }, lang)}</span>
          <span>{tr({ en: 'Stage', ru: 'Стадия' }, lang)}</span>
          <span className="text-right">{tr({ en: 'Councils', ru: 'Советов' }, lang)}</span>
          <span className="text-right">{tr({ en: 'Accepted', ru: 'Принято' }, lang)}</span>
        </div>
        {rows.map((r) => {
          const stage = stageLabel(r.lifecycle, lang)
          return (
            <div
              key={r.id}
              className={`grid min-w-[720px] ${COLS} items-center gap-4 border-b border-border px-4 py-2.5 last:border-0 hover:bg-surface-2 ${
                r.enabled ? '' : 'opacity-60'
              }`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar handle={r.handle ?? r.id} avatarUrl={r.avatarUrl} size={28} />
                <div className="min-w-0">
                  {/* Вся строка ведёт к настройкам этого специалиста — как список к своим. */}
                  <Link href={`/admin/council/${r.id}`} className="block truncate text-[13.5px] font-medium text-ink hover:text-accent">
                    {r.name}
                  </Link>
                  <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted">
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
              <span className="min-w-0 truncate text-[12.5px] text-ink-2" title={r.domains.join(', ')}>
                {r.profession || r.guild}
              </span>
              <span className={`text-[12.5px] ${stage.cls}`}>{stage.text}</span>
              <span className="text-right font-mono tabular-nums text-[13px] text-ink-2">{r.gens}</span>
              <span className="text-right font-mono tabular-nums text-[13px] text-ink-2">{r.accepted}</span>
            </div>
          )
        })}
      </div>

      {/* Поручить список — действие над СОСТАВОМ, поэтому здесь, а не в настройках каждого.
          Кнопки только когда самогенерация включена: иначе обещали бы запрещённое настройками. */}
      {canAssign && (
        <div className="rounded-lg border border-border bg-surface p-3.5">
          <div className="mb-1 text-[12.5px] font-semibold text-ink">{tr({ en: 'Assign a list', ru: 'Поручить список' }, lang)}</div>
          <p className="mb-2.5 text-[11.5px] text-ink-2">
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
                  <button
                    type="submit"
                    className="inline-flex h-[38px] items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] text-ink hover:border-border-strong"
                  >
                    <Sparkles size={13} className="text-muted" /> {r.name}
                  </button>
                </form>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
