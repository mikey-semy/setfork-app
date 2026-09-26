'use server'

import { redirect } from 'next/navigation'
import { requireSession } from '@/shared/auth/session'
import { importSkillFromGithub } from '@/features/mcp/tools'

/**
 * Импорт скилла с GitHub из формы `/new`. Отказ — ЗНАЧЕНИЕМ (адрес остаётся в поле, причина
 * над ним), успех — переход на новый черновик: там видно, что пришло и почему список
 * приватный, если он приватный.
 */
export async function importSkillAction(_prev: { error: string } | null, formData: FormData): Promise<{ error: string } | null> {
  const session = await requireSession()
  const url = String(formData.get('url') ?? '').trim()
  if (!url) return { error: 'url' }
  const res = await importSkillFromGithub(session.userId, url)
  if ('error' in res) return { error: res.error }
  redirect(`/${res.ref}`)
}
