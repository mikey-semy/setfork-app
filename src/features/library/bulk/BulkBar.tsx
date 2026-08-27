'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FolderInput, Globe, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { IconButton } from '@/shared/ui/IconButton'
import { Input } from '@/shared/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { PAGE_X } from '@/shared/ui/control'
import { useViewportBottom } from '@/shared/ui/use-viewport-bottom'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { toast } from '@/shared/ui/toast'
import { Spinner } from '@/shared/ui/Spinner'
import { fill, plural, t, type Lang } from '@/shared/i18n'
import { bulkCreateCatalogAndMove, bulkPublish, bulkRestoreCatalog, bulkSetCatalog, type MoveResult, type PublishBatchResult } from './actions'
import { useSelection } from './selection'

/**
 * ПОЛОСА ПАКЕТНЫХ ДЕЙСТВИЙ — у большого пальца, как полоса сохранения форм.
 *
 * Действий два, и ведут они себя по-разному нарочно:
 *
 *  - РАЗЛОЖИТЬ ПО ПОЛКАМ выполняется сразу и предлагает «Отменить» в сообщении. Действие
 *    обратимо и никого наружу не выносит, поэтому спрашивать разрешение на каждую пачку —
 *    налог на внимание. Отмена возвращает каждый список на СВОЮ прежнюю полку.
 *  - ОПУБЛИКОВАТЬ сначала показывает план: сколько из отобранного вообще черновики, что
 *    станет видно сразу, а что уйдёт на авто-проверку. Это выход наружу — отменять поздно,
 *    спрашивать нужно до.
 */
/** Сколько списков публикация реально выведет: сразу и через проверку. Снятое модерацией не
 *  считается — публикация его состояния не меняет. */
const willPublish = (plan: PublishBatchResult) => plan.published + plan.pending

/** Сколько черновиков заняло места в пачке. Снятые модерацией место занимают наравне с
 *  прочими, поэтому предел считается по ним тоже — иначе «за раз влезает 15» при двадцати
 *  влезших (находка авто-ревью). */
const tookSlots = (plan: PublishBatchResult) => plan.published + plan.pending + plan.blocked

