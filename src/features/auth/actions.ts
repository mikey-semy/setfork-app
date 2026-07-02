'use server'

import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db, users } from '@/shared/db'
import { setSessionCookie } from '@/shared/auth/session'
import { hashPassword, verifyPassword } from '@/shared/auth/password'
import { avatarSrc } from '@/shared/media'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'

export type AuthResult = { error?: string }

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const HANDLE_RE = /^[a-z0-9-]{3,30}$/
const RESERVED = new Set(['explore', 'new', 'settings', 'admin', 'login', 'register', 'notifications', 'my-lists', 'api', 'generate', 'ghost'])

async function startSession(user: { id: string; handle: string; name: string | null; avatarUrl: string | null }) {
  await setSessionCookie({
    userId: user.id,
    handle: user.handle,
    name: user.name ?? undefined,
    avatarUrl: (await avatarSrc(user.avatarUrl, 64)) ?? undefined,
  })
}

export async function registerWithPassword(_prev: AuthResult | null, formData: FormData): Promise<AuthResult> {
  const lang = await getLang()
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const handle = String(formData.get('handle') ?? '').trim().toLowerCase()
  const name = String(formData.get('name') ?? '').trim() || null
  const password = String(formData.get('password') ?? '')

  if (!EMAIL_RE.test(email)) return { error: t('invalidEmailMsg', lang) }
  if (!HANDLE_RE.test(handle) || RESERVED.has(handle)) return { error: t('invalidHandleMsg', lang) }
  if (password.length < 8) return { error: t('passwordShort', lang) }

  const [byEmail] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (byEmail) return { error: t('emailTaken', lang) }
  const [byHandle] = await db.select({ id: users.id }).from(users).where(eq(users.handle, handle)).limit(1)
  if (byHandle) return { error: t('handleTaken', lang) }

  let created
  try {
    ;[created] = await db.insert(users).values({ email, handle, name, passwordHash: hashPassword(password) }).returning()
  } catch {
    return { error: t('emailTaken', lang) } // гонка по unique
  }

  await startSession(created)
  redirect('/')
}

export async function loginWithPassword(_prev: AuthResult | null, formData: FormData): Promise<AuthResult> {
  const lang = await getLang()
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (!user || !verifyPassword(password, user.passwordHash)) return { error: t('invalidCredentials', lang) }

  await startSession(user)
  redirect('/')
}
