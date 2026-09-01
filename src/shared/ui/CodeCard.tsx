import { CopyButton } from './CopyButton'
import { highlightLines } from './highlight-code'
import { TEXT } from './control'
import type { Lang } from '@/shared/i18n'

/**
 * Карточка кода для ЧТЕНИЯ (не редактор): подсветка синтаксиса, номера строк, имя языка
 * и копирование. Перенос длинных строк вместо горизонтального скролла — правило
 * владельца: код показывают в его форме.
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
      <div className="py-2 font-mono text-body-sm leading-[1.55] text-ink">
        {lines.map((tokens, i) => (
          // Ни отступа под служебный угол, ни исключений для первой строки: все строки
          // равны и идут во всю ширину карточки — иначе рвётся выравнивание, а в коде
          // колонки несут смысл.
          <div key={i} className="flex gap-2 px-2.5">
            <span className="w-5 shrink-0 select-none text-right text-caption leading-[1.7] text-muted">{i + 1}</span>
            <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {tokens.length === 0 ? ' ' : tokens.map((t, j) => (t.cls ? <span key={j} className={t.cls}>{t.text}</span> : <span key={j}>{t.text}</span>))}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
