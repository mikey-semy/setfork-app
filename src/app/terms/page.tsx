import { redirect } from 'next/navigation'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { legalUrl } from '@/shared/docs'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('termsOfService', lang) }
}

// Юридические тексты живут в доках (единый источник правды) — ведём на версию
// на языке пользователя.
export default async function TermsPage() {
  redirect(legalUrl('terms', await getLang()))
}
