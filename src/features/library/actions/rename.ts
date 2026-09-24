'use server'

import { redirect } from 'next/navigation'
import { requireSession } from '@/shared/auth/session'
import { renameListCore } from '../rename-core'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'

export type RenameResult = {
  error?: string
  /** Свободный похожий адрес — чтобы отказ «занято» не заканчивал разговор. */
  suggestion?: string
}

/**
 * Сменить адрес списка — форма «опасной зоны». Правила — в `rename-core`, общие с MCP
 * (`rename_list`); здесь сессия, язык отказа и переход на новый адрес.
 *
 * Почему адрес не следует за заголовком автоматически: заголовок правят часто — опечатка,
 * уточнение, перевод, — и адрес прыгал бы от каждой мелочи, меняя git remote у всех, кто
 * клонировал, без ведома людей. Поэтому переименование — отдельное осознанное действие,
 * как и в Gitea/GitHub, и живёт в опасной зоне.
 */
export async function renameList(
  templateId: string,
  _prev: RenameResult | null,
  formData: FormData,
): Promise<RenameResult> {
  // Независимые чтения — параллельно: язык ответа и личность друг от друга не зависят.
  const [lang, session] = await Promise.all([getLang(), requireSession()])
  const res = await renameListCore(session.userId, templateId, String(formData.get('slug') ?? ''))
  if (!res.ok) {
    const key = { forbidden: 'renameNotAllowed', empty: 'renameEmpty', same: 'renameSame', invalid: 'renameInvalid', taken: 'renameTaken' } as const
    return { error: t(key[res.reason], lang), suggestion: res.suggestion }
  }
  redirect(`/${res.owner}/${res.slug}/settings`)
}
