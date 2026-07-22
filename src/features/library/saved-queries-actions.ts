'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, savedQueries } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { parseTags } from './slug'

/** Сохранённые запросы (HQ §11): создание/удаление. Максимум 12 на пользователя — это фильтры, не библиотека. */
const MAX_QUERIES = 12

export async function createSavedQuery(formData: FormData): Promise<void> {
  const session = await requireSession()
  const name = String(formData.get('name') ?? '').trim().slice(0, 60)
  if (!name) return
  const tags = parseTags(String(formData.get('tags') ?? ''))
  const runStateRaw = String(formData.get('runState') ?? 'any')
  const runState = runStateRaw === 'started' || runStateRaw === 'done' ? runStateRaw : 'any'
  const existing = await db.select({ id: savedQueries.id }).from(savedQueries).where(eq(savedQueries.userId, session.userId))
  if (existing.length >= MAX_QUERIES) return
  await db.insert(savedQueries).values({ userId: session.userId, name, tags, runState })
  revalidatePath('/my-lists')
}

export async function deleteSavedQuery(id: string): Promise<void> {
  const session = await requireSession()
  await db.delete(savedQueries).where(and(eq(savedQueries.id, id), eq(savedQueries.userId, session.userId)))
  revalidatePath('/my-lists')
}
