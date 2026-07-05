import 'server-only'
import { getSettings, saveSettings } from '@/shared/settings/kv'
import { imageUrl } from '@/shared/media'
import { ACHIEVEMENT_KEYS, type AchievementKey } from './achievements'

// Конфиг достижений (в appSettings под одним ключом, JSON). Позволяет админу
// выключать достижения и назначать свою картинку вместо иконки-фолбэка.
const KEY = 'achievements.config'

export interface AchEntry {
  enabled: boolean
  image: string // storage-ref загруженной картинки ('' = нет, показываем иконку)
}
export type AchConfig = Record<AchievementKey, AchEntry>

/** Для отображения: image-ref уже превращён в готовый URL. */
export interface AchDisplay {
  enabled: boolean
  imageUrl: string // '' = картинки нет → фолбэк на иконку
}
export type AchDisplayMap = Record<AchievementKey, AchDisplay>

function parse(raw?: string): Partial<Record<AchievementKey, Partial<AchEntry>>> {
  try {
    return raw ? (JSON.parse(raw) as Partial<Record<AchievementKey, Partial<AchEntry>>>) : {}
  } catch {
    return {}
  }
}

export async function getAchievementConfig(): Promise<AchConfig> {
  const rows = await getSettings([KEY])
  const p = parse(rows[KEY])
  const out = {} as AchConfig
  for (const k of ACHIEVEMENT_KEYS) out[k] = { enabled: p[k]?.enabled ?? true, image: p[k]?.image ?? '' }
  return out
}

export async function saveAchievementConfig(cfg: AchConfig): Promise<void> {
  await saveSettings({ [KEY]: JSON.stringify(cfg) })
}

/** Резолвит image-ref → URL (imgproxy) для рендера. */
export async function getAchievementDisplay(): Promise<AchDisplayMap> {
  const cfg = await getAchievementConfig()
  const out = {} as AchDisplayMap
  for (const k of ACHIEVEMENT_KEYS) {
    out[k] = { enabled: cfg[k].enabled, imageUrl: cfg[k].image ? ((await imageUrl(cfg[k].image, 'rs:fit:96:96')) ?? '') : '' }
  }
  return out
}
