import { headers } from 'next/headers'
import { eq } from 'drizzle-orm'
import { BarChart3, Bell, KeyRound, Monitor, TriangleAlert, User } from 'lucide-react'
import { db, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { avatarSrc } from '@/shared/media'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { getUserUsage } from '@/shared/ai/usage'
import { getApiTokens } from '@/features/mcp/queries'
import { ApiTokensSection } from '@/features/mcp/ApiTokensSection'
import { SettingsForm } from '@/features/settings/SettingsForm'
import { DangerZone } from '@/features/settings/DangerZone'
import { SettingsShell, type SettingsSection } from '@/features/settings/SettingsShell'
import { NotifyPrefsForm } from '@/features/notifications/NotifyPrefsForm'
import { getUserSessions } from '@/features/sessions/queries'
import { SessionsList } from '@/features/sessions/SessionsList'

const card = 'rounded-lg border border-border bg-surface p-5'

export default async function SettingsPage() {
  const session = await requireSession()
  const lang = await getLang()
  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1)
  if (!user) {
    const { redirect } = await import('next/navigation')
    redirect('/login')
  }
  const avatar = await avatarSrc(user.avatarUrl, 144)
  const userSessions = await getUserSessions(session.userId, session.sid)
  const usage = await getUserUsage(session.userId)
  const tokens = await getApiTokens(session.userId)
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const mcpUrl = `${proto}://${host}/api/mcp`

  const sections: SettingsSection[] = [
    {
      id: 'profile',
      title: t('publicProfile', lang),
      icon: <User size={15} />,
      keywords: ['profile', 'name', 'bio', 'avatar', 'location', 'website', 'social', 'профиль', 'имя', 'аватар', 'био', 'соцсети', 'сайт'],
      content: (
        <section className={card}>
          <div className="mb-4 font-semibold text-ink">{t('publicProfile', lang)}</div>
          <SettingsForm
            lang={lang}
            handle={user.handle}
            name={user.name ?? ''}
            avatarUrl={avatar}
            bio={user.bio ?? ''}
            location={user.location ?? ''}
            website={user.website ?? ''}
            socials={user.socials}
          />
        </section>
      ),
    },
    {
      id: 'notifications',
      title: t('notifPrefsTitle', lang),
      icon: <Bell size={15} />,
      keywords: ['notifications', 'stars', 'forks', 'suggestions', 'email', 'уведомления', 'звёзды', 'форки', 'правки'],
      content: (
        <section className={card}>
          <div className="mb-1 font-semibold text-ink">{t('notifPrefsTitle', lang)}</div>
          <p className="mb-4 text-[13px] text-ink-2">{t('notifPrefsIntro', lang)}</p>
          <NotifyPrefsForm prefs={user.notifyPrefs} lang={lang} />
        </section>
      ),
    },
    {
      id: 'sessions',
      title: t('sessionsTitle', lang),
      icon: <Monitor size={15} />,
      keywords: ['sessions', 'devices', 'sign out', 'security', 'revoke', 'сессии', 'устройства', 'выйти', 'безопасность'],
      content: (
        <section className={card}>
          <div className="mb-1 font-semibold text-ink">{t('sessionsTitle', lang)}</div>
          <p className="mb-4 text-[13px] text-ink-2">{t('sessionsIntro', lang)}</p>
          <SessionsList sessions={userSessions} lang={lang} />
        </section>
      ),
    },
    {
      id: 'mcp',
      title: t('mcpTitle', lang),
      icon: <KeyRound size={15} />,
      keywords: ['api', 'mcp', 'token', 'agent', 'integration', 'bearer', 'токен', 'агент', 'интеграция', 'ключ'],
      content: (
        <section className={card}>
          <div className="mb-1 font-semibold text-ink">{t('mcpTitle', lang)}</div>
          <p className="mb-4 text-[13px] text-ink-2">{t('mcpIntro', lang)}</p>
          <ApiTokensSection tokens={tokens} lang={lang} mcpUrl={mcpUrl} />
        </section>
      ),
    },
    {
      id: 'usage',
      title: t('aiUsageTitle', lang),
      icon: <BarChart3 size={15} />,
      keywords: ['ai', 'usage', 'tokens', 'cost', 'spend', 'расход', 'токены', 'стоимость', 'ии', 'генерация'],
      content: (
        <section className={card}>
          <div className="mb-1 font-semibold text-ink">{t('aiUsageTitle', lang)}</div>
          <p className="mb-4 text-[13px] text-ink-2">{t('aiUsageIntro', lang)}</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { k: t('aiUsageCalls', lang), v: new Intl.NumberFormat('en').format(usage.calls) },
              { k: t('aiUsageTokens', lang), v: new Intl.NumberFormat('en').format(usage.totalTokens) },
              { k: t('aiUsageCost', lang), v: '$' + usage.costUsd.toFixed(usage.costUsd < 1 ? 4 : 2) },
            ].map((x) => (
              <div key={x.k} className="rounded-md border border-border bg-surface-2 p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted">{x.k}</div>
                <div className="mt-1 text-[17px] font-bold text-ink">{x.v}</div>
              </div>
            ))}
          </div>
        </section>
      ),
    },
    {
      id: 'danger',
      title: t('dangerZone', lang),
      icon: <TriangleAlert size={15} />,
      danger: true,
      keywords: ['danger', 'delete', 'account', 'опасная', 'удалить', 'аккаунт'],
      content: <DangerZone lang={lang} handle={user.handle} />,
    },
  ]

  return (
    <div>
      <div className="mx-auto w-full max-w-[920px] px-6 pt-8">
        <h1 className="mb-1 text-[18px] font-bold text-ink">{t('settings', lang)}</h1>
        <p className="text-[13px] text-ink-2">{t('profileIntro', lang)}</p>
      </div>
      <SettingsShell sections={sections} lang={lang} />
    </div>
  )
}
