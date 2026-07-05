'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/shared/auth/admin'
import { imageUrl } from '@/shared/media'
import { removeImageFile, uploadImageFile } from '@/shared/media/upload'
import { getAchievementConfig, saveAchievementConfig } from '@/features/profile/achievement-config'
import { ACHIEVEMENT_KEYS, type AchievementKey } from '@/features/profile/achievements'

function isKey(k: string): k is AchievementKey {
  return (ACHIEVEMENT_KEYS as string[]).includes(k)
}

/** Вкл/выкл достижение (скрывает его на всех профилях). */
export async function setAchievementEnabled(key: string, enabled: boolean): Promise<void> {
  await requireAdmin()
  if (!isKey(key)) return
  const cfg = await getAchievementConfig()
  cfg[key] = { ...cfg[key], enabled }
  await saveAchievementConfig(cfg)
  revalidatePath('/admin')
}

/** Загрузить свою картинку для достижения (drag-and-drop / выбор файла). */
export async function uploadAchievementImage(formData: FormData): Promise<{ ok: true; url: string } | { error: string }> {
  await requireAdmin()
  const key = String(formData.get('key') ?? '')
  const file = formData.get('file')
  if (!isKey(key)) return { error: 'bad key' }
  if (!(file instanceof File) || file.size === 0) return { error: 'Файл не выбран.' }
  try {
    const ref = await uploadImageFile('achievements', file)
    const cfg = await getAchievementConfig()
    const old = cfg[key].image
    cfg[key] = { ...cfg[key], image: ref }
    await saveAchievementConfig(cfg)
    if (old) await removeImageFile(old) // старую подчищаем после успешной замены
    revalidatePath('/admin')
    return { ok: true, url: (await imageUrl(ref, 'rs:fit:96:96')) ?? '' }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Не удалось загрузить.' }
  }
}

/** Сбросить картинку достижения к иконке-фолбэку. */
export async function removeAchievementImage(key: string): Promise<void> {
  await requireAdmin()
  if (!isKey(key)) return
  const cfg = await getAchievementConfig()
  const old = cfg[key].image
  cfg[key] = { ...cfg[key], image: '' }
  await saveAchievementConfig(cfg)
  if (old) await removeImageFile(old)
  revalidatePath('/admin')
}
