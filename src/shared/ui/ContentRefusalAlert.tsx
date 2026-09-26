import { t, type Lang, type TKey } from '@/shared/i18n'
import { Alert } from '@/shared/ui/Alert'
import { secretProvider } from '@/core/domain/secret-scan'
import type { ContentRefusal } from '@/core/domain/content-refusal'
import { secretWhere } from './secret-where'

export type { ContentRefusal }

/**
 * Отказ стража содержимого — причина словами и МЕСТО. Одна разметка на редактор списка
 * и страницу предложения: иначе кнопка «Сохранить» или «Принять» выглядит сломанной, а две
 * копии текста уже успели появиться до того, как отказ стал двух видов.
 */
export function ContentRefusalAlert({ refusal, lang, className }: { refusal: ContentRefusal; lang: Lang; className?: string }) {
  if (refusal.kind === 'secret') {
    return (
      <Alert variant="danger" className={className}>
        <span className="block font-semibold">{t('secretBlockedTitle', lang)}</span>
        <span className="block">
          {t('secretBlockedBody', lang)
            .replace('{where}', secretWhere(refusal.step, lang, refusal.path))
            .replace('{provider}', secretProvider(refusal.rule) ?? refusal.rule)}
        </span>
      </Alert>
    )
  }
  return (
    <Alert variant="danger" className={className}>
      <span className="block font-semibold">{t('destructiveBlockedTitle', lang)}</span>
      <span className="block">
        {(refusal.path ? t('destructiveBlockedFileBody', lang).replace('{path}', refusal.path) : t('destructiveBlockedBody', lang).replace('{n}', refusal.step)).replace(
          '{reason}',
          t(`destructive.${refusal.reason}` as TKey, lang),
        )}
      </span>
    </Alert>
  )
}
