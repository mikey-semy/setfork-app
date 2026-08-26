import Link from 'next/link'
import { CONTROL_H } from '@/shared/ui/control'
import { ScrollRow } from '@/shared/ui/ScrollRow'
import { MessagesSquare, FileDiff, CircleCheck, GitCommitHorizontal, Eye } from 'lucide-react'
import { cardClass } from '@/shared/ui/card-style'

export type SuggestionTab = 'conversation' | 'commits' | 'checks' | 'files' | 'result'

/**
 * Вкладки предложения: Обсуждение | Коммиты | Проверки | Изменения | Итог.
 *
 * «Итог» — как список будет выглядеть, ЕСЛИ предложение принять. Дифф отвечает на другой вопрос
 * («что изменилось»), а решение принимают по результату; без этого вида предложения от компании
 * копились непринятыми — посмотреть результат было негде.
 *
 * Переключение через ?tab= — адрес остаётся ссылабельным (можно кинуть коллеге
 * ссылку прямо на изменения), в отличие от клиентского состояния. Отдельного
 * маршрута не заводим: содержимое одной сущности, а не разные страницы.
 *
 * Счётчики в подписи, как у GitHub: сколько обсуждений и сколько изменённых
 * пунктов — видно до перехода.
 */
export function SuggestionTabs({
  path,
  active,
  conversationCount,
  commitsCount,
  filesCount,
  checksFailed,
  labels,
  arrows,
}: {
  path: string
  active: SuggestionTab
  conversationCount: number
  /** Коммиты ветки; у правок без ветки их нет — вкладку не показываем. */
  commitsCount: number | null
  filesCount: number
  /** Сколько проверок блокирует — счётчик показываем только когда есть что чинить. */
  checksFailed: number
  labels: { conversation: string; commits: string; checks: string; files: string; result: string }
  /** Подписи стрелок листания — ряд из пяти вкладок на мобиле не влезает. */
  arrows: { prev: string; next: string }
}) {
  const item = (tab: SuggestionTab, icon: React.ReactNode, label: string, count: number) => {
    const on = tab === active
    return (
      <Link
        href={tab === 'conversation' ? path : `${path}?tab=${tab}`}
        aria-current={on ? 'page' : undefined}
        className={`inline-flex ${CONTROL_H.md} shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-body-sm font-medium ${
          on ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink'
        }`}
      >
        <span className={on ? 'text-ink' : 'text-muted'}>{icon}</span>
        {label}
        {count > 0 && <span className="rounded-full bg-surface px-1.5 text-caption text-ink-2">{count}</span>}
      </Link>
    )
  }
  return (
    // Ряд листается В СВОЁМ контейнере (страница горизонтально не едет) и ПОКАЗЫВАЕТ,
    // что листается: тем же ScrollRow, что и верхние вкладки списка. Без стрелок
    // пятая вкладка на мобиле выглядела просто обрезанной.
    <ScrollRow outerClassName="mb-4" className={cardClass({ pad: 'xs', className: 'flex gap-1' })} label={arrows}>
      {item('conversation', <MessagesSquare size={14} />, labels.conversation, conversationCount)}
      {commitsCount !== null && item('commits', <GitCommitHorizontal size={14} />, labels.commits, commitsCount)}
      {item('checks', <CircleCheck size={14} />, labels.checks, checksFailed)}
      {item('files', <FileDiff size={14} />, labels.files, filesCount)}
      {item('result', <Eye size={14} />, labels.result, 0)}
    </ScrollRow>
  )
}
