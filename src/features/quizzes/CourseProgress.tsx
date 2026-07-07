import { GraduationCap } from 'lucide-react'
import type { Lang } from '@/shared/i18n'

/** Прогресс прохождения тестов списка для текущего зрителя (сервер-компонент).
 *  Показываем, только когда в списке есть quiz-блоки и зритель авторизован. */
export function CourseProgress({ passed, total, lang }: { passed: number; total: number; lang: Lang }) {
  if (total <= 0) return null
  const ru = lang === 'ru'
  const pct = Math.round((passed / total) * 100)
  const done = passed >= total
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <GraduationCap size={18} className={done ? 'shrink-0 text-ok' : 'shrink-0 text-accent'} />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-[12.5px]">
          <span className="font-medium text-ink">
            {done ? (ru ? 'Курс пройден' : 'Course complete') : ru ? 'Прогресс по тестам' : 'Quiz progress'}
          </span>
          <span className="font-mono text-muted">
            {passed}/{total}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className={`h-full rounded-full ${done ? 'bg-ok' : 'bg-accent'}`} style={{ width: `${pct}%` }} aria-hidden />
        </div>
      </div>
    </div>
  )
}
