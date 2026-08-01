import type { Lang } from '@/shared/i18n'
import { t } from '@/shared/i18n'

/**
 * Машинная причина модерации (в БД — английская диагностика для очереди админа) →
 * человеческая фраза для баннера владельцу. Формы порождают automation.ts и
 * moderate-list.ts — маппинг по известным префиксам. Незнакомый текст возвращаем
 * как есть: это либо причина, написанная админом руками (уже человеческая),
 * либо новый машинный формат — сырая правда лучше спрятанной.
 */
export function humanModerationReason(reason: string, lang: Lang): string {
  if (/^AI uncertain/i.test(reason))
    return t('moderation.theAutomaticCheckWas', lang)
  if (/^AI budget exhausted/i.test(reason)) return t('moderation.awaitingManualReview', lang)
  if (/^Re-upload/i.test(reason)) return t('moderation.matchesPreviouslyRemovedContent', lang)
  if (/^spam heuristic: empty list/i.test(reason)) return t('moderation.theListHasNo', lang)
  if (/^spam heuristic: no meaningful title/i.test(reason)) return t('moderation.theTitleMissingToo', lang)
  if (/^spam heuristic: url shortener/i.test(reason))
    return t('moderation.linksViaUrlShorteners', lang)
  if (/^spam heuristic: link farm/i.test(reason))
    return t('moderation.tooManyLinksDifferent', lang)
  const ai = reason.match(/^AI \[(.+?)\]/)
  if (ai) return t('moderation.aiFoundViolation', lang).replace('{code}', ai[1])
  return reason
}
