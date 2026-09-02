import { CopyButton } from './CopyButton'
import { highlightLines } from './highlight-code'
import { TEXT } from './control'
import type { Lang } from '@/shared/i18n'

/**
 * Карточка кода для ЧТЕНИЯ (не редактор): подсветка синтаксиса, номера строк, имя языка
 * и копирование.
 *
 * ⚠️ НА ЭКРАНЕ ПРОКРУТКА, НА ПЕЧАТИ ПЕРЕНОС. Перенос стоял везде по правилу «код
 * показывают в его форме» (#407), но на телефоне он рвал строку посреди выражения:
 * `failures = append(failures,` и `common.Failure{` оказывались на разных строках, и
 * структура кода — то, ради чего его и читают, — рассыпалась (снимок владельца
 * 02.09.2026). Прокрутка честнее: строка остаётся строкой. На бумаге прокрутки нет
 * физически, поэтому там перенос остаётся.
 *
 * Номера при прокрутке закреплены слева (`sticky`): уехавшая нумерация бесполезна.
 * `overscroll-x-contain` — чтобы горизонтальный жест внутри блока не листал страницу.
 *
 * ⚠️ ШАПКА ВЕРНУЛАСЬ, И ВОТ ПОЧЕМУ. Служебные элементы висели в правом верхнем углу
 * ПОВЕРХ кода, и под них приходилось резервировать место. Сначала отступ давали одной
 * первой строке — она рвалась там, где соседние такой же длины помещались целиком, и
 * ломалось выравнивание колонок. Потом отступ выдали всем строкам, а место отняли у
 * номеров и у имени языка, спрятав их на телефоне, — владелец сразу спросил, куда они
 * делись, и был прав: это плата не за то.
 *
 * Полоса стоит 37px один раз на блок (замерено), а отступ под угол отнимал по 44px у
 * КАЖДОЙ строки.
 * На узком экране высота дешевле ширины: вертикально страница и так прокручивается, а
 * ширины взять неоткуда. Так же устроено у GitHub, Gitea и GitLab в просмотре файла:
 * имя слева, действия справа, код ниже во всю ширину.
 *
 * Подсветка построчная (highlight-code): токены раскладываются по строкам, поэтому
 * номера и перенос сохраняются — готовый HTML от highlight.js так резать нельзя.
 * Язык берём из `name`: он приходит из ограды markdown или от детектора.
 */
export function CodeCard({ code, name, lang }: { code: string; name?: string; lang?: Lang }) {
  const label = name || 'code'
  const lines = highlightLines(code, name)
  return (
    <div className="sf-code-card my-1.5 overflow-hidden rounded-md border border-border bg-surface-2">
      {/* Полоса: имя языка слева, копирование справа. На печать не идёт — там ни
          копировать нечего, ни языка спрашивать не у кого. */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1 print:hidden">
        <span className={`font-mono ${TEXT.caption} uppercase tracking-wide text-muted`}>{label}</span>
        <CopyButton text={code} lang={lang} size="sm" />
      </div>
      <div className="overflow-x-auto overscroll-x-contain py-2 font-mono text-body-sm leading-[1.55] text-ink print:overflow-visible">
        {lines.map((tokens, i) => (
          // Ни отступа под служебный угол, ни исключений для первой строки: все строки
          // равны — иначе рвётся выравнивание, а в коде колонки несут смысл.
          // `w-max min-w-full`: строки одной системы координат, поэтому прокручиваются
          // вместе, а не каждая сама по себе.
          <div key={i} className="flex w-max min-w-full gap-2 px-2.5 print:w-auto">
            <span className="sticky left-0 z-10 w-5 shrink-0 select-none bg-surface-2 text-right text-caption leading-[1.7] text-muted print:static">
              {i + 1}
            </span>
            <span className="whitespace-pre print:whitespace-pre-wrap print:[overflow-wrap:anywhere]">
              {tokens.length === 0 ? ' ' : tokens.map((t, j) => (t.cls ? <span key={j} className={t.cls}>{t.text}</span> : <span key={j}>{t.text}</span>))}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
