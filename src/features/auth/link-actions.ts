'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/shared/auth/session'
import { IDENTITY_PROVIDERS } from '@/shared/auth/identities'
import type { OauthProvider } from '@/shared/auth/oauth'
import type { TKey } from '@/shared/i18n'
import { unlinkIdentity } from './link-identity'

/** Отвязка сообщает ошибку ключом словаря: текст выбирает язык зрителя, а не сервер. */
export type UnlinkState = { error: TKey } | null

const UNLINK_ERROR: Record<string, TKey> = {
  'not-linked': 'auth.link.notLinked',
  'last-method': 'auth.link.lastMethod',
}

export async function unlinkSignInMethod(_prev: UnlinkState, formData: FormData): Promise<UnlinkState> {
  const session = await requireSession()
  const provider = String(formData.get('provider') ?? '') as OauthProvider
  if (!IDENTITY_PROVIDERS.includes(provider)) return { error: 'auth.link.notLinked' }

  const outcome = await unlinkIdentity(session.userId, provider)
  revalidatePath('/settings')
  return outcome === 'unlinked' ? null : { error: UNLINK_ERROR[outcome] }
}
