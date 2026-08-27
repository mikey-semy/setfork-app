'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Alert } from '@/shared/ui/Alert'
import { Button } from '@/shared/ui/button'
import { CodeEditor } from '@/shared/ui/CodeEditor'
import { TEXT } from '@/shared/ui/control'
import { t, type Lang } from '@/shared/i18n'
import { parseCanonAction, renderCanonAction } from '../actions/canon'
import type { EditorItem } from '../editor'
import { cardClass } from '@/shared/ui/card-style'
import { Spinner } from '@/shared/ui/Spinner'

/** Придирка ядра к тексту. Текст выбирает ИНТЕРФЕЙС по коду: язык читателя знает
 *  он, а не ядро (та же дисциплина, что у отказов пуша). */
export type CanonIssue = { path: string; code: string; message: string; line: number; column: number }

/** Понятная строка придирки. Неизвестный код — не повод молчать: показываем путь и
 *  техническое пояснение ядра, иначе новая проверка в ядре выглядела бы как пустая
 *  ошибка «что-то не так». */
function issueText(i: CanonIssue, lang: Lang): string {
  const where = i.line > 0 ? t('canon.atLine', lang).replace('{n}', String(i.line)) : i.path
  const known: Record<string, string> = {
    syntax: t('canon.issueSyntax', lang),
    schema: t('canon.issueSchema', lang),
    step_title_required: t('canon.issueStepTitle', lang),
    ref_label_required: t('canon.issueRefLabel', lang),
  }
  return `${where} — ${known[i.code] ?? i.message}`
}

/**
 * Правка списка КАК КОДА: канонический `list.json` текстом.
 *
 * Формат целиком принадлежит ядру: оно собирает текст и оно же разбирает его
 * строго. Панель ничего не сериализует и не валидирует — только показывает и
 * спрашивает.
 *
 * Разобранный текст возвращается БЛОКАМИ (`onApply`), а не сохраняется отдельным
 * путём: сохранение остаётся одно — обычная кнопка формы. Второй путь записи
 * означал бы дубликаты стража команд, квот и модерации, и однажды один из них
 * отстал бы от другого.
 */
export function CanonPanel({
  templateId,
  itemsJson,
  onApply,
  lang,
}: {
  templateId: string
  /** Состав, который сейчас в редакторе, — вместе с несохранёнными правками. */
  itemsJson: string
  onApply: (items: EditorItem[]) => void
  lang: Lang
}) {
  const [text, setText] = useState<string | null>(null)
  const [issues, setIssues] = useState<CanonIssue[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Панель ещё на экране. Ответ ядра, пришедший ПОСЛЕ закрытия, применять нельзя:
  // человек уже вернулся к блокам и, возможно, правит их — запоздалый разбор
  // затёр бы свежую работу (находка авто-ревью #719).
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )

  // Состав ЗАПОМИНАЕТСЯ на момент открытия панели — ровно тот, что человек видел
  // в блоках, нажимая «</>». Дальше он меняться не должен: запрос к ядру идёт один
  // раз, и подставлять в него более свежее значение было бы нечем — блоки на время
  // правки текста спрятаны. Отсюда и ref без синхронизации: писать его в рендере
  // React прямо запрещает (рендер обязан быть чистым), а нужды в этом нет.
  const itemsRef = useRef(itemsJson)

  useEffect(() => {
    let alive = true
    void (async () => {
      const res = await renderCanonAction(templateId, itemsRef.current)
      if (!alive) return
      if ('canon' in res) setText(res.canon)
      else setError(res.error)
    })()
    return () => {
      alive = false
    }
  }, [templateId])

  async function apply() {
    if (text === null || busy) return
    setBusy(true)
    setIssues([])
    setError(null)
    try {
      const res = await parseCanonAction(templateId, text)
      if (!alive.current) return
      if ('items' in res) onApply(res.items)
      else if ('issues' in res) setIssues(res.issues)
      else setError(res.error)
    } finally {
      // Снимаем занятость и на отказе: иначе сбой связи оставлял бы кнопку
      // вечно крутящейся, и повторить попытку было бы нечем.
      if (alive.current) setBusy(false)
    }
  }

  if (error) {
    return (
      <Alert variant="danger">
        <span className="block font-semibold">{t('canon.unavailableTitle', lang)}</span>
        <span className="block">{t('canon.unavailableHint', lang)}</span>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className={`${TEXT.bodySm} text-muted`}>{t('canon.hint', lang)}</p>
      {text === null ? (
        <div className={cardClass({ tone: 'inset', className: 'flex items-center gap-2 text-body text-muted' })}>
          <Spinner size="md" /> {t('canon.loading', lang)}
        </div>
      ) : (
        // Целый файл, а не поле команды: окно во весь экран по высоте, прокрутка
        // внутри — иначе на телефоне видно шесть строк из сотни.
        <CodeEditor value={text} onChange={setText} ariaLabel={t('canon.editorLabel', lang)} maxHeightClass="max-h-[65vh]" />
      )}

      {issues.length > 0 && (
        <Alert variant="danger">
          <span className="mb-1 flex items-center gap-1.5 font-semibold">
            <AlertTriangle size={14} /> {t('canon.issuesTitle', lang).replace('{n}', String(issues.length))}
          </span>
          {/* Все придирки разом: список по одной за проход заставлял бы применять
              текст по кругу ради следующей. */}
          <ul className="flex list-disc flex-col gap-0.5 pl-4">
            {issues.map((i, k) => (
              <li key={`${i.path}-${i.code}-${k}`}>{issueText(i, lang)}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button variant="primary" onClick={() => void apply()} disabled={busy || text === null}>
          {busy ? <Spinner size="md" /> : null}
          {t('canon.apply', lang)}
        </Button>
      </div>
    </div>
  )
}
