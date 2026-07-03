import { redirect } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { hasOpenRouterKey } from '@/shared/settings/ai'
import { t } from '@/shared/i18n'
import { GenerateForm } from '@/features/generation/GenerateForm'

export default async function GeneratePage({ searchParams }: { searchParams: Promise<{ e?: string; q?: string }> }) {
  const [lang, session, sp] = await Promise.all([getLang(), getSession(), searchParams])
  if (!session) redirect('/login')
  const ru = lang === 'ru'
  const aiOn = hasOpenRouterKey()

  return (
    <div className="mx-auto w-full max-w-[640px] px-6 py-10">
      <div className="mb-1 flex items-center gap-2 text-[18px] font-bold text-ink">
        <Sparkles size={18} className="text-accent" /> {t('generateWithAi', lang)}
      </div>
      <p className="mb-6 text-[13.5px] text-ink-2">
        {ru
          ? 'Опиши, что нужно сделать — нейросеть напишет черновик списка. Дальше его проверяет и улучшает сообщество.'
          : 'Describe what you need — AI drafts a list. The community then verifies and improves it.'}
      </p>

      {!aiOn && (
        <div className="mb-4 rounded-md border border-border bg-surface px-3 py-2.5 text-[13px] text-warn">
          {ru ? 'Генерация не настроена (нет ключа).' : 'Generation is not configured (no key).'}
        </div>
      )}
      {sp.e === 'aifail' && (
        <div className="mb-4 rounded-md border border-border bg-surface px-3 py-2.5 text-[13px] text-danger">
          {t('aiFail', lang)}
        </div>
      )}
      {sp.e === 'ratelimited' && (
        <div className="mb-4 rounded-md border border-border bg-surface px-3 py-2.5 text-[13px] text-warn">
          {t('rateLimited', lang)}
        </div>
      )}

      <GenerateForm lang={lang} aiOn={aiOn} defaultQuery={sp.q ?? ''} />
    </div>
  )
}
