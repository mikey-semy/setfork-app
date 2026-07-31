import { Check, ListTree } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { SectionLabel } from '@/shared/ui/SectionLabel'

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
    <nav className="rounded-lg border border-border bg-surface p-4">
      <SectionLabel className="mb-2 flex items-center gap-1.5">
        <ListTree size={12} /> {ru ? 'Содержание' : 'Contents'}
      </SectionLabel>
      <ol className="flex flex-col">
        {lessons.map((l, i) => {
          const done = showProgress && l.quizTotal > 0 && l.quizPassed >= l.quizTotal
          return (
            <li key={`${l.anchor}-${i}`}>
              <a href={`#${l.anchor}`} className="flex items-center gap-2 rounded-md px-1 py-1 text-[13px] text-ink-2 hover:text-accent">
                <span className="w-4 shrink-0 text-right font-mono text-[11px] text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{l.title}</span>
                {showProgress && l.quizTotal > 0 && (
                  <span className={`inline-flex shrink-0 items-center gap-0.5 font-mono text-[11px] ${done ? 'text-ok' : 'text-muted'}`}>
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
