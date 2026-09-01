import { cn } from '@/shared/lib/cn'
import { CommandText } from './CommandText'
import { CopyButton } from './CopyButton'
import { CONTROL_H, CONTROL_TEXT } from './control'
import type { Lang } from '@/shared/i18n'

/**
 * Строка со значением и кнопкой «скопировать»: команда шага, адрес клонирования,
 * фраза-подтверждение. Одна на все три — раньше их было три рукописных, и ни одна
 * не совпадала с остальными по высоте (54, 42 и 44px при кнопке в 32).
 *
 * ВЫСОТА — ИЗ ШКАЛЫ, как у кнопки. Своей высоты у этих строк не было вовсе: её
 * считали отступы поверх кнопки копирования. Владелец увидел это на живом сайте —
 * «поле кода очень высокое». Узда линта ловит такое у контролов
 * (button/input/a/select/textarea), а контейнер здесь div, и правило до него не
 * достаёт: стережёт тест.
 *
 * Кнопка внутри — ступенью ниже (`sm`, 28px): рамка уже съедает 2px, и равная по
 * высоте кнопка из строки торчала бы. Тот же приём, что у поля с кнопкой внутри
 * (ChangeNoteField).
 */
export function CopyRow({
  value,
  lang,
  prompt = false,
  selectLabel,
  className,
}: {
  value: string
  lang?: Lang
  /** Показать `$` — значение является командой оболочки. */
  prompt?: boolean
  /** Задан — значение в поле, которое выделяется целиком по касанию (адрес для копирования
   *  руками). Подпись обязательна: у поля без неё нет имени для экранного диктора. */
  selectLabel?: string
  /** Для места вызова: например `print:hidden`, когда на печать идёт CodeCard. */
  className?: string
}) {
  // Многострочность определяется по самому значению, а не пропом: место вызова не знает
  // заранее, что придёт — команда бывает и однострочной, и скриптом.
  const multiline = value.includes('\n')
  return (
    <div
      className={cn(
        'flex gap-2 rounded-md border border-border bg-surface-2 pl-2.5 pr-1 font-mono text-ink',
        // ⚠️ ВЫСОТА ФИКСИРОВАНА ТОЛЬКО У ОДНОСТРОЧНОГО значения. Ступень шкалы взята
        // потому, что владелец видел «очень высокое поле кода», и для адреса, фразы и
        // однострочной команды она верна. Но многострочный скрипт при `h-8` показывался
        // ОДНОЙ строкой с невидимыми переносами: человек копирует не то, что видит.
        // Поэтому многострочное значение растёт по содержимому, оставаясь в тех же
        // отступах и с тем же кеглем.
        multiline ? 'items-start py-1.5' : cn('items-center', CONTROL_H.md),
        CONTROL_TEXT.sm,
        className,
      )}
    >
      {prompt && <span className="shrink-0 text-accent">$</span>}
      {selectLabel ? (
        <input
          readOnly
          value={value}
          aria-label={selectLabel}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 bg-transparent font-mono outline-hidden"
        />
      ) : (
        // Значение не переносится и не режется: длинное прокручивают вбок — обрезка
        // сделала бы его бесполезным, а перенос читался бы как две команды.
        // `no-scrollbar`: полосу здесь заменяет кнопка копирования — она забирает
        // значение ЦЕЛИКОМ, поэтому спрятанный вправо хвост ничем не грозит. А у
        // однострочного значения высота зажата ступенью шкалы, и классическая полоса
        // Windows отняла бы у строки половину.
        <CommandText value={value} className="no-scrollbar flex-1" />
      )}
      <CopyButton text={value} lang={lang} size="sm" />
    </div>
  )
}
