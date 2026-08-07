'use client'

import { useState, type ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { iconSizeFor } from '@/shared/ui/control'
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
 * `defaultOpen` — для нового списка: там панель ещё и подсказывает, что настройки
 * вообще есть.
 */
export function ListSettingsSheet({ lang, defaultOpen = false, children }: { lang: Lang; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal size={iconSizeFor('sm')} />
          {t('listSettings', lang)}
        </Button>
      </SheetTrigger>
      <SheetContent portal={false} closeLabel={t('close', lang)} aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>{t('listSettings', lang)}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-5">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
