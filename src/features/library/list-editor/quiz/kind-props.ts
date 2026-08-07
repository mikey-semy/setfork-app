import type { ReactNode } from 'react'
import type { Lang, TKey } from '@/shared/i18n'
import type { EditorQuiz } from '../../editor'

/**
 * Общий вход формы одного вида теста.
 *
 * Виды не знают друг о друге и не знают, как их выбрали: получают текущий тест и
 * способ его изменить. Поэтому новый вид — это новый файл рядом, а не ещё одна
 * ветка внутри общего компонента.
 */
export type QuizKindProps = {
  quiz: EditorQuiz
  set: (patch: Partial<EditorQuiz>) => void
  lang: Lang
  /** «Учитывать регистр» — общий для видов, где ответ сверяется строкой. */
  caseBox: ReactNode
  /** Подпись с номером: «Вариант {n}» и подобные. */
  nth: (key: TKey, n: number) => string
}
