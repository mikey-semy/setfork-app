import { Check, ListTree } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { SectionLabel } from '@/shared/ui/SectionLabel'
import { cardClass } from '@/shared/ui/card-style'
import { MenuItem } from '@/shared/ui/MenuItem'
import { splitOrdinal } from '@/shared/lib/ordinal'

export interface OutlineLesson {
  title: string
  anchor: string
  quizTotal: number
  quizPassed: number
}

/** Оглавление курса: список уроков (секций) со ссылками-якорями. Если у зрителя
 *  есть прогресс по тестам урока — показываем N/M (галочка при 100%). */
export function CourseOutline({ lessons, showProgress, lang }: { lessons: OutlineLesson[]; showProgress: boolean; lang: Lang }) {
  if (lessons.length < 2) return null
  const ru = lang === 'ru'
  return (
    <nav className={cardClass()}>
      <SectionLabel className="mb-2 flex items-center gap-1.5">
        <ListTree size={12} /> {ru ? 'Содержание' : 'Contents'}
      </SectionLabel>
      <ol className="flex flex-col">
        {lessons.map((l, i) => {
          const done = showProgress && l.quizTotal > 0 && l.quizPassed >= l.quizTotal
          // Автор пронумеровал сам — показываем ЕГО номер вместо своего. Иначе выходит
          // дубль («1» рядом с «1. Обнаружение»), а у уже созданных списков убрать его
          // из текста нельзя без правки с публикацией. Многоуровневую нумерацию
          // («1.1», «1.2.3») интерфейс сам не рисует — тем более показываем авторскую.
          const { num, text } = splitOrdinal(l.title)
          return (
            <li key={`${l.anchor}-${i}`}>
              {/* ⚠️ Строка МЕНЮ, а не кнопка. Пункт был собран `buttonClass`, а это рецепт
                  кнопки: `inline-flex` берёт ширину по содержимому, `whitespace-nowrap` и
                  высота из шкалы запрещают перенос. В узкой колонке `truncate` при этом не
                  срабатывал вовсе — ограничивать было нечем, и длинный заголовок вылезал за
                  карточку: «Понедельник 14 сентября — первый заплыв и базовый замер» на
                  164px на десктопе (снимок владельца 14.09.2026, замер на 4 пунктах из 10).
                  Заголовок секции — содержание, а не подпись кнопки: он ПЕРЕНОСИТСЯ, а не
                  режется, иначе от «первого заплыва» осталось бы многоточие. `items-baseline`
                  держит номер на первой строке текста. */}
              <MenuItem href={`#${l.anchor}`} className="items-baseline hover:text-accent">
                <span className="min-w-4 shrink-0 text-right font-mono text-caption text-muted">{num ?? i + 1}</span>
                <span className="min-w-0 flex-1 break-words">{text}</span>
                {showProgress && l.quizTotal > 0 && (
                  <span className={`inline-flex shrink-0 items-center gap-0.5 font-mono text-caption ${done ? 'text-ok' : 'text-muted'}`}>
                    {done && <Check size={12} />}
                    {l.quizPassed}/{l.quizTotal}
                  </span>
                )}
              </MenuItem>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
