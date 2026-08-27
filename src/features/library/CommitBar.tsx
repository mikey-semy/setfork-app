'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Ellipsis, History } from 'lucide-react'
import { AvatarStack } from '@/shared/ui/AvatarStack'
import { Tooltip } from '@/shared/ui/Tooltip'
import { timeAgo } from '@/shared/ui/timeAgo'
import type { Lang } from '@/shared/i18n'
import { buttonClass } from '@/shared/ui/button-style'
import { IconButton } from '@/shared/ui/IconButton'

export interface CommitAuthor {
  handle: string
  name: string | null
  avatarUrl: string | null
}

/**
 * СТРОКА ПОСЛЕДНЕГО КОММИТА — как у GitHub над содержимым репозитория.
 *
 * Что в ней есть и почему:
 * — АВТОРЫ КОЛОДОЙ. У версии может быть несколько авторов (принятая правка + соавторы),
 *   и показывать одного значит стирать вклад остальных. Полноразмерным рядом они съедают
 *   ширину, поэтому внахлёст (AvatarStack), а имена — «X и Y», дальше «+N».
 * — РАСКРЫТИЕ ТЕКСТА. Сообщение версии часто длиннее строки: у GitHub для этого кнопка
 *   «...», разворачивающая полный текст под заголовком. Раньше хвост просто обрезался, и
 *   прочитать его было негде, кроме страницы коммитов.
 * — НОМЕР ВЕРСИИ — ссылка на КОММИТ (строку в истории), а не на снимок списка по этой
 *   версии: снимок отвечает на вопрос «каким список был», а от номера коммита ждёшь
 *   «что именно в нём поменяли».
 *
 * Кнопки управления (ветка, «Получить», правка, прогон) сюда НЕ входят: они живут строкой
 * выше и вне рамки — как у GitHub, где панель веток и «Code» стоят над коробкой коммита.
 */
export function CommitBar({
  authors,
  message,
  version,
  createdAt,
  commitsCount,
  versionsHref,
  lang,
  labels,
}: {
  authors: CommitAuthor[]
  /** Сообщение версии; может быть многострочным — тогда появляется «...». */
  message: string
  version: number
  createdAt: string | number | Date
  commitsCount: number
  versionsHref: string
  lang: Lang
  labels: { history: string; expand: string; collapse: string; commitLink: string; and: string; others: string }
}) {
  const [open, setOpen] = useState(false)
  const at = new Date(createdAt)

  // ТОЧНОЕ ВРЕМЯ в подсказке проставляем ПОСЛЕ монтирования. toLocaleString зависит от
  // часового пояса, а сервер и браузер живут в разных: на сервере вышла бы одна строка,
  // в браузере другая — это расхождение гидратации, и React мог оставить серверное
  // время, то есть показать чужой пояс как свой (замечание авто-ревью). До монтирования
  // подсказки просто нет; относительное «16 часов назад» рядом от пояса не зависит.
  const [exact, setExact] = useState<string | undefined>(undefined)
  useEffect(() => {
    setExact(at.toLocaleString(lang))
  }, [createdAt, lang])

  // Заголовок — первая строка, как в git: остальное считается телом сообщения.
  const [head, ...restLines] = message.split('\n')
  const body = restLines.join('\n').trim()
  const hasBody = body.length > 0

  const names = authors.map((a) => a.name || a.handle)
  // Союз между именами — через словарь, а не тернарником с литералами: третий язык не
  // должен требовать правки этого файла (правило i18n-линта).
  const shownNames = names.slice(0, 2).join(labels.and)
  // Хвост авторов подписываем СЛОВАМИ («и ещё 2»), а не вторым числовым бейджем: в колоде
  // уже есть «+N», и два разных счётчика рядом читались как ошибка.
  const restNames = names.length > 2 ? labels.others.replace('{n}', String(names.length - 2)) : ''

  return (
    <div className="mb-3 rounded-lg border border-border bg-surface text-body-sm text-ink-2 print:hidden">
      <div className="flex min-w-0 items-center gap-2 px-3 py-2 sm:px-3.5">
        {authors.length > 0 && <AvatarStack people={authors} size={20} />}
        {/* Имена — только с sm: на телефоне их место занимает заголовок сообщения. */}
        {shownNames && (
          <span className="hidden shrink-0 items-center gap-1 font-semibold text-ink sm:inline-flex">
            {authors.length === 1 ? (
              <Link href={`/${authors[0].handle}`} className="hover:text-accent">
                {shownNames}
              </Link>
            ) : (
              <span>{shownNames}</span>
            )}
            {restNames && <span className="font-normal text-muted">{restNames}</span>}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-ink-2">{head}</span>
        {hasBody && (
          <IconButton
            size="xs"
            variant="outline"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            label={open ? labels.collapse : labels.expand}
            className={`shrink-0 text-muted hover:text-ink ${
              open ? 'bg-surface-2 text-ink' : ''
            }`}
          >
            <Ellipsis size={13} />
          </IconButton>
        )}
        {/* Номер версии = «короткий sha» у GitHub: ведёт в историю, к этому коммиту. */}
        <Tooltip label={labels.commitLink}>
          <Link
            href={`${versionsHref}#v${version}`}
            className="shrink-0 rounded-md border border-border px-1.5 font-mono text-caption text-muted hover:border-border-strong hover:text-ink"
          >
            {`v${version}`}
          </Link>
        </Tooltip>
        <Tooltip label={exact}>
          <span className="hidden shrink-0 whitespace-nowrap text-muted sm:inline">{timeAgo(at, lang)}</span>
        </Tooltip>
        {/* Счётчик коммитов — как «96 Commits» у GitHub, ссылкой в историю. */}
        <Tooltip label={labels.history}>
          <Link
            href={versionsHref}
            aria-label={labels.history}
            className={buttonClass({ variant: 'ghost', className: 'hover:bg-surface-2' })}
          >
            <History size={15} />
            <span className="hidden font-mono text-body-sm md:inline">{commitsCount}</span>
          </Link>
        </Tooltip>
      </div>

      {open && hasBody && (
        <div className="border-t border-border px-3 py-2.5 sm:px-3.5">
          <pre className="whitespace-pre-wrap break-words font-sans text-body-sm leading-relaxed text-ink-2">{body}</pre>
        </div>
      )}
    </div>
  )
}
