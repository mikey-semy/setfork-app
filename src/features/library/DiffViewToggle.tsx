import Link from 'next/link'
import { Code2, List } from 'lucide-react'
import { CONTROL_H } from '@/shared/ui/control'

/**
 * Переключатель вида диффа «код / список» — ОДИН на сравнение версий и на правку.
 *
 * Раньше он был свёрстан внутри страницы сравнения, а у правки вида не было
 * вовсе. Вид держим в ?view=, а не в состоянии: ссылка на «код» остаётся
 * ссылкой на «код».
 */
export function DiffViewToggle({
  path,
  tab,
  commit,
  view,
  labels,
}: {
  /** Адрес БЕЗ параметров запроса. Параметры собираем здесь — см. href ниже. */
  path: string
  /** Вкладка правки (сохраняется при переключении вида); пусто — страница сравнения. */
  tab?: string
  /** Показываемый коммит (вкладка «коммиты»): переключение вида его не теряет. */
  commit?: string
  view: 'code' | 'list'
  labels: { code: string; list: string }
}) {
  // Параметры собираем ОДНИМ местом, а не дописываем к готовой строке. Раньше сюда
  // приходил путь, где уже стояли `?tab=commits&commit=<sha>`, и хвост `?tab=…`
  // приписывался вторым: в `commit` попадало значение вида «<sha>?tab=commits», оно
  // не совпадало ни с одним коммитом, и переключение вида выбрасывало на список
  // коммитов вместо смены вида.
  const href = (v: 'code' | 'list') => {
    const qs = new URLSearchParams()
    if (tab) qs.set('tab', tab)
    if (commit) qs.set('commit', commit)
    qs.set('view', v)
    return `${path}?${qs.toString()}`
  }
  const item = (v: 'code' | 'list', icon: React.ReactNode, label: string) => (
    <Link
      href={href(v)}
      aria-current={v === view ? 'page' : undefined}
      className={`inline-flex ${CONTROL_H.md} items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium ${
        v === view ? 'bg-primary text-primary-fg' : 'text-ink-2 hover:text-ink'
      }`}
    >
      {icon} {label}
    </Link>
  )
  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-surface-2 p-0.5">
      {item('code', <Code2 size={14} />, labels.code)}
      {item('list', <List size={14} />, labels.list)}
    </div>
  )
}
