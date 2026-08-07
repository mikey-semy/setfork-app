import type { LucideIcon } from 'lucide-react'
import { TOUCH_BOX } from './control'
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
 * Одиночная пометка-переключатель — ТА ЖЕ геометрия, что у сегмента: рамка, внутри
 * квадрат. Чип с текстом стоял в одном ряду с сегментами на несколько пикселей ниже,
 * и ряд читался неровным (замечание владельца 07.08).
 *
 * Смысл несёт подпись поля сверху, как у соседей: у «или-или» невыбранный вариант
 * подсказывает смысл выбранного, а одинокая иконка без подписи — ребус, особенно на
 * тач-экране, где тултипа нет.
 */
export function IconCheckbox({ name, Icon, label, hint, checked }: Omit<IconOption, 'value'> & { name: string }) {
  return (
    <div className="inline-flex rounded-md border border-border bg-surface-2 p-0.5">
      <Tooltip label={title(label, hint)}>
        <label aria-label={label} className={`${BOX} ${CHECKED}`}>
          <input type="checkbox" name={name} defaultChecked={checked} className="sr-only" />
          <Icon size={16} />
        </label>
      </Tooltip>
    </div>
  )
}
