import { Check, ListTree } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { SectionLabel } from '@/shared/ui/SectionLabel'
import { cardClass } from '@/shared/ui/card-style'
import { buttonClass } from '@/shared/ui/button-style'
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
              <a href={`#${l.anchor}`} className={buttonClass({ variant: 'ghost', className: 'hover:text-accent' })}>
                <span className="min-w-4 shrink-0 text-right font-mono text-[0.6875rem] text-muted">{num ?? i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{text}</span>
                {showProgress && l.quizTotal > 0 && (
                  <span className={`inline-flex shrink-0 items-center gap-0.5 font-mono text-[0.6875rem] ${done ? 'text-ok' : 'text-muted'}`}>
                    {done && <Check size={12} />}
                    {l.quizPassed}/{l.quizTotal}
                  </span>
                )}
              </a>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