export function BulkBar({ lang, catalogs, allIds }: { lang: Lang; catalogs: { name: string; title: string }[]; allIds: string[] }) {
  const sel = useSelection()
  const router = useRouter()
  const { gap } = useViewportBottom()
  const [pending, start] = useTransition()
  const [newCatalog, setNewCatalog] = useState<string | null>(null)
  // План публикации держим состоянием, а не ждём ответа диалога внутри перехода: ожидание
  // решения человека держало бы переход «в работе» всё время, пока открыт вопрос, и полоса
  // крутила бы вертушку, ничего не делая.
  const [plan, setPlan] = useState<PublishBatchResult | null>(null)

  if (!sel?.active) return null
  const ids = [...sel.ids]
  const count = ids.length

  /** Общий хвост перекладывания: рассказать, что вышло, и предложить вернуть как было. */
  function report(res: MoveResult) {
    if (res.error) {
      toast.error(t(res.error === 'bad-name' ? 'bulk.badCatalogName' : 'bulk.catalogGone', lang))
      return
    }
    // Молча ничего не делать нельзя: человек нажал и обязан узнать результат, даже когда
    // результат — «ничего не изменилось» (отбор устарел, списки удалены из другой вкладки).
    if (!res.changed) {
      toast.error(t('bulk.nothingChanged', lang))
      return
    }
    sel?.stop()
    toast.success(fill('bulk.moved', lang, { n: res.changed, lists: plural(res.changed, 'lists', lang) }), {
      action: {
        label: t('bulk.undo', lang),
        onClick: () =>
          start(async () => {
            const back = await bulkRestoreCatalog(res)
            // refresh, а не только revalidatePath на сервере: возврат зовётся из тоста, вне
            // рендера страницы, и без явного обновления лента осталась бы с новой полкой.
            router.refresh()
            if (back.changed) toast.success(t('bulk.undone', lang))
          }),
      },
    })
  }

  function move(catalogName: string | null) {
    start(async () => report(await bulkSetCatalog(ids, catalogName)))
  }

  function createAndMove(title: string) {
    const name = title.trim()
    if (!name) return
    start(async () => {
      setNewCatalog(null)
      report(await bulkCreateCatalogAndMove(ids, name))
    })
  }

  /** Спросить план: что именно произойдёт. Сервер считает его теми же правилами, что и
   *  запись, — иначе «опубликую 30» на экране разошлось бы с «опубликовано 12» по факту. */
  function askPlan() {
    start(async () => {
      const next = await bulkPublish(ids)
      // Считаем то, что РЕАЛЬНО станет опубликованным: и уходящее в паблик сразу, и уходящее
      // на проверку. Снятое модерацией сюда не входит — публикация его не меняет.
      if (!willPublish(next)) {
        toast.error(t(next.blocked ? 'bulk.publishAllBlocked' : 'bulk.publishNothing', lang))
        return
      }
      setPlan(next)
    })
  }

  function doPublish() {
    start(async () => {
      const res = await bulkPublish(ids, false)
      setPlan(null)
      sel?.stop()
      // Между планом и согласием состояние успевает измениться из другой вкладки — тогда не
      // публикуется ничего. Пустой «успех» об этом молчит: все три числа нулевые, и человек
      // видит пустое сообщение вместо причины (находка авто-ревью).
      if (!tookSlots(res)) {
        toast.error(t('bulk.nothingChanged', lang))
        return
      }
      // Числа показываем только ненулевые: «Опубликовано: 0 · на проверке: 20» — правда,
      // но читается как сбой, хотя произошло ровно то, о чём предупредили.
      toast.success(
        [
          res.published ? fill('bulk.published', lang, { n: res.published }) : '',
          res.pending ? fill('bulk.pendingReview', lang, { n: res.pending }) : '',
          // Снятое модерацией называем своим именем: «на проверке» обещало бы проверку,
          // которой не будет — там решает админ.
          res.blocked ? fill('bulk.blocked', lang, { n: res.blocked }) : '',
        ]
          .filter(Boolean)
          .join(' · '),
      )
    })
  }

  return (
    <>
      <div
        // data-sticky-input — общий признак нижней панели: по нему кнопка «наверх» садится
        // НАД полосой, а не поверх её кнопок (см. ScrollToTop).
        data-sticky-input
        style={gap ? { bottom: gap } : undefined}
        className="animate-sf-rise fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm"
      >
        <div className={`${PAGE_X} flex items-center gap-2 py-2.5`}>
          {newCatalog === null ? (
            <>
              {/* Счётчик — единственный текст полосы; на телефоне он и есть подпись к действиям. */}
              <span className="shrink-0 text-body font-semibold text-ink">
                {count}
                <span className="ml-1 hidden font-normal text-ink-2 sm:inline">{t('bulk.selectedSuffix', lang)}</span>
              </span>
              {/* Ступень ряда, а не своя: рядом стоят действия `md`, и `sm` читалась волной
                  разных высот (правило Ф18 трека ui-system). Второстепенность показывает
                  вариант ghost, а не рост. */}
              {count < allIds.length && (
                <Button variant="ghost" size="md" onClick={() => sel.set(allIds)} disabled={pending} className="shrink-0">
                  {/* На телефоне то же действие двумя словами: длинному тексту в кнопке там не место. */}
                  <span className="sm:hidden">{fill('bulk.selectAllShort', lang, { n: allIds.length })}</span>
                  <span className="max-sm:hidden">{fill('bulk.selectAll', lang, { n: allIds.length })}</span>
                </Button>
              )}
              <div className="flex flex-1 items-center justify-end gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="md" disabled={!count || pending} aria-label={t('bulk.toCatalog', lang)}>
                      <FolderInput size={15} />
                      <span className="max-sm:hidden">{t('bulk.toCatalog', lang)}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="top">
                    {catalogs.map((c) => (
                      <DropdownMenuItem key={c.name} onSelect={() => move(c.name)}>
                        <span className="truncate">{c.title || c.name}</span>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuItem onSelect={() => setNewCatalog('')}>{t('bulk.newCatalog', lang)}</DropdownMenuItem>
                    {catalogs.length > 0 && <DropdownMenuSeparator />}
                    {catalogs.length > 0 && <DropdownMenuItem onSelect={() => move(null)}>{t('profile.catalogNone', lang)}</DropdownMenuItem>}
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button variant="primary" size="md" onClick={askPlan} disabled={!count || pending} aria-label={t('bulk.publish', lang)}>
                  {pending ? <Spinner size="md" /> : <Globe size={15} />}
                  <span className="max-sm:hidden">{t('bulk.publish', lang)}</span>
                </Button>

                {/* Выход из режима — квадратный крестик. `hit` вместо `grow`: высоту полосы
                    задают соседние кнопки, а растущий квадрат раздувал бы её сверх них. */}
                <IconButton variant="ghost" size="md" touch="hit" onClick={() => sel.stop()} disabled={pending} label={t('cancel', lang)}>
                  <X size={16} />
                </IconButton>
              </div>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                createAndMove(newCatalog)
              }}
              className="flex flex-1 items-center gap-2"
            >
              <Input
                autoFocus
                value={newCatalog}
                onChange={(e) => setNewCatalog(e.target.value)}
                placeholder={t('bulk.newCatalogPh', lang)}
                aria-label={t('bulk.newCatalog', lang)}
                className="min-w-0 flex-1"
              />
              <Button type="submit" variant="primary" size="md" disabled={!newCatalog.trim() || pending} className="shrink-0">
                {pending ? <Spinner size="md" /> : t('create', lang)}
              </Button>
              <IconButton variant="ghost" size="md" touch="hit" onClick={() => setNewCatalog(null)} label={t('cancel', lang)}>
                <X size={16} />
              </IconButton>
            </form>
          )}
        </div>
      </div>
      {plan && (
        <ConfirmDialog
          open
          onClose={() => setPlan(null)}
          title={fill('bulk.publishTitle', lang, { n: willPublish(plan), lists: plural(willPublish(plan), 'lists', lang) })}
          intro={[
            // Числа плана — в вопросе, а не только в ответе: соглашаются один раз, и
            // «сколько из них увидят не сразу» надо знать ДО согласия.
            plan.pending ? fill('bulk.publishPlanPending', lang, { n: plan.pending }) : t('bulk.publishIntro', lang),
            plan.blocked ? fill('bulk.publishPlanBlocked', lang, { n: plan.blocked }) : '',
            plan.skipped ? fill('bulk.publishSkipped', lang, { n: plan.skipped }) : '',
            plan.overflow ? fill('bulk.publishOverflow', lang, { n: tookSlots(plan) }) : '',
          ]
            .filter(Boolean)
            .join(' ')}
          confirmLabel={t('bulk.publish', lang)}
          cancelLabel={t('cancel', lang)}
          busy={pending}
          onConfirm={doPublish}
        />
      )}
    </>
  )
}
