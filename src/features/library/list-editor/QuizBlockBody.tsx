'use client'

import { BubbleTextEditor } from '@/shared/ui/BubbleTextEditor'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { t, type Lang, type TKey } from '@/shared/i18n'
import type { QuizKind } from '@/core'
import { CheckLabel, Hint, LineField } from './block-fields'
import { QuizAccept } from './quiz/QuizAccept'
import { QuizBlanks } from './quiz/QuizBlanks'
import { QuizChoice } from './quiz/QuizChoice'
import { QuizMatch } from './quiz/QuizMatch'
import { QuizNumber } from './quiz/QuizNumber'
import { QuizSort } from './quiz/QuizSort'
import type { QuizKindProps } from './quiz/kind-props'
import type { EditorQuiz } from '../editor'

/** Виды теста — таблица «значение → подпись и форма ответов». Ветвления по kind в
 *  разметке нет: вид выбирается по этой карте, и новый добавляется строкой сюда
 *  плюс своим файлом рядом. */
const QUIZ_KINDS: { k: QuizKind; label: TKey; Form: (p: QuizKindProps) => React.ReactNode }[] = [
  { k: 'choice', label: 'quiz.kindChoice', Form: QuizChoice },
  { k: 'text', label: 'quiz.kindText', Form: QuizAccept },
  { k: 'number', label: 'quiz.kindNumber', Form: QuizNumber },
  { k: 'blank', label: 'quiz.kindBlank', Form: QuizBlanks },
  { k: 'match', label: 'quiz.kindMatch', Form: QuizMatch },
  { k: 'sort', label: 'quiz.kindSort', Form: QuizSort },
  { k: 'code', label: 'quiz.kindCode', Form: QuizAccept },
]

/**
 * Quiz-блок в редакторе: вид теста, вопрос, форма ответов этого вида и пояснение.
 * Проверка ответов живёт на странице списка — здесь их только задают.
 *
 * Формы ответов вынесены по видам: семь мини-форм в одном файле означали, что правка
 * сопоставления пар открывает тот же файл, что и правка числового допуска.
 */
export function QuizBlockBody({ quiz, onChange, lang }: { quiz: EditorQuiz; onChange: (q: EditorQuiz) => void; lang: Lang }) {
  const set = (q: Partial<EditorQuiz>) => onChange({ ...quiz, ...q })
  const nth = (key: TKey, n: number) => t(key, lang).replace('{n}', String(n))
  const caseBox = (
    <CheckLabel checked={quiz.caseSensitive} onChange={(caseSensitive) => set({ caseSensitive })}>
      {t('quiz.caseSensitive', lang)}
    </CheckLabel>
  )
  const Form = QUIZ_KINDS.find((o) => o.k === quiz.kind)?.Form ?? QuizChoice

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
      {/* ТИП ТЕСТА — списком, а не рядом кнопок: семи подписей в ряд нужен 481px, и
          на экране 390 они распирали страницу горизонтальной прокруткой (замер
          07.08.2026). Список из семи и по сути не сегмент. */}
      <Select value={quiz.kind} onValueChange={(v) => set({ kind: v as QuizKind })}>
        <SelectTrigger className="w-full self-start sm:w-[12rem]" aria-label={t('quiz.kind', lang)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {QUIZ_KINDS.map((o) => (
            <SelectItem key={o.k} value={o.k}>
              {t(o.label, lang)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Вопрос — общий для всех видов, поэтому стоит выше формы ответов. */}
      <LineField value={quiz.question} onChange={(question) => set({ question })} lang={lang} className="" label={t('quiz.questionPh', lang)} />

      <Form quiz={quiz} set={set} lang={lang} caseBox={caseBox} nth={nth} />

      <BubbleTextEditor value={quiz.explain} onChange={(v) => set({ explain: v })} rows={2} lang={lang} ariaLabel={t('quiz.explain', lang)} placeholder={t('quiz.explainPh', lang)} />
      <Hint>{t('quiz.checkOnListPage', lang)}</Hint>
    </div>
  )
}
