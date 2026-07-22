import { ListHeader } from '@/widgets/ListHeader'

/** Персистентная шапка списка (= «репозиторий»): рендерится ОДИН раз на весь сегмент
 *  [handle]/[slug]/*. В App Router layout НЕ перемонтируется при переходе между
 *  дочерними вкладками (Список/Задачи/Предложения/…), поэтому меню и полоска активной
 *  вкладки больше не «моргают». Активная вкладка определяется клиентски в ListTabs. */
export default async function ListLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ handle: string; slug: string }>
}) {
  const { handle, slug } = await params
  return (
    <>
      <ListHeader owner={handle} slug={slug} />
      {children}
    </>
  )
}
