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

// ── Разделы, которые владелец может выключить (Settings → Features) ──
// Выключенный раздел — это не оформление, а решение владельца о том, что в его
// списке НЕ ведётся. Значит проверять его обязана запись, а не только страница:
// страница отвечает за то, что видно, и сохранённая форма или прямой вызов
// server action её вообще не спрашивают.

export type ListFeature = 'issues' | 'discussions'

export interface ListFeatures {
  issuesEnabled: boolean
  discussionsEnabled: boolean
}

/** Включён ли раздел. Один предикат для страниц (что показывать) и для записи. */
export function isFeatureEnabled(list: ListFeatures, feature: ListFeature): boolean {
  return feature === 'issues' ? list.issuesEnabled : list.discussionsEnabled
}

/**
 * Можно ли писать в раздел: он включён И зритель вправе видеть список.
 *
 * Порядок важен ровно настолько, насколько важна причина отказа; оба условия
 * обязательны. Владелец выключенного раздела тоже не пишет — сначала включает
 * его обратно, иначе «выключено» означало бы «выключено для других».
 */
export function canWriteToFeature(list: ListAccess & ListFeatures, feature: ListFeature, viewer: ListViewer): boolean {
  return isFeatureEnabled(list, feature) && canViewList(list, viewer)
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
