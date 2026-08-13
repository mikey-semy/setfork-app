import { type ReactNode } from 'react'
import { Paperclip } from 'lucide-react'
import { quizKind, stripQuizAnswers, type QuizBlockContent } from '@/core'
import { blockChatTitle, pollDeadlineMs, productItems } from '@/features/library/blocks'
import { VideoEmbed } from '@/features/library/VideoEmbed'
import { PollBlock, type PollContent } from '@/features/polls/PollBlock'
import { QuizBlock } from '@/features/quizzes/QuizBlock'
import { DigChatOpen } from '@/features/dig/DigChat'
import { Markdown } from '@/shared/ui/Markdown'
import { ProductBlock } from '@/shared/ui/ProductBlock'
import { SafeLink } from '@/shared/ui/SafeLink'
import { SmartImage } from '@/shared/ui/SmartImage'
import { renderWikiLinks } from '@/shared/lib/wiki-links'
import { t, type Lang } from '@/shared/i18n'
import type { ListPageData } from './load'
import { cardClass } from '@/shared/ui/card-style'

type BlockProps = Pick<
  ListPageData,
  'tpl' | 'viewer' | 'readOnlyView' | 'digSteps' | 'blockImages' | 'pollResults' | 'quizStates' | 'canInteract' | 'nowMs' | 'mon'
> & {
  step: ListPageData['steps'][number]
  /** Заголовок урока, к которому относится блок, — им подписан вход в чат раскопки. */
  section: string
  lang: Lang
}

/**
 * Презентационные блоки списка (text/image/video/file/product/poll/quiz) — всё, что
 * стоит между шагами и рисуется вне карточки-шага.
 *
 * Вид блока выбирается ТАБЛИЦЕЙ, а не лестницей `else if`: новый тип блока — это
 * строка в таблице и своя функция, а не правка общего ветвления. Каждая возвращает
 * null, если содержимого нет (пустой текст, битая картинка, опрос без вариантов), —
 * тогда блок не занимает места.
 */
