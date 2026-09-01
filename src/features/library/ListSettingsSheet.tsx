'use client'

import { useState, type ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { iconSizeFor } from '@/shared/ui/control'
import { IconButton } from '@/shared/ui/IconButton'
import { Tooltip } from '@/shared/ui/Tooltip'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/shared/ui/sheet'
import { t, type Lang } from '@/shared/i18n'

/**
 * Свойства списка — в боковой панели, а не на самом экране (решение владельца 07.08).
 *
 * Экран создания и правки принадлежит ПУНКТАМ: описание, теги, тип, видимость и режим
 * курса заполняют один раз, а мешают всё время — на телефоне они занимали столько же
 * места, сколько сам редактор. Теперь их открывают кнопкой, а закрытие возвращает ровно
 * то же место в списке.
 *
 * Панель НЕ уходит в портал: её поля остаются потомками формы, и server-форма читает
 * их сама — без клиентского состояния и скрытых полей-двойников.
 *
 * И НЕ МОДАЛЬНАЯ — по той же причине. Поля обязаны быть в документе всё время
 * (иначе сохранение уносит форму без тегов и типа списка, #720), а модальный режим
 * Radix, увидев смонтированный контент, помечает ВСЁ ОСТАЛЬНОЕ `aria-hidden` — и
 * страница пропадает для экранного диктора, даже когда панель закрыта. Замер
 * 09.08.2026: корневой div body получал `aria-hidden="true"` при закрытой панели,
 * и Playwright не находил на странице ни одной роли.
 *
 * Что теряется без модальности: фокус не запирается внутри открытой панели, фон не
 * блокируется. Для панели, которая ЯВЛЯЕТСЯ ЧАСТЬЮ формы, это правильнее — уйти
 * табом к остальным полям той же формы законно. Esc и клик вне панели по-прежнему
 * закрывают её (это Radix делает и без модального режима).
 *
 * `defaultOpen` — для нового списка: там панель ещё и подсказывает, что настройки
 * вообще есть.
 */
export function ListSettingsSheet({ lang, defaultOpen = false, children }: { lang: Lang; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Sheet open={open} onOpenChange={setOpen} modal={false}>
      {/* Иконка без подписи: кнопка стоит в одном ряду с полем названия, и текст
          рядом с ним читается как второй заголовок. Смысл даёт тултип и подпись
          для диктора — как у остальных иконочных кнопок приложения. */}
      {/* Порядок обёрток ВАЖЕН: Tooltip снаружи, SheetTrigger внутри. Наоборот
          триггер отдавал свои onClick/aria-* Тултипу, а тот их не пробрасывает —
          кнопка оставалась немой, и панель не открывалась вовсе (поймано смоком
          09.08.2026). */}
      <Tooltip label={t('listSettings', lang)}>
        <SheetTrigger asChild>
          {/* ⚠️ РАЗМЕР — ПО СОСЕДНЕМУ ПОЛЮ, А НЕ ПО УМОЛЧАНИЮ. Кнопка стоит в одном ряду
              с полем `size="lg"` (40px), а сама шла ступенью `md` (32px) — в ряду это
              читается как разнобой, даже когда центры совпадают (замечание владельца
              01.09.2026: «кнопка настроек должна быть по высоте поля»). */}
          <IconButton variant="outline" size="lg" label={t('listSettings', lang)}>
            <SlidersHorizontal size={iconSizeFor()} />
          </IconButton>
        </SheetTrigger>
      </Tooltip>
      <SheetContent
        portal={false}
        closeLabel={t('close', lang)}
        aria-describedby={undefined}
        // Escape В ПОЛЕ принадлежит полю, а не панели: там он закрывает подсказку
        // автокомплита (теги), и захлопывать вместе с ней всю панель — значит
        // прятать от человека то, что он правит. Остановить это из самого поля
        // нельзя: Radix слушает Escape на документе в фазе ПЕРЕХВАТА и получает
        // событие раньше любого React-обработчика (09.08.2026, поймано смоком).
        onEscapeKeyDown={(e) => {
          const el = document.activeElement
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) e.preventDefault()
        }}
      >
        <SheetHeader>
          <SheetTitle>{t('listSettings', lang)}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-5">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
