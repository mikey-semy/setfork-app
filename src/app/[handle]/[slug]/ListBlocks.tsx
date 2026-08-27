import { Fragment } from 'react'
import { Lock } from 'lucide-react'
import { t, tr, type Lang } from '@/shared/i18n'
import { renderListBlock } from './ListBlock'
import { ListStepCard } from './ListStepCard'
import { sectionAnchor, type ListPageData } from './load'
import { SectionLabel } from '@/shared/ui/SectionLabel'
import { cn } from '@/shared/lib/cn'

type Props = Pick<
  ListPageData,
  // порядок и уроки
  | 'steps'
  | 'isStepBlock'
  | 'displayNum'
  | 'lessons'
  | 'lessonOfBlock'
  | 'gatedFromLesson'
  | 'firstLockedIdx'
  // то, что нужно самим блокам и карточкам шагов
  | 'tpl'
  | 'base'
  | 'viewer'
  | 'readOnlyView'
  | 'isOwner'
  | 'digSteps'
  | 'stepImages'
  | 'blockImages'
  | 'pollResults'
  | 'quizStates'
  | 'canInteract'
  | 'nowMs'
  | 'mon'
> & { lang: Lang }

/**
 * Содержимое списка: блоки по порядку, заголовки уроков и замок последовательного
 * доступа. Сам вид блока этот файл не знает — за него отвечают
 * [ListBlock.tsx](./ListBlock.tsx) и [ListStepCard.tsx](./ListStepCard.tsx).
 */
export function ListBlocks(props: Props) {
  const { steps, isStepBlock, displayNum, lessons, lessonOfBlock, gatedFromLesson, firstLockedIdx, tpl, lang } = props
  // Block flow в print надёжно разбивается между страницами; flex-колонка в
  // Chromium может удержать высокий code block одним фрагментом и обрезать хвост.
  return (
    <div className="flex flex-col gap-3 print:block print:space-y-3">
      {steps.map((s, si) => {
        // Заголовок урока/секции — у ЛЮБОГО блока: показываем, когда секция
        // отличается от секции ПРЕДЫДУЩЕГО блока (начинается новый урок).
        const section = tr(s.section, lang)
        const prevSection = si > 0 ? tr(steps[si - 1].section, lang) : ''
        const header =
          section && section !== prevSection ? (
            <SectionLabel
              as="h2"
              size="body"
              id={sectionAnchor(section)}
              className={cn('scroll-mt-24 [overflow-wrap:anywhere]', si > 0 && 'mt-3')}
            >
              {section}
            </SectionLabel>
          ) : null

        // Quiz-gate: блоки заблокированного урока не показываем; на первом —
        // карточка-замок «пройдите тесты предыдущего урока».
        if (firstLockedIdx >= 0 && lessonOfBlock[si] >= gatedFromLesson) {
          if (si !== firstLockedIdx) return null
          const prevLesson = lessons[gatedFromLesson - 1]
          return (
            <div key={s.id} className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-surface-2 px-4 py-5 text-body text-ink-2">
              <Lock size={18} className="shrink-0 text-muted" />
              <span>
                {t('list.lockedUntilPassed', lang)} <b className="text-ink">«{prevLesson?.title}»</b>
                {prevLesson ? ` (${prevLesson.quizPassed}/${prevLesson.quizTotal})` : ''}.
              </span>
            </div>
          )
        }

        // Презентационные блоки (text/image/video/file/product/poll/quiz) — вне карточки-шага.
        if (!isStepBlock(s)) {
          const el = renderListBlock({ ...props, step: s, section })
          if (!el && !header) return null
          return (
            <Fragment key={s.id}>
              {header}
              {el}
            </Fragment>
          )
        }

        return (
          <Fragment key={s.id}>
            {header}
            <ListStepCard {...props} step={s} number={tpl.ordered ? String(displayNum[si]) : '•'} />
          </Fragment>
        )
      })}
    </div>
  )
}
