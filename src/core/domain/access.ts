// Единый предикат «может ли зритель видеть список» — ОДИН источник правды,
// чтобы приватное / черновик / скрытое-модерацией не утекало из-за того, что
// в разных роутах проверки чуть разошлись. Чистая функция → покрыта тестами.

export interface ListAccess {
  visibility: 'public' | 'private'
  status: 'draft' | 'published'
  moderation: string // 'active' | 'flagged' | 'hidden' | 'pending' | …
}

export interface ListViewer {
  isOwner: boolean
  isAdmin?: boolean // у MCP админа нет → передавать false/не передавать
}

/**
 * true — список можно показать зрителю.
 * - private → только владелец;
 * - draft (черновик) → только владелец;
 * - moderation ≠ 'active' (flagged/hidden/…) → владелец ИЛИ админ.
 * Публичный + published + active виден всем.
 */
export function canViewList(list: ListAccess, viewer: ListViewer): boolean {
  if (list.visibility === 'private' && !viewer.isOwner) return false
  if (list.status === 'draft' && !viewer.isOwner) return false
  if (list.moderation !== 'active' && !viewer.isOwner && !viewer.isAdmin) return false
  return true
}

/** Публично видимый список: public + published + active. Единый предикат для анонимных
 *  поверхностей (embed/atom/badge/git-clone) — та же логика, что canViewList без владельца
 *  и админа, но в одном месте, чтобы «public-only»-копии не разошлись при смене правила. */
export function isPubliclyVisible(list: ListAccess): boolean {
  return canViewList(list, { isOwner: false, isAdmin: false })
}

// ── Обратимые ограниченные состояния (архив / заморозка) ─────────────
// Ортогональны видимости и модерации: архивный/замороженный список остаётся
// ВИДИМЫМ (canViewList его не трогает), но ограничен в записи. Чистые предикаты
// на минимальной форме — один источник правды для guard'ов во всех actions.
export interface ListState {
  archivedAt?: Date | string | null
  frozenAt?: Date | string | null
}

export function isArchived(list: ListState): boolean {
  return list.archivedAt != null
}
export function isFrozen(list: ListState): boolean {
  return list.frozenAt != null
}

/** Можно ли МЕНЯТЬ контент/структуру/настройки (правки, версии, предложения,
 *  push, обложка, коллабораторы, каталог…). Запрещено и в архиве, и в заморозке. */
export function canEditList(list: ListState): boolean {
  return !isArchived(list) && !isFrozen(list)
}

/** Можно ли начать НОВЫЙ прогон. Запрещено только в архиве (заморозка прогоны
 *  оставляет — список замораживают от правок, а не от использования). */
export function canRunList(list: ListState): boolean {
  return !isArchived(list)
}

/** Почему нельзя писать ('archived' | 'frozen' | null) — для сообщений/редиректов. */
export function editBlockReason(list: ListState): 'archived' | 'frozen' | null {
  if (isArchived(list)) return 'archived'
  if (isFrozen(list)) return 'frozen'
  return null
}
