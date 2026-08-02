import { headers } from 'next/headers'
import { eq } from 'drizzle-orm'
import { BarChart3, Bell, Fingerprint, KeyRound, Mail, Monitor, Palette, ShieldCheck, TriangleAlert, User, UserRoundPlus } from 'lucide-react'
import { db, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { avatarSrc } from '@/shared/media'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SettingsSection } from '@/shared/ui/SettingsSection'
import { getUserUsage } from '@/shared/ai/usage'
import { aiQuota, listQuota } from '@/shared/quota'
import { getApiTokens } from '@/features/mcp/queries'
import { ApiTokensSection } from '@/features/mcp/ApiTokensSection'
import { SettingsForm } from '@/features/settings/SettingsForm'
import { TwoFactorSection } from '@/features/settings/TwoFactorSection'
import { PasskeysSection } from '@/features/settings/PasskeysSection'
import { listPasskeys } from '@/features/auth/passkeys'
import { EmailSection } from '@/features/settings/EmailSection'
import { AppearanceSettings } from '@/features/settings/AppearanceSettings'
import { DangerZone } from '@/features/settings/DangerZone'
import { IncomingTransfers } from '@/features/transfer/IncomingTransfers'
import { getIncomingTransfers } from '@/features/transfer/queries'
import { SettingsShell, type SettingsSection as ShellSection } from '@/features/settings/SettingsShell'
import { NotifyPrefsForm } from '@/features/notifications/NotifyPrefsForm'
import { getUserSessions } from '@/features/sessions/queries'
import { SessionsList } from '@/features/sessions/SessionsList'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('settings', lang) }
}

