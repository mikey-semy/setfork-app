'use client'

import { Globe, GraduationCap, List, ListOrdered, Lock } from 'lucide-react'
import { IconCheckbox, IconRadioGroup } from '@/shared/ui/IconChoice'
import { t, type Lang } from '@/shared/i18n'

/**
 * Три настройки списка, которые всегда стоят рядом: тип, видимость и режим курса.
 *
 * Все три — компактные поля обычной server-формы (radio/checkbox), поэтому создание,
 * правка и настройки читают их одинаково и без клиентского состояния. До этого
 * видимость и «курс» занимали три карточки в столбик высотой в пол-экрана телефона,
 * хотя выбор в каждой — из двух состояний.
 */

/** Тип списка: упорядоченный или набор без порядка. */
export function ListTypeToggle({ ordered, lang }: { ordered: boolean; lang: Lang }) {
  return (
    <IconRadioGroup
      name="ordered"
      options={[
        { value: 'ordered', checked: ordered, Icon: ListOrdered, label: t('orderedLabel', lang), hint: t('orderedHint', lang) },
        { value: 'unordered', checked: !ordered, Icon: List, label: t('unorderedLabel', lang), hint: t('unorderedHint', lang) },
      ]}
    />
  )
}

/** Видимость: публичный список или только для владельца. */
export function VisibilityToggle({ isPublic, lang }: { isPublic: boolean; lang: Lang }) {
  return (
    <IconRadioGroup
      name="visibility"
      options={[
        { value: 'public', checked: isPublic, Icon: Globe, label: t('publicLabel', lang), hint: t('publicHint', lang) },
        { value: 'private', checked: !isPublic, Icon: Lock, label: t('privateLabel', lang), hint: t('privateHint', lang) },
      ]}
    />
  )
}

/** Последовательный курс: следующий урок открывается после тестов предыдущего. */
export function GatedToggle({ gated, lang }: { gated: boolean; lang: Lang }) {
  return <IconCheckbox name="gated" checked={gated} Icon={GraduationCap} short={t('gatedShort', lang)} label={t('gatedLabel', lang)} hint={t('gatedHint', lang)} />
}
