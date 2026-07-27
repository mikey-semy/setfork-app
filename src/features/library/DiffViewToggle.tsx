import Link from 'next/link'
import { Code2, List } from 'lucide-react'

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
  view,
  labels,
}: {
  path: string
  /** Вкладка правки (сохраняется при переключении вида); пусто — страница сравнения. */
  tab?: string
  view: 'code' | 'list'
  labels: { code: string; list: string }
}) {
  const href = (v: 'code' | 'list') => `${path}?${tab ? `tab=${tab}&` : ''}view=${v}`
  const item = (v: 'code' | 'list', icon: React.ReactNode, label: string) => (
    <Link
      href={href(v)}
      aria-current={v === view ? 'page' : undefined}
      className={`inline-flex h-[38px] items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium ${
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
