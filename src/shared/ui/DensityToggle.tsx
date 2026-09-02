'use client'
import { Rows2, Rows3 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useOptimistic, useTransition } from 'react'
import { t, type Lang } from '@/shared/i18n'
import { DENSITY_COOKIE, type ListDensity } from '@/shared/lib/list-density'
import { Tooltip } from '@/shared/ui/Tooltip'
import { Segment, SegmentedControl } from '@/shared/ui/SegmentedControl'

const YEAR = 60 * 60 * 24 * 365

/**
 * Переключатель плотности списка — как у GitHub над перечнем репозиториев.
 *
 * Просьба владельца 01.09.2026: у нас карточка на телефоне занимает вдвое больше места,
 * чем строка репозитория у GitHub, и десяток списков уже не окинуть взглядом. «Плотно»
 * убирает обложку, описание, теги и подвал с датой, оставляя имя, состояние и счётчики.
 *
 * ⚠️ ОБОЙМОЙ `SegmentedControl`, А НЕ СВОЕЙ ПАРОЙ КНОПОК. Своя разметка была пятым
 * рецептом той же вещи и вдобавок брала не тот размер (`sm` в ряду из `md`), а узда
 * оформления её не видела: она стережёт роль обоймы, а не набор кнопок рядом.
 *
 * Выбор пишется в куку и применяется СЕРВЕРОМ при следующем рендере: `router.refresh()`
 * перерисовывает серверные карточки, а не прячет лишнее на клиенте. Иначе первый кадр
 * приходил бы чужой плотности и прыгал бы на глазах.
 */
export function DensityToggle({ value, lang }: { value: ListDensity; lang: Lang }) {
  const router = useRouter()
  const [, start] = useTransition()
  // ⚠️ НЕ `useState(value)`: копия пропа устаревает, когда сервер присылает другую
  // плотность (соседняя вкладка переключила — кука общая), и кнопка показывала бы
  // подсветку, не совпадающую с тем, что нарисовано. `useOptimistic` даёт мгновенный
  // отклик и сам сбрасывается на серверное значение — тот же приём, что у PinButton.
  const [density, setDensity] = useOptimistic(value, (_, next: ListDensity) => next)

  const pick = (next: ListDensity) => {
    if (next === density) return
    document.cookie = `${DENSITY_COOKIE}=${next}; path=/; max-age=${YEAR}; samesite=lax`
    // ⚠️ Записалось ли — ПРОВЕРЯЕМ. Присваивание `document.cookie` при заблокированных
    // куках молча ничего не делает и не бросает, поэтому try/catch тут был бы мёртвым:
    // кнопка осталась бы подсвеченной, а сервер продолжал бы слать прежнюю плотность.
    if (!document.cookie.includes(`${DENSITY_COOKIE}=${next}`)) return
    // Оптимистичное значение живёт только внутри перехода — иначе React сбросит его
    // сразу же, и подсветка мигнула бы обратно до прихода серверного кадра.
    start(() => {
      setDensity(next)
      router.refresh()
    })
  }

  const options = [
    { key: 'comfy' as const, Icon: Rows2, label: t('density.comfy', lang) },
    { key: 'compact' as const, Icon: Rows3, label: t('density.compact', lang) },
  ]

  return (
    <SegmentedControl label={t('density.label', lang)}>
      {options.map(({ key, Icon, label }) => (
        <Tooltip key={key} label={label}>
          <Segment active={density === key} onClick={() => pick(key)} aria-label={label}>
            <Icon size={15} />
          </Segment>
        </Tooltip>
      ))}
    </SegmentedControl>
  )
}
