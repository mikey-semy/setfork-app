import Link from 'next/link'
import { Award, GraduationCap, Trophy } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { Tooltip } from '@/shared/ui/Tooltip'
import { buttonClass } from '@/shared/ui/button-style'
import { IconButton } from '@/shared/ui/IconButton'

/** Прогресс прохождения тестов списка для текущего зрителя (сервер-компонент).
 *  Показываем, когда есть quiz-блоки ИЛИ курс уже пройден (completed).
 *  Прохождение — ПОСТОЯННЫЙ факт (courseCompletions): сертификат остаётся
 *  доступным навсегда, даже если автор изменил тесты и живой прогресс по
 *  текущей версии обнулился — иначе «пройди заново ради бумажки». */
export function CourseProgress({
  passed,
  total,
  lang,
  certificateHref,
  leaderboardHref,
  completed,
}: {
  passed: number
  total: number
  lang: Lang
  certificateHref?: string
  leaderboardHref?: string
  completed?: { version: number } | null
}) {
  if (total <= 0 && !completed) return null
  const ru = lang === 'ru'
  // Одна подпись на подсказку и на имя для диктора.
  const boardLabel = ru ? 'Лидерборд' : 'Leaderboard'
  const pct = total > 0 ? Math.round((passed / total) * 100) : 100
  // «Курс пройден» — ТОЛЬКО по записи прохождения. Решённые тесты сами по себе
  // прохождением не являются: на версии с шагами это половина условия
  // (shared/completion.ts), и надпись обещала бы сертификат, которого ещё нет.
  // Запись появляется в том же submitQuiz и приезжает сюда его revalidatePath,
  // поэтому ждать перезагрузки не приходится.
  const done = !!completed
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <GraduationCap size={18} className={done ? 'shrink-0 text-ok' : 'shrink-0 text-accent'} />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-body-sm">
          <span className="font-medium text-ink">
            {done ? (ru ? 'Курс пройден' : 'Course complete') : ru ? 'Прогресс по тестам' : 'Quiz progress'}
            {completed && <span className="ml-1.5 font-mono text-caption text-muted">v{completed.version}</span>}
          </span>
          {total > 0 && (
            <span className="font-mono text-muted">
              {passed}/{total}
            </span>
          )}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className={`h-full rounded-full ${done ? 'bg-ok' : 'bg-accent'}`} style={{ width: `${completed ? 100 : pct}%` }} aria-hidden />
        </div>
        {completed && total > 0 && passed < total && (
          <p className="mt-1 text-caption text-muted">{t('courseTestsChanged', lang)}</p>
        )}
      </div>
      {leaderboardHref && (
        <Tooltip label={boardLabel}>
          <IconButton href={leaderboardHref} variant="outline" label={boardLabel}>
            <Trophy size={14} />
          </IconButton>
        </Tooltip>
      )}
      {done && certificateHref && (
        <Link
          href={certificateHref}
          className={buttonClass({ className: 'border-ok/40 bg-ok/10 text-ok hover:bg-ok/15' })}
        >
          <Award size={14} /> {ru ? 'Сертификат' : 'Certificate'}
        </Link>
      )}
    </div>
  )
}