export default async function SettingsPage() {
  const session = await requireSession()
  const [lang, [user]] = await Promise.all([getLang(), db.select().from(users).where(eq(users.id, session.userId)).limit(1)])
  if (!user) {
    const { redirect } = await import('next/navigation')
    redirect('/login')
  }
  const [avatar, userSessions, usage, lists, aiMonth, userPasskeys, tokens, incomingTransfers, h] = await Promise.all([
    avatarSrc(user.avatarUrl, 144),
    getUserSessions(session.userId, session.sid),
    getUserUsage(session.userId),
    listQuota(session.userId, session.handle),
    aiQuota(session.userId, session.handle),
    listPasskeys(),
    getApiTokens(session.userId),
    getIncomingTransfers(session.userId),
    headers(),
  ])
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const mcpUrl = `${proto}://${host}/api/mcp`

  const sections: ShellSection[] = [
    // Секция появляется только при наличии входящих передач списков.
    ...(incomingTransfers.length > 0
      ? [{
          id: 'incoming-transfers',
          title: t('incomingTransfersTitle', lang),
          icon: <UserRoundPlus size={15} />,
          keywords: ['transfer', 'ownership', 'incoming', 'передача', 'владение', 'входящие'],
          content: <IncomingTransfers items={incomingTransfers} lang={lang} />,
        } satisfies ShellSection]
      : []),
    {
      id: 'profile',
      title: t('publicProfile', lang),
      icon: <User size={15} />,
      keywords: ['profile', 'name', 'bio', 'avatar', 'location', 'website', 'social', 'профиль', 'имя', 'аватар', 'био', 'соцсети', 'сайт'],
      content: (
        <SettingsSection title={t('publicProfile', lang)}>
          <SettingsForm
            lang={lang}
            handle={user.handle}
            name={user.name ?? ''}
            avatarUrl={avatar}
            bio={user.bio ?? ''}
            location={user.location ?? ''}
            website={user.website ?? ''}
            socials={user.socials}
            profilePrivate={user.profilePrivate}
            avatarShape={user.avatarShape}
          />
        </SettingsSection>
      ),
    },
    {
      id: 'appearance',
      title: lang === 'ru' ? 'Внешний вид' : 'Appearance',
      icon: <Palette size={15} />,
      keywords: ['appearance', 'theme', 'dark', 'light', 'system', 'font', 'accent', 'color', 'тема', 'тёмная', 'светлая', 'шрифт', 'цвет', 'акцент'],
      content: (
        <SettingsSection
          title={lang === 'ru' ? 'Внешний вид' : 'Appearance'}
          hint={lang === 'ru' ? 'Тема, акцентный цвет и шрифт интерфейса.' : 'Theme, accent color and interface font.'}
        >
          <AppearanceSettings lang={lang} initialAccent={user.uiAccent ?? ''} initialFont={user.uiFont ?? ''} initialScale={user.uiScale ?? ''} />
        </SettingsSection>
      ),
    },
    {
      id: 'notifications',
      title: t('notifPrefsTitle', lang),
      icon: <Bell size={15} />,
      keywords: ['notifications', 'stars', 'forks', 'suggestions', 'email', 'уведомления', 'звёзды', 'форки', 'правки'],
      content: (
        <SettingsSection title={t('notifPrefsTitle', lang)} hint={t('notifPrefsIntro', lang)}>
          <NotifyPrefsForm prefs={user.notifyPrefs} lang={lang} hasEmail={!!user.email} notifyLang={user.lang} />
        </SettingsSection>
      ),
    },
    {
      id: 'sessions',
      title: t('sessionsTitle', lang),
      icon: <Monitor size={15} />,
      keywords: ['sessions', 'devices', 'sign out', 'security', 'revoke', 'сессии', 'устройства', 'выйти', 'безопасность'],
      content: (
        <SettingsSection title={t('sessionsTitle', lang)} hint={t('sessionsIntro', lang)}>
          <SessionsList sessions={userSessions} lang={lang} />
        </SettingsSection>
      ),
    },
    {
      id: 'email',
      title: 'Email',
      icon: <Mail size={15} />,
      keywords: ['email', 'verification', 'verify', 'почта', 'подтверждение', 'верификация'],
      content: (
        <SettingsSection
          title="Email"
          hint={
            lang === 'ru'
              ? 'Подтверждённая почта нужна для сброса пароля и уведомлений.'
              : 'A verified email is used for password reset and notifications.'
          }
        >
          <EmailSection email={user.email} verified={!!user.emailVerifiedAt} lang={lang} />
        </SettingsSection>
      ),
    },
    {
      id: '2fa',
      title: lang === 'ru' ? 'Двухфакторная аутентификация' : 'Two-factor authentication',
      icon: <ShieldCheck size={15} />,
      keywords: ['2fa', 'totp', 'two-factor', 'authenticator', 'recovery', 'security', 'двухфакторная', 'код', 'аутентификатор', 'безопасность'],
      content: (
        <SettingsSection
          title={lang === 'ru' ? 'Двухфакторная аутентификация' : 'Two-factor authentication'}
          hint={
            lang === 'ru'
              ? 'Второй фактор при входе по паролю: код из приложения-аутентификатора (TOTP). Вход через GitHub защищает сам GitHub.'
              : 'A second factor for password sign-in: a code from your authenticator app (TOTP). GitHub sign-in is protected by GitHub itself.'
          }
        >
          <TwoFactorSection enabled={user.totpEnabled} lang={lang} />
        </SettingsSection>
      ),
    },
    {
      id: 'passkeys',
      title: 'Passkeys',
      icon: <Fingerprint size={15} />,
      keywords: ['passkey', 'passkeys', 'webauthn', 'fido', 'touch id', 'face id', 'biometric', 'passwordless', 'passkey', 'ключ', 'беспарольный', 'биометрия', 'безопасность'],
      content: (
        <SettingsSection
          title="Passkeys"
          hint={
            lang === 'ru'
              ? 'Беспарольный вход по passkey (Touch/Face ID, ключ безопасности). Работает рядом с паролем и 2FA.'
              : 'Passwordless sign-in with a passkey (Touch/Face ID, a security key). Works alongside your password and 2FA.'
          }
        >
          <PasskeysSection initial={userPasskeys} lang={lang} />
        </SettingsSection>
      ),
    },
    {
      id: 'mcp',
      title: t('mcpTitle', lang),
      icon: <KeyRound size={15} />,
      keywords: ['api', 'mcp', 'token', 'agent', 'integration', 'bearer', 'токен', 'агент', 'интеграция', 'ключ'],
      content: (
        <SettingsSection title={t('mcpTitle', lang)} hint={t('mcpIntro', lang)}>
          <ApiTokensSection tokens={tokens} lang={lang} mcpUrl={mcpUrl} />
        </SettingsSection>
      ),
    },
    {
      id: 'usage',
      title: t('aiUsageTitle', lang),
      icon: <BarChart3 size={15} />,
      keywords: ['ai', 'usage', 'tokens', 'cost', 'spend', 'расход', 'токены', 'стоимость', 'ии', 'генерация'],
      content: (
        <SettingsSection title={t('aiUsageTitle', lang)} hint={t('aiUsageIntro', lang)}>
          <div className="grid grid-cols-3 gap-3">
            {[
              { k: t('aiUsageCalls', lang), v: new Intl.NumberFormat('en').format(usage.calls) },
              { k: t('aiUsageTokens', lang), v: new Intl.NumberFormat('en').format(usage.totalTokens) },
              { k: t('aiUsageCost', lang), v: '$' + usage.costUsd.toFixed(usage.costUsd < 1 ? 4 : 2) },
            ].map((x) => (
              <div key={x.k} className="rounded-md border border-border bg-surface-2 p-3">
                <div className="text-[0.6875rem] uppercase tracking-wide text-muted">{x.k}</div>
                <div className="mt-1 text-[1rem] font-bold text-ink">{x.v}</div>
              </div>
            ))}
          </div>
          {/* Квоты (мягкие лимиты; админ — без лимитов). */}
          <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-[0.8125rem]">
            <div className="flex items-center justify-between">
              <span className="text-ink-2">{lang === 'ru' ? 'Списков' : 'Lists'}</span>
              <span className="font-mono text-ink">{lists.unlimited ? '∞' : `${lists.used} / ${lists.limit}`}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-2">{lang === 'ru' ? 'Черновики за этот месяц' : 'Drafts this month'}</span>
              <span className="font-mono text-ink">
                {aiMonth.unlimited ? '∞' : `$${aiMonth.used.toFixed(2)} / $${aiMonth.limit.toFixed(2)}`}
              </span>
            </div>
          </div>
        </SettingsSection>
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
      <div className="mx-auto w-full max-w-[57.5rem] px-6 pt-8">
        {/* «Настройки» уже написаны в шапке приложения — остаётся пояснение. */}
        <PageHeader hideTitle title={t('settings', lang)} subtitle={t('profileIntro', lang)} />
      </div>
      <SettingsShell sections={sections} lang={lang} />
    </div>
  )
}
