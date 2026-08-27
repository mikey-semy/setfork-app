import Link from 'next/link'
import { Code2, List } from 'lucide-react'
import { Segment, SegmentedControl } from '@/shared/ui/SegmentedControl'

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
  labels: { code: string; list: string; group: string }
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
    <Segment active={v === view} href={href(v)}>
      {icon} {label}
    </Segment>
  )
  return (
    <SegmentedControl label={labels.group} size="md">
      {item('code', <Code2 size={14} />, labels.code)}
      {item('list', <List size={14} />, labels.list)}
    </SegmentedControl>
  )
}
