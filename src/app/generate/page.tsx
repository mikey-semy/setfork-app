import { redirect } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { hasOpenRouterKey } from '@/shared/settings/ai'
import { t, tr } from '@/shared/i18n'
import { GenerateForm } from '@/features/generation/GenerateForm'

export const metadata = { title: 'Draft a list' }

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
          ? 'Опиши, что нужно сделать — соберём черновик списка. Дальше его проверяет и улучшает сообщество.'
          : 'Describe what you need — we draft a list. The community then verifies and improves it.'}
      </p>

      {!aiOn && (
        <div className="mb-4 rounded-md border border-border bg-surface px-3 py-2.5 text-[13px] text-warn">
          {ru ? 'Черновики не настроены (нет ключа).' : 'Drafting is not configured (no key).'}
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
      {sp.e === 'ai_quota' && (
        <div className="mb-4 rounded-md border border-warn/50 bg-surface px-3 py-2.5 text-[13px] text-warn">
          {ru ? 'Исчерпан месячный лимит на черновики. Попробуй в следующем месяце.' : 'Monthly draft limit reached. Try again next month.'}
        </div>
      )}
      {sp.e === 'free_limit' && (
        <div className="mb-4 rounded-md border border-accent/40 bg-surface px-3 py-2.5 text-[13px] text-ink-2">
          {tr(
            {
              en: 'You have reached the free monthly generation limit. Pro removes the limit and unlocks the council (multi-model quality).',
              ru: 'Достигнут месячный лимит бесплатных генераций. Pro снимает лимит и открывает «совет» — мультимодельное качество.',
            },
            lang,
          )}
        </div>
      )}

      <GenerateForm lang={lang} aiOn={aiOn} defaultQuery={sp.q ?? ''} />
    </div>
  )
}
