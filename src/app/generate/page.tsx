import { redirect } from 'next/navigation'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { hasOpenRouterKey } from '@/shared/settings/ai'
import { sampleListTitles } from '@/features/library/sample-titles'
import { GenerateForm } from '@/features/generation/GenerateForm'

export const metadata = { title: 'Draft a list' }

// Старт генерации как у поисковика: без заголовка/подзаголовка — только большое поле по центру
// и «живые» варианты-подсказки. Уведомления и лоадер живут внутри GenerateForm.
export default async function GeneratePage({ searchParams }: { searchParams: Promise<{ e?: string; q?: string }> }) {
  const [lang, session, sp] = await Promise.all([getLang(), getSession(), searchParams])
  if (!session) redirect('/login')
  const aiOn = hasOpenRouterKey()
  const suggestions = await sampleListTitles(lang, 6)

  return <GenerateForm lang={lang} aiOn={aiOn} defaultQuery={sp.q ?? ''} suggestions={suggestions} errorKind={sp.e} />
}
