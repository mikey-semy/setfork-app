import { redirect } from 'next/navigation'
import { getLang } from '@/shared/i18n/server'
import { legalUrl } from '@/shared/docs'

// Юридические тексты живут в доках (единый источник правды) — ведём на версию
// на языке пользователя.
export default async function PrivacyPage() {
  redirect(legalUrl('privacy', await getLang()))
}
