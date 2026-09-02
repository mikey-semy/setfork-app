import { FileText, Globe, Lock, type LucideIcon } from 'lucide-react'
import type { TKey } from '@/shared/i18n'

/**
 * Состояние видимости списка ОДНИМ значением — то, что нужно показать человеку.
 *
 * В базе полей два, и они пересекаются: черновик закрыт от чужих ровно так же,
 * как приватный (`canViewList` не пускает к нему никого, кроме владельца и
 * соавторов), а его `visibility` говорит лишь о том, каким список станет ПОСЛЕ
 * публикации. Пока метку считали по одному `visibility`, у черновика рядом с
 * названием стоял глобус «публичный» — у списка, которого не видит никто.
 *
 * Одно место на все поверхности: метка у названия и сводка показателей обязаны
 * говорить одно и то же — иначе на узком экране (там видна сводка) и на широком
 * (там видна метка) один список выглядел бы по-разному.
 */
export type ListVisibilityState = 'draft' | 'private' | 'public'

export function listVisibilityState(list: { status: 'draft' | 'published'; visibility: 'public' | 'private' }): ListVisibilityState {
  return list.status === 'draft' ? 'draft' : list.visibility
}

/** Как состояние выглядит: значок и подпись из словаря. Новое состояние = строка данных. */
export const LIST_VISIBILITY_BADGE: Record<ListVisibilityState, { Icon: LucideIcon; labelKey: TKey; tone: string }> = {
  draft: { Icon: FileText, labelKey: 'draftBadge', tone: 'border-warn text-warn' },
  private: { Icon: Lock, labelKey: 'privateLabel', tone: 'border-border text-ink-2' },
  public: { Icon: Globe, labelKey: 'publicLabel', tone: 'border-border text-ink-2' },
}
