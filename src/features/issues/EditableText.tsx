'use client'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { t, type Lang } from '@/shared/i18n'
import { Markdown } from '@/shared/ui/Markdown'
import { buttonClass } from '@/shared/ui/button-style'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { Tooltip } from '@/shared/ui/Tooltip'

/**
 * Текст задачи или комментария, который автор может поправить на месте.
 *
 * ⚠️ ФОРМА ОТКРЫВАЕТСЯ ВМЕСТО ТЕКСТА, А НЕ РЯДОМ. На телефоне карточка и так занимает
 * почти экран: вторая копия текста под первой заставляла бы листать, чтобы сверить
 * правку с оригиналом. Это же делают GitHub и Gitea — поле правки встаёт на место
 * реплики.
 *
 * ⚠️ КНОПКА — ИКОНКОЙ В УГЛУ КАРТОЧКИ, а не подписью в ряду: ряд шапки на 390px уже
 * занят именем, датой и меню «…». Тач-цель добирается зоной, вид остаётся ступенью
 * шкалы.
 */
export function EditableText({
  body,
  refBase,
  canEdit,
  action,
  titleField,
  lang,
}: {
  body: string
  refBase: string
  canEdit: boolean
  /** Серверный экшен: получает форму с полями `body` и (для задачи) `title`. */
  action: (formData: FormData) => void | Promise<void>
  /** Заголовок задачи — правится тем же полем формы; у комментария его нет. */
  titleField?: string
  lang: Lang
}) {
  const [editing, setEditing] = useState(false)

  if (!editing) {
    return (
      <div className="relative">
        {canEdit && (
          <Tooltip label={t('edit', lang)}>
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label={t('edit', lang)}
              className={buttonClass({
                variant: 'ghost',
                size: 'sm',
                touch: 'hit',
                // Зона — пропом `touch`, не строкой: подставленный руками TOUCH_HIT
                // начинается с pointer-coarse:relative и перебил бы absolute на телефоне.
                className: 'absolute right-0 top-0 size-7 p-0',
              })}
            >
              <Pencil size={14} />
            </button>
          </Tooltip>
        )}
        {body ? <Markdown refBase={refBase}>{body}</Markdown> : <p className="text-body italic text-muted">—</p>}
      </div>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      {titleField !== undefined && (
        <Input name="title" defaultValue={titleField} required aria-label={t('issueTitlePh', lang)} className="font-semibold" />
      )}
      <Textarea name="body" defaultValue={body} rows={6} aria-label={t('issueBodyPh', lang)} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonClass({ variant: 'primary' })}>
          {t('issue.saveEdit', lang)}
        </button>
        <button type="button" onClick={() => setEditing(false)} className={buttonClass()}>
          {t('cancel', lang)}
        </button>
      </div>
    </form>
  )
}
