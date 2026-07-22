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
  /** Соредактор списка (collaborators). Приватный/черновик — «свой» и для него:
   *  список ведут вместе, прятать от участника бессмысленно (как в GitHub —
   *  приватный репозиторий виден коллабораторам). НЕ снимает модерацию. */
  isCollaborator?: boolean
  isAdmin?: boolean // у MCP админа нет → передавать false/не передавать
}

/**
 * true — список можно показать зрителю.
 * - private → владелец ИЛИ коллаборатор (участники ведут список вместе);
 * - draft (черновик) → владелец ИЛИ коллаборатор (помогают собирать);
 * - moderation ≠ 'active' (flagged/hidden/…) → владелец ИЛИ админ (коллаборатор
 *   модерационный takedown НЕ обходит — это защитный гейт).
 * Публичный + published + active виден всем.
 */
export function canViewList(list: ListAccess, viewer: ListViewer): boolean {
  const maintainer = viewer.isOwner || !!viewer.isCollaborator
  if (list.visibility === 'private' && !maintainer) return false
  if (list.status === 'draft' && !maintainer) return false
  if (list.moderation !== 'active' && !viewer.isOwner && !viewer.isAdmin) return false
  return true
}

/** Публично видимый список: public + published + active. Единый предикат для анонимных
 *  поверхностей (embed/atom/badge/git-clone) — та же логика, что canViewList без владельца
 *  и админа, но в одном месте, чтобы «public-only»-копии не разошлись при смене правила. */
export function isPubliclyVisible(list: ListAccess): boolean {
  return canViewList(list, { isOwner: false, isAdmin: false })
}
