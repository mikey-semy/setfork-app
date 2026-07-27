import Link from 'next/link'
import { MessagesSquare, FileDiff } from 'lucide-react'

export type SuggestionTab = 'conversation' | 'files'

/**
 * Вкладки правки (PR): Обсуждение | Изменения.
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
  filesCount,
  labels,
}: {
  path: string
  active: SuggestionTab
  conversationCount: number
  filesCount: number
  labels: { conversation: string; files: string }
}) {
  const item = (tab: SuggestionTab, icon: React.ReactNode, label: string, count: number) => {
    const on = tab === active
    return (
      <Link
        href={tab === 'conversation' ? path : `${path}?tab=${tab}`}
        aria-current={on ? 'page' : undefined}
        className={`inline-flex h-[38px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[12.5px] font-medium ${
          on ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink'
        }`}
      >
        <span className={on ? 'text-ink' : 'text-muted'}>{icon}</span>
        {label}
        {count > 0 && <span className="rounded-full bg-surface px-1.5 text-[11.5px] text-ink-2">{count}</span>}
      </Link>
    )
  }
  return (
    // Ряд листается в своём контейнере — страница горизонтально не едет.
    <div className="no-scrollbar mb-4 flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1">
      {item('conversation', <MessagesSquare size={14} />, labels.conversation, conversationCount)}
      {item('files', <FileDiff size={14} />, labels.files, filesCount)}
    </div>
  )
}
