'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { requireAdmin } from '@/shared/auth/admin'
import { db, feedSources } from '@/shared/db'
import { slugify } from '@/shared/lib/slug'

/**
 * Управление подписками на поток. Всё — руками владельца: тему источника мы не угадываем
 * (та же логика, что с лицензией — цена ошибки чужие права и мусор в библиотеке), поэтому
 * без темы подписка не создаётся.
 */

const PAGE = '/admin/feeds'

/** Темы: приводим к тем же slug'ам, что у тегов списков — иначе пересечение не совпадёт. */
function normTags(raw: string): string[] {
  return [...new Set(raw.split(/[,\s]+/).map(slugify).filter(Boolean))].slice(0, 8)
}

/**
 * Разбор адреса ОТДЕЛЬНОЙ функцией, а не try/catch с redirect внутри: `redirect` работает
 * броском особой ошибки, и собственный catch проглотил бы её — переход бы не случился, а
 * дальше в БД уехал бы пустой адрес. Грабля тихая, поэтому разведено.
 */
function httpUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

export async function addFeedSource(formData: FormData): Promise<void> {
  const admin = await requireAdmin()
  const raw = String(formData.get('url') ?? '').trim()
  const tags = normTags(String(formData.get('tags') ?? ''))
  const title = String(formData.get('title') ?? '').trim().slice(0, 200)
  const everyHours = Math.min(168, Math.max(1, Math.round(Number(formData.get('everyHours')) || 6)))
  if (!tags.length) redirect(`${PAGE}?err=no-tags`)
  // Схему проверяем здесь ради понятной ошибки; настоящая защита от локальных адресов —
  // в fetchPublicUrl на самом выходе наружу, и второй её копии тут не будет.
  const url = httpUrl(raw)
  if (!url) redirect(`${PAGE}?err=bad-url`)
  const ins = await db
    .insert(feedSources)
    .values({ url, title, tags, everyHours, addedBy: admin.userId })
    .onConflictDoNothing({ target: feedSources.url })
    .returning({ id: feedSources.id })
  revalidatePath(PAGE)
  redirect(ins.length ? PAGE : `${PAGE}?err=exists`)
}

export async function setFeedSourceEnabled(formData: FormData): Promise<void> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const enabled = formData.get('enabled') === 'true'
  if (!id) redirect(PAGE)
  await db.update(feedSources).set({ enabled }).where(eq(feedSources.id, id))
  revalidatePath(PAGE)
  redirect(PAGE)
}

/**
 * Тянуть сейчас — по кнопке, чтобы не ждать расписания при настройке источника.
 * Идёт тем же путём, что петля (pullSource), поэтому ручная проверка и автоматический
 * сбор не могут разъехаться в поведении.
 */
export async function pullFeedNow(formData: FormData): Promise<void> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) redirect(PAGE)
  const [src] = await db.select().from(feedSources).where(eq(feedSources.id, id))
  if (!src) redirect(`${PAGE}?err=gone`)
  const { pullSource } = await import('@/features/feeds/service')
  const res = await pullSource(src)
  revalidatePath(PAGE)
  redirect(res.error ? `${PAGE}?err=pull` : `${PAGE}?fresh=${res.fresh}`)
}

/**
 * Удалить подписку. Собранные элементы уходят вместе с ней (каскад) — поэтому в интерфейсе
 * основное действие «выключить», а удаление стоит отдельно и подписано.
 */
export async function removeFeedSource(formData: FormData): Promise<void> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) redirect(PAGE)
  await db.delete(feedSources).where(eq(feedSources.id, id))
  revalidatePath(PAGE)
  redirect(PAGE)
}