const BLOCKS: Record<string, (p: BlockProps) => ReactNode> = {
  text: ({ step, section, tpl, viewer, readOnlyView, digSteps, lang }) => {
    const md = typeof step.content?.md === 'string' ? step.content.md : ''
    if (!md) return null
    // Текст-блок — такая же карточка с киркой, как шаг: это часть материала,
    // по которой так же копают (в прохождении он уже такой — RunView). Раньше
    // здесь был голый абзац: ни рамки, ни входа в чат (фидбек владельца).
    const canDig = !!viewer && !readOnlyView && typeof step.n === 'number'
    return (
      <div className={cardClass({ className: 'relative break-inside-avoid' })}>
        {canDig && typeof step.n === 'number' && (
          <span className="absolute right-2 top-2 print:hidden">
            <DigChatOpen
              detail={{ templateId: tpl.id, stepN: step.n, stepTitle: blockChatTitle('text', '', section, lang) }}
              label={t('list.digIntoStep', lang)}
              hasSession={digSteps.has(step.n)}
            />
          </span>
        )}
        <Markdown className={`text-[0.875rem] leading-relaxed text-ink-2${canDig ? ' pr-10' : ''}`}>{renderWikiLinks(md)}</Markdown>
      </div>
    )
  },

  image: ({ step, blockImages, lang }) => {
    const ref = typeof step.content?.ref === 'string' ? step.content.ref : ''
    const url = ref ? blockImages[ref] : ''
    if (!url) return null
    const caption = typeof step.content?.caption === 'string' ? step.content.caption : ''
    return (
      <figure className="break-inside-avoid">
        <SmartImage src={url} alt={caption || t('screenshot', lang)} className="max-h-[32.5rem] w-auto rounded-lg border border-border" />
        {caption && <figcaption className="mt-1.5 text-[0.78125rem] text-muted">{caption}</figcaption>}
      </figure>
    )
  },

  video: ({ step }) => {
    const url = typeof step.content?.url === 'string' ? step.content.url : ''
    if (!url) return null
    const caption = typeof step.content?.caption === 'string' ? step.content.caption : ''
    return (
      <div>
        <VideoEmbed url={url} caption={caption} />
      </div>
    )
  },

  file: ({ step }) => {
    const url = typeof step.content?.url === 'string' ? step.content.url : ''
    if (!url) return null
    const name = typeof step.content?.name === 'string' ? step.content.name : ''
    return (
      <SafeLink href={url} className="inline-flex max-w-full items-center gap-2 break-inside-avoid rounded-md border border-border bg-surface-2 px-3 py-2 text-[0.8125rem] text-accent hover:border-border-strong">
        <Paperclip size={15} className="shrink-0 text-muted" />
        <span className="min-w-0 truncate">{name || url}</span>
      </SafeLink>
    )
  },

  product: ({ step, readOnlyView, mon, lang }) => {
    // href — через /api/go/<step>/p<idx> (клики+партнёрский тег), если
    // трекинг включён; у snapshot-веток нет DB-id → прямой url.
    const items = productItems(step.content).map((p) => ({
      ...p,
      href: !readOnlyView && mon.linkTracking ? `/api/go/${step.id}/p${p.idx}` : p.url,
    }))
    if (!items.length) return null
    const title = typeof step.content?.title === 'string' ? step.content.title : ''
    return <ProductBlock title={title} items={items} lang={lang} />
  },

  poll: ({ step, tpl, pollResults, canInteract, nowMs, lang }) => {
    const c = (step.content ?? {}) as unknown as PollContent & { bid?: string }
    if (!Array.isArray(c.options) || !c.options.length) return null
    const bid = typeof c.bid === 'string' ? c.bid : ''
    const deadlineMs = pollDeadlineMs(c.deadline)
    return (
      <div className="break-inside-avoid">
        <PollBlock
          templateId={tpl.id}
          bid={bid}
          content={c}
          result={pollResults[bid] ?? { counts: {}, voters: 0, myVotes: [] }}
          canVote={canInteract}
          closed={deadlineMs !== null && deadlineMs < nowMs}
          lang={lang}
        />
      </div>
    )
  },

  quiz: ({ step, tpl, viewer, quizStates, canInteract, lang }) => {
    const c = (step.content ?? {}) as unknown as QuizBlockContent
    if (!quizRenderable(c)) return null
    const bid = typeof c.bid === 'string' ? c.bid : ''
    return (
      <div className="break-inside-avoid">
        <QuizBlock
          // Авторизованному оценивает сервер → НЕ отдаём ответы в разметку.
          content={viewer ? stripQuizAnswers(c) : c}
          lang={lang}
          templateId={tpl.id}
          bid={bid}
          canSubmit={canInteract}
          // Режим разметки — по тому, вырезаны ли ответы, а не по праву
          // отвечать: иначе на снимке авторизованный зритель попадал в
          // анонимный режим, которому нужны ответы (их уже нет).
          answersStripped={!!viewer}
          initial={quizStates[bid] ?? { selected: [], correct: false, attempts: 0, submitted: false }}
        />
      </div>
    )
  },
}

/** Есть ли у вопроса то, из чего он состоит: варианты, пропуск, пары, порядок. */
function quizRenderable(c: QuizBlockContent): boolean {
  switch (quizKind(c)) {
    case 'choice':
      return Array.isArray(c.options) && c.options.length > 0
    case 'blank':
      return typeof c.template === 'string' && c.template.includes('___')
    case 'match':
      return (Array.isArray(c.pairs) && c.pairs.length > 0) || (Array.isArray(c.lefts) && c.lefts.length > 0)
    case 'sort':
      return (Array.isArray(c.items) && c.items.length > 0) || (Array.isArray(c.shuffled) && c.shuffled.length > 0)
    default:
      return true
  }
}

export function renderListBlock(props: BlockProps): ReactNode {
  return BLOCKS[props.step.type ?? '']?.(props) ?? null
}
