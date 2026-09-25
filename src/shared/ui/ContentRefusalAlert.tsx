import { t, type Lang, type TKey } from '@/shared/i18n'
import { Alert } from '@/shared/ui/Alert'
import { secretProvider } from '@/core/domain/secret-scan'
import type { ContentRefusal } from '@/core/domain/content-refusal'

export type { ContentRefusal }

/** Отказ из параметров адреса (`?blocked=…&step=…` или `?secret=…&step=…`); нет ни того, ни другого — `null`. */
export function contentRefusalFrom(sp: { blocked?: string; secret?: string; step?: string }): ContentRefusal | null {
  if (sp.secret) return { kind: 'secret', rule: sp.secret, step: sp.step ?? '0' }
  if (sp.blocked) return { kind: 'destructive', reason: sp.blocked, step: sp.step ?? '?' }
  return null
}

/** Где ключ: номер шага или мета списка (шаг 0). */
export const secretWhere = (step: string, lang: Lang): string =>
  step === '0' ? t('secretWhereMeta', lang) : t('secretWhereStep', lang).replace('{n}', step)

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
            .replace('{where}', secretWhere(refusal.step, lang))
            .replace('{provider}', secretProvider(refusal.rule) ?? refusal.rule)}
        </span>
      </Alert>
    )
  }
  return (
    <Alert variant="danger" className={className}>
      <span className="block font-semibold">{t('destructiveBlockedTitle', lang)}</span>
      <span className="block">
        {t('destructiveBlockedBody', lang)
          .replace('{n}', refusal.step)
          .replace('{reason}', t(`destructive.${refusal.reason}` as TKey, lang))}
      </span>
    </Alert>
  )
}
