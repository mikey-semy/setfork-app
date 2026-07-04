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
