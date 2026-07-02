import { eq } from 'drizzle-orm'
import { db, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { avatarSrc } from '@/shared/media'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { SettingsForm } from '@/features/settings/SettingsForm'
import { DangerZone } from '@/features/settings/DangerZone'

export default async function SettingsPage() {
  const session = await requireSession()
  const lang = await getLang()
  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1)
  if (!user) {
    const { redirect } = await import('next/navigation')
    redirect('/login')
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 py-8">
      <div>
        <h1 className="mb-1 text-[18px] font-bold text-ink">{t('settings', lang)}</h1>
        <p className="text-[13px] text-ink-2">{t('profileIntro', lang)}</p>
      </div>

      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-4 font-semibold text-ink">{t('publicProfile', lang)}</div>
        <SettingsForm
          lang={lang}
          handle={user.handle}
          name={user.name ?? ''}
          avatarUrl={avatarSrc(user.avatarUrl, 144)}
          bio={user.bio ?? ''}
          location={user.location ?? ''}
          website={user.website ?? ''}
          socials={user.socials}
        />
      </section>

      <DangerZone lang={lang} handle={user.handle} />
    </div>
  )
}
