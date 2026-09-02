import { redirect } from 'next/navigation'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { hasAiEnvConfig } from '@/shared/settings/ai'
import { promptExamples } from '@/features/generation/prompt-examples'
import { GenerateForm } from '@/features/generation/GenerateForm'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('generateWithAi', lang) }
}

// Старт генерации как у поисковика: без заголовка/подзаголовка — только большое поле по центру
// и «живые» варианты-подсказки. Уведомления и лоадер живут внутри GenerateForm.
export default async function GeneratePage({ searchParams }: { searchParams: Promise<{ e?: string; q?: string }> }) {
  const [lang, session, sp] = await Promise.all([getLang(), getSession(), searchParams])
  if (!session) redirect('/login')
  const aiOn = hasAiEnvConfig()
  // ⚠️ ПРИМЕРЫ ЗАДАЧ, А НЕ ЗАГОЛОВКИ СУЩЕСТВУЮЩИХ СПИСКОВ. Раньше здесь стояли
  // живые названия из корпуса, и человеку предлагали создать то, что уже есть, — в том
  // числе его собственные списки (замечание владельца 02.09.2026). Витрина «что уже
  // есть» живёт на главной, там заголовки ведут на сами списки; здесь же клик означает
  // «сгенерировать», и предлагать существующее бессмысленно.
  const suggestions = promptExamples(lang, 6)

  return <GenerateForm lang={lang} aiOn={aiOn} defaultQuery={sp.q ?? ''} suggestions={suggestions} errorKind={sp.e} />
}
