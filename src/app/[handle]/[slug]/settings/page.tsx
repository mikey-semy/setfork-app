import { notFound } from 'next/navigation'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { getListMeta } from '@/features/library/queries'
import { ListHeader } from '@/features/library/ListHeader'
import { ListSettingsDanger } from '@/features/library/ListSettingsDanger'

export default async function ListSettingsPage({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle: owner, slug } = await params
  const [lang, session] = await Promise.all([getLang(), getSession()])
  const meta = await getListMeta(owner, slug)
  if (!meta) notFound()
  if (!session || session.userId !== meta.ownerId) notFound() // только владелец

  return (
    <>
      <ListHeader owner={owner} slug={slug} active="settings" />
      <div className="mx-auto w-full max-w-[820px] px-4 py-6">
        <ListSettingsDanger templateId={meta.id} slug={meta.slug} visibility={meta.visibility} pinned={meta.pinned} lang={lang} />
      </div>
    </>
  )
}
