'use client'

import { useState, useTransition } from 'react'
import { toast } from '@/shared/ui/toast'
import { t, type Lang } from '@/shared/i18n'
import { LanguagePicker } from '@/shared/ui/LanguagePicker'
import { saveMyListLang } from './list-lang-actions'

/**
 * Настройки → «Язык моих списков» (ADR-0030). Сохраняется сразу при выборе, как вид интерфейса:
 * отдельной кнопки у одного поля нет. Не сохранилось — выбор возвращается и названа причина.
 */
export function MyListLangSection({ initial, lang }: { initial: string | null; lang: Lang }) {
  const [value, setValue] = useState(initial)
  const [, start] = useTransition()
  const choose = (code: string | null) => {
    const prev = value
    setValue(code)
    start(async () => {
      const res = await saveMyListLang(code)
      if (!res.ok) {
        setValue(prev)
        toast.error(t('lang.saveFailed', lang))
      }
    })
  }
  return <LanguagePicker value={value} onChange={choose} lang={lang} noneLabel={t('lang.sameAsInterface', lang)} />
}
