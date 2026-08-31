'use client'

import { useActionState, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createTemplate, type NewListRefusal } from '@/features/library/actions'
import type { Lang } from '@/shared/i18n'
import { Alert } from '@/shared/ui/Alert'
// Замер спроса живёт в monetization, а показывается там, где человек упёрся в предел:
// интерес к платному тарифу возникает в этот момент, а не на витрине тарифов.
// eslint-disable-next-line boundaries/dependencies -- см. абзац выше
import { ProInterestForm } from '@/features/monetization/ProInterestForm'
import { useKeepFormValues } from '@/shared/ui/keep-form-values'

/**
 * Форма создания списка: отказ показывается НА МЕСТЕ, введённое остаётся.
 *
 * До этого отказ уносил переходом на `/new?e=…`, то есть новым GET, — и человек терял
 * не повод для отказа, а весь набранный список: название, описание, теги и все пункты
 * редактора. Цена ошибки «адрес занят» была «набери заново» (авто-ревью #829).
 *
 * `useActionState` возвращает отказ ЗНАЧЕНИЕМ: страница не перерисовывается, состояние
 * редактора живёт дальше. Без JS форма всё равно отправляется — Next дорисовывает
 * страницу с тем же состоянием, поэтому нативный путь не ломается.
 *
 * Тексты приходят готовыми строками с сервера: словарь живёт там, а сюда нужен только
 * шаблон с местом для подстановки.
 */
export function NewListForm({
  children,
  texts,
  lang,
}: {
  children: ReactNode
  /** Язык — для формы замера спроса внутри сообщения о пределе (0021). */
  lang: Lang
  texts: {
    slugTakenTitle: string
    /** `{slug}` — занятый адрес. */
    slugTakenBody: string
    blockedTitle: string
    /** `{n}` — номер шага, `{reason}` — причина словами. */
    blockedBody: string
    /** Причины стража исполняемых команд: код → слова. */
    blockedReasons: Record<string, string>
    /** `{n}` — предел числа списков. */
    quotaReached: string
    noTitle: string
  }
}) {
  const [refusal, action, pending] = useActionState<NewListRefusal | null, FormData>(createTemplate, null)
  /**
   * ⚠️ ПРЕДЕЛ, РАЗ УВИДЕННЫЙ, С ЭКРАНА НЕ ПРОПАДАЕТ. Внутри этого сообщения стоит форма
   * замера спроса, а её отправка — серверное действие; оно обновляет дерево, и
   * состояние `useActionState` сбрасывается. Человек нажимал «Хочу Pro» и видел, как
   * весь блок исчезает: ни ошибки, ни подтверждения. Поймано живой проверкой.
   *
   * Поэтому факт «упёрся в предел» запоминается отдельно и живёт до ухода со страницы —
   * ровно как и должен: ограничение никуда не делось от того, что человек оставил почту.
   */
  const [quotaSeen, setQuotaSeen] = useState(false)
  useEffect(() => {
    if (refusal?.kind === 'list_quota') setQuotaSeen(true)
  }, [refusal])
  // ⚠️ ПРЕДЕЛ ЧИТАЕТСЯ ПРЯМО ИЗ ОТКАЗА, а не через состояние. В `useEffect` он попадал
  // ПОСЛЕ первого кадра, и человек успевал прочесть «предел в 0 списков» — число,
  // которого не бывает. Отказ уже несёт всё нужное; заводить для этого состояние значит
  // добавить кадр, на котором мы говорим неправду.
  const quotaLimit = refusal?.kind === 'list_quota' ? refusal.limit : null

  // Набранное переживает отказ: форма React сбрасывает неуправляемые поля сама.
  const { formRef, onSubmit } = useKeepFormValues(refusal !== null, pending)

  return (
    <form ref={formRef} onSubmit={onSubmit} action={action}>
      {refusal?.kind === 'slug_taken' && (
        <Alert variant="danger" className="mb-5">
          <span className="block font-semibold">{texts.slugTakenTitle}</span>
          <span className="block">{texts.slugTakenBody.replace('{slug}', refusal.slug)}</span>
        </Alert>
      )}

      {refusal?.kind === 'blocked' && (
        <Alert variant="danger" className="mb-5">
          <span className="block font-semibold">{texts.blockedTitle}</span>
          <span className="block">
            {texts.blockedBody
              .replace('{n}', String(refusal.step))
              .replace('{reason}', texts.blockedReasons[refusal.reason] ?? refusal.reason)}
          </span>
        </Alert>
      )}

      {(refusal?.kind === 'list_quota' || quotaSeen) && (
        <Alert variant="warn" className="mb-5">
          {texts.quotaReached.replace('{n}', String(quotaLimit ?? 0))}
          {/* ЗАМЕР СПРОСА ровно в точке, где человек упёрся в предел (решение 0021):
              интерес к платному тарифу возникает здесь, а не на витрине тарифов. Форма
              прямо говорит, что оплаты нет и мы её не обещаем — без этой строки мы
              меряли бы не готовность платить, а реакцию на собственное обещание. */}
          <ProInterestForm source="list_quota" lang={lang} />
        </Alert>
      )}

      {refusal?.kind === 'no_title' && (
        <Alert variant="danger" className="mb-5">
          {texts.noTitle}
        </Alert>
      )}

      {children}
    </form>
  )
}
