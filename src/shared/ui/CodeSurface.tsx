'use client'
import { WrapText } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCodeWrap } from '@/shared/lib/code-wrap'
import { t, type Lang } from '@/shared/i18n'
import { cn } from '@/shared/lib/cn'
import { CopyButton } from './CopyButton'
import { Tooltip } from './Tooltip'
import { TEXT } from './control'
import { buttonClass } from './button-style'
import type { CodeToken } from './highlight-code'

/**
 * Поверхность блока кода: полоса с языком и действиями, тело со строками.
 *
 * ⚠️ ПЕРЕНОС — ВЫБОР ЧИТАТЕЛЯ, А НЕ НАСТРОЙКА ПРОДУКТА. По умолчанию прокрутка: так
 * показывают код в статьях GitHub, GitLab, Gitea, Stack Overflow, dev.to и Docusaurus.
 * Но прокрутка без выхода — то, на что и жалуются, поэтому оба продукта, думавшие об
 * этом дольше прочих, дали читателю тумблер: GitHub в просмотре файла («Wrap lines» в
 * меню, память в localStorage) и Docusaurus кнопкой на самом блоке. Ни у кого это не
 * настройка аккаунта и не параметр адреса — значит и у нас живёт на блоке.
 *
 * ⚠️ КНОПКА ПОЯВЛЯЕТСЯ ТОЛЬКО КОГДА КОД НЕ ВЛЕЗАЕТ — по ИЗМЕРЕНИЮ, а не по догадке
 * (условие `isEnabled || isCodeScrollable` у Docusaurus, пересчёт на resize). На
 * коротком блоке её нет вовсе: предлагать «перенести» там, где переносить нечего, —
 * шум.
 *
 * ⚠️ КОНТРОЛ ВИДЕН БЕЗ НАВЕДЕНИЯ. У Docusaurus он `opacity: 0` до hover, и на тач-экране
 * его практически не найти — это их открытая заявка #10821. У нас мобильный
 * основополагающий, поэтому кнопка видна всегда.
 *
 * ⚠️ ПРИ ПЕРЕНОСЕ РВЁМ `overflow-wrap: anywhere`, А НЕ `word-break: break-all`. Первое
 * рвёт только то, что физически не влезает (так у Gitea и Docusaurus), второе рубит
 * идентификатор посреди токена (так у Forgejo) — читателю-программисту это хуже.
 *
 * ⚠️ НОМЕРА СТРОК И ЯЗЫК — НАШЕ СОЗНАТЕЛЬНОЕ ОТКЛОНЕНИЕ, не забытая мелочь. Из десяти
 * разобранных продуктов номера в читаемом тексте не показывает НИКТО (только просмотр
 * файла), а язык показывает один MDN. Мы держим оба: формат Commitics ссылается на
 * строки кода («см. строку 45») — у номеров есть функция, а не украшение; язык нужен
 * потому, что разборы идут по разным языкам. Не «исправляйте» это под общий обычай, не
 * убрав сперва причину.
 */
export function CodeSurface({
  code,
  label,
  lines,
  lang,
}: {
  code: string
  label: string
  lines: CodeToken[][]
  lang?: Lang
}) {
  // Выбор общий с редактором списка: и там, и тут это одно решение читателя.
  const [wrap, toggle] = useCodeWrap()
  const [scrollable, setScrollable] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Измеряем сам блок, а не длину строк в символах: ширина зависит от шрифта, кегля и
  // экрана. Пересчёт на resize — поворот телефона меняет ответ.
  const measure = useCallback(() => {
    const el = bodyRef.current
    if (el) setScrollable(el.scrollWidth > el.clientWidth + 1)
  }, [])

  useEffect(() => {
    measure()
    const el = bodyRef.current
    if (!el || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, wrap])

  const wrapLabel = t(wrap ? 'code.noWrap' : 'code.wrap', lang ?? 'en')

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1 print:hidden">
        <span className={`font-mono ${TEXT.caption} uppercase tracking-wide text-muted`}>{label}</span>
        <div className="flex items-center gap-0.5">
          {/* Кнопки нет, пока код влезает: переносить нечего. Она же остаётся видимой
              при включённом переносе — иначе выключить его было бы нечем. */}
          {(scrollable || wrap) && (
            <Tooltip label={wrapLabel}>
              <button
                type="button"
                onClick={toggle}
                aria-pressed={wrap}
                aria-label={wrapLabel}
                className={buttonClass({
                  variant: 'ghost',
                  size: 'sm',
                  className: cn('px-1.5', wrap && 'text-accent'),
                })}
              >
                <WrapText size={14} />
              </button>
            </Tooltip>
          )}
          <CopyButton text={code} lang={lang} size="sm" />
        </div>
      </div>
      <div
        ref={bodyRef}
        className={cn(
          'py-2 font-mono text-body-sm leading-[1.55] text-ink print:overflow-visible',
          // Отступы во вложенном коде на узком экране съедают строку: табуляция в 2
          // колонки вместо 4 отыгрывает их без всякого переноса (техника WCAG G224).
          'tab-2 sm:tab-4',
          wrap ? 'overflow-x-hidden' : 'overflow-x-auto overscroll-x-contain',
        )}
      >
        {/* ⚠️ ШИРИНА ЗАДАЁТСЯ ЗДЕСЬ, ОДНА НА ВСЕ СТРОКИ. Если её просить у каждой строки
            отдельно (`w-max`), короткая получает свою — по содержимому, — и при
            прокрутке вправо уезжает из видимой области целиком, унося прилипший номер:
            нумерация пропадает через строку (находка авто-ревью #858). */}
        <div className={cn(wrap ? 'w-full' : 'w-max min-w-full', 'print:w-auto')}>
          {lines.map((tokens, i) => (
            // Ни отступа под служебный угол, ни исключений для первой строки: все строки
            // равны — иначе рвётся выравнивание, а в коде колонки несут смысл.
            <div key={i} className="flex w-full gap-2 px-2.5">
              <span className="sticky left-0 z-10 w-5 shrink-0 select-none bg-surface-2 text-right text-caption leading-[1.7] text-muted print:static">
                {i + 1}
              </span>
              <span
                className={cn(
                  'print:whitespace-pre-wrap print:[overflow-wrap:anywhere]',
                  wrap ? 'min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre',
                )}
              >
                {tokens.length === 0
                  ? ' '
                  : tokens.map((tok, j) =>
                      tok.cls ? (
                        <span key={j} className={tok.cls}>
                          {tok.text}
                        </span>
                      ) : (
                        <span key={j}>{tok.text}</span>
                      ),
                    )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
