'use server'

import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import QRCode from 'qrcode'
import { db, recoveryCodes, users } from '@/shared/db'
import { requireSession, startSession } from '@/shared/auth/session'
import { clientIpFromHeaders } from '@/shared/auth/app-origin'
import { rateLimit } from '@/shared/rate-limit'
import { recordAudit } from '@/shared/audit'
import { ENROLL_COOKIE, PENDING_COOKIE, clearCookie, readSigned, setSigned } from './signed-cookies'
import { avatarSrc } from '@/shared/media'
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUrl,
  verifyTotpStep,
} from '@/shared/auth/totp'

// 2FA-флоу. Промежуточные состояния — короткоживущие подписанные куки
// (JWT на AUTH_SECRET): enroll-секрет до подтверждения и pending-логин.

// ── Включение (настройки) ────────────────────────────────────────────
export interface EnrollStart {
  qrDataUrl: string
  secret: string // для ручного ввода
}

export async function beginTotpEnroll(): Promise<EnrollStart> {
  const session = await requireSession()
  const secret = generateTotpSecret()
  // Секрет в куке — ЗАШИФРОВАН (не только подписан): payload JWS читается base64.
  await setSigned(ENROLL_COOKIE, 'enroll', { uid: session.userId, secret: encryptSecret(secret) })
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl(session.handle, secret), { margin: 1, width: 220 })
  return { qrDataUrl, secret }
}

export type TwoFaResult = { ok: true; recovery?: string[] } | { ok: false; error: 'bad-code' | 'expired' | 'no-password' }

export async function confirmTotpEnroll(code: string): Promise<TwoFaResult> {
  const session = await requireSession()
  const pending = await readSigned(ENROLL_COOKIE, 'enroll')
  const secret = pending?.secret ? decryptSecret(pending.secret) : null
  if (!pending || pending.uid !== session.userId || !secret) return { ok: false, error: 'expired' }
  const step = verifyTotpStep(secret, code)
  if (step < 0) return { ok: false, error: 'bad-code' }

  const codes = generateRecoveryCodes()
  await db.transaction(async (tx) => {
    // totpLastStep = шаг enroll-кода: тот же код нельзя переиграть в первый логин.
    await tx.update(users).set({ totpSecret: encryptSecret(secret), totpEnabled: true, totpLastStep: step }).where(eq(users.id, session.userId))
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, session.userId))
    await tx.insert(recoveryCodes).values(codes.map((c) => ({ userId: session.userId, codeHash: hashRecoveryCode(c) })))
  })
  await clearCookie(ENROLL_COOKIE)
  await recordAudit('2fa.enable', { actorId: session.userId })
  revalidatePath('/settings')
  return { ok: true, recovery: codes }
}

/** Проверка кода владельца: TOTP или неиспользованный recovery (помечается used). */
async function checkUserCode(userId: string, code: string): Promise<boolean> {
  const [u] = await db.select({ secret: users.totpSecret, enabled: users.totpEnabled, lastStep: users.totpLastStep }).from(users).where(eq(users.id, userId)).limit(1)
  if (!u?.enabled || !u.secret) return false
  const secret = decryptSecret(u.secret)
  if (secret) {
    const step = verifyTotpStep(secret, code)
    if (step >= 0) {
      // anti-replay: код шага ≤ последнего использованного уже засчитан (перехват в
      // пределах ~90с-окна). Двигаем last_step вперёд АТОМАРНО (condition в самом
      // UPDATE) — конкурентный повтор того же кода получит 0 строк и не пройдёт.
      const moved = await db
        .update(users)
        .set({ totpLastStep: step })
        .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
        .returning({ id: users.id })
      return moved.length > 0
    }
  }
  // recovery-код (формат xxxxx-xxxxx): АТОМАРНО помечаем used в одном UPDATE —
  // условие usedAt IS NULL в самом UPDATE закрывает TOCTOU-гонку двойного зачёта.
  const hash = hashRecoveryCode(code)
  const marked = await db
    .update(recoveryCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, hash), isNull(recoveryCodes.usedAt)))
    .returning({ id: recoveryCodes.id })
  return marked.length > 0
}

export async function disableTotp(code: string): Promise<TwoFaResult> {
  const session = await requireSession()
  if (!(await checkUserCode(session.userId, code))) return { ok: false, error: 'bad-code' }
  await db.transaction(async (tx) => {
    await tx.update(users).set({ totpSecret: null, totpEnabled: false }).where(eq(users.id, session.userId))
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, session.userId))
  })
  await recordAudit('2fa.disable', { actorId: session.userId })
  revalidatePath('/settings')
  return { ok: true }
}

export async function regenerateRecoveryCodes(code: string): Promise<TwoFaResult> {
  const session = await requireSession()
  if (!(await checkUserCode(session.userId, code))) return { ok: false, error: 'bad-code' }
  const codes = generateRecoveryCodes()
  await db.transaction(async (tx) => {
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, session.userId))
    await tx.insert(recoveryCodes).values(codes.map((c) => ({ userId: session.userId, codeHash: hashRecoveryCode(c) })))
  })
  await recordAudit('2fa.recovery-regenerate', { actorId: session.userId })
  return { ok: true, recovery: codes }
}

// ── Шаг логина ───────────────────────────────────────────────────────
// startPendingLogin живёт в signed-cookies.ts: личность там приходит аргументом,
// а экспорт из этого файла ('use server') сделал бы её сетевой точкой входа.

export async function verify2faLogin(_prev: { error?: string } | null, formData: FormData): Promise<{ error?: string }> {
  const code = String(formData.get('code') ?? '').trim()
  const pending = await readSigned(PENDING_COOKIE, 'pending')
  if (!pending?.uid) redirect('/login')
  // Брутфорс 6-значного кода: 10 попыток за 5 минут на пользователя+ip; исчерпал —
  // гасим pending (нужно заново вводить пароль), окно перебора не продлевается.
  const ip = await clientIpFromHeaders()
  if (!(await rateLimit(`2fa:${pending.uid}:${ip}`, 10, 5 * 60_000)).ok) {
    await clearCookie(PENDING_COOKIE)
    redirect('/login?e=2fa_throttled')
  }
  if (!(await checkUserCode(pending.uid, code))) return { error: 'bad-code' }

  const [user] = await db.select().from(users).where(eq(users.id, pending.uid)).limit(1)
  if (!user) redirect('/login')
  await clearCookie(PENDING_COOKIE)
  await startSession({
    userId: user.id,
    handle: user.handle,
    name: user.name ?? undefined,
    avatarUrl: (await avatarSrc(user.avatarUrl, 64)) ?? undefined,
  })
  redirect('/')
}

/** Есть ли живой pending (для guard страницы /login/2fa). */
export async function hasPendingLogin(): Promise<boolean> {
  return !!(await readSigned(PENDING_COOKIE, 'pending'))?.uid
}
