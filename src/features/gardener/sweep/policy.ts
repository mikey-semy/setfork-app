// Политика ухода: чем садовник руководствуется и как подписывает свою правку.
// Причина измениться одна — правила для типа списка (включая override из админки)
// и текст пометки в истории версий.

import 'server-only'
import { inArray } from 'drizzle-orm'
import { appSettings, db } from '@/shared/db'
import { LIST_KINDS, type ListKind } from '@/shared/ai/list-kind'
import { POLICY_SETTING_KEYS, policySettingKey } from '@/shared/ai/gardener-policies'
import { t, type Lang, type LocaleText } from '@/shared/i18n'

/** Значение LocaleText на языке списка (фолбэк en → первый непустой). */
export const loc = (v: LocaleText | null | undefined, lang: Lang): string => {
  if (!v) return ''
  return v[lang] ?? v.en ?? Object.values(v).find(Boolean) ?? ''
}

/** Override-политики из админки (app_settings gardener.policy.<kind>); пусто = код-дефолты. */
export async function policyOverrides(): Promise<Partial<Record<ListKind, string>>> {
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, POLICY_SETTING_KEYS))
  const out: Partial<Record<ListKind, string>> = {}
  for (const kind of LIST_KINDS) {
    const v = rows.find((r) => r.key === policySettingKey(kind))?.value?.trim()
    if (v) out[kind] = v
  }
  return out
}

/** Note правки — на языке списка, с честным описанием того, что делал садовник. */
export function noteFor(kind: ListKind, lang: Lang): string {
  return t(kind === 'recipe' ? 'gardenerNoteRecipe' : 'gardenerNoteDefault', lang)
}
