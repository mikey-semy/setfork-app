import type { LucideIcon } from 'lucide-react'
import { TOUCH_BOX, TOUCH_MIN_H } from './control'
import { Tooltip } from './Tooltip'

/**
 * Компактный выбор иконками поверх обычных radio/checkbox.
 *
 * Смысл в том, что это по-прежнему поля формы: server-форма читает их сама, без
 * клиентского состояния и без скрытых input'ов-двойников. Текст живёт в подписи для
 * диктора и в тултипе — на телефоне полные названия вариантов («Публичный», «Виден
 * всем в обзоре и поиске») съедают экран, а выбор из двух-трёх состояний узнаётся по
 * иконке.
 */
const BOX = `grid size-9 cursor-pointer place-items-center rounded-[0.3125rem] text-ink-2 transition-colors hover:text-ink ${TOUCH_BOX}`
const CHECKED = 'has-[:checked]:bg-accent has-[:checked]:text-white'

export type IconOption = { value: string; Icon: LucideIcon; label: string; hint?: string; checked?: boolean }

const title = (label: string, hint?: string) => (hint ? `${label} — ${hint}` : label)

/** Сегмент «или-или»: тип списка, видимость. */
export function IconRadioGroup({ name, options }: { name: string; options: readonly IconOption[] }) {
  return (
    <div className="inline-flex rounded-md border border-border bg-surface-2 p-0.5">
      {options.map(({ value, Icon, label, hint, checked }) => (
        <Tooltip key={value} label={title(label, hint)}>
          <label aria-label={label} className={`${BOX} ${CHECKED}`}>
            <input type="radio" name={name} value={value} defaultChecked={checked} className="sr-only" />
            <Icon size={16} />
          </label>
        </Tooltip>
      ))}
    </div>
  )
}

/**
 * Одиночная пометка-переключатель. В отличие от сегмента подпись остаётся видимой:
 * у «или-или» невыбранный вариант подсказывает смысл выбранного, а у одинокой иконки
 * подсказки нет — и на тач-экране, где тултип не показывается, она превращается в
 * ребус.
 */
export function IconCheckbox({ name, Icon, label, hint, checked, short }: Omit<IconOption, 'value'> & { name: string; short: string }) {
  return (
    <Tooltip label={title(label, hint)}>
      <label
        aria-label={label}
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-2 text-[0.78125rem] text-ink-2 transition-colors hover:text-ink has-[:checked]:border-accent has-[:checked]:text-accent ${TOUCH_MIN_H}`}
      >
        <input type="checkbox" name={name} defaultChecked={checked} className="sr-only" />
        <Icon size={16} className="shrink-0" />
        {short}
      </label>
    </Tooltip>
  )
}
