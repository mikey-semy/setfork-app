'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { AutoBanner } from '@/shared/ui/AutoBanner'
import { Alert } from '@/shared/ui/Alert'
import { Button } from '@/shared/ui/button'
import { ColorSwatch } from '@/shared/ui/ColorSwatch'
import { SettingsSection } from '@/shared/ui/SettingsSection'
import { Spinner } from '@/shared/ui/Spinner'
import { SmartImage } from '@/shared/ui/SmartImage'
import { fill, t, type Lang } from '@/shared/i18n'
import { IMAGE_ACCEPT, IMAGE_MAX_BYTES, megabytes } from '@/shared/media/limits'
import { removeListCover, setListAccent, setListCover } from './cover-actions'
import { coverFailureNext, coverFailureText, useCoverUpload } from './use-cover-upload'
import { TextButton } from '@/shared/ui/TextButton'

const ACCENTS = ['', '#2159d6', '#7c3aed', '#15803d', '#c2570c', '#be123c', '#0f766e', '#b45309']

/** Настройки списка → Обложка: drag-drop картинки + акцент авто-баннера. */
export function CoverSection({
  templateId,
  slug,
  initialCover,
  initialAccent,
  lang,
}: {
  templateId: string
  slug: string
  initialCover: string | null
  initialAccent: string | null
  lang: Lang
}) {
  const [cover, setCover] = useState<string | null>(initialCover)
  const [accent, setAccent] = useState<string>(initialAccent ?? '')
  const [over, setOver] = useState(false)
  const [, start] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)
  const hintId = useId()

  // Свой blob-адрес — только когда сервер не дал превью (imgproxy выключен): иначе
  // успех выглядел бы как «ничего не произошло». Отзываем при замене и при уходе.
  // Ответ, пришедший ПОСЛЕ ухода со страницы, blob не создаёт: отзывать его было бы
  // уже некому, и он жил бы до закрытия вкладки.
  const blobRef = useRef<string | null>(null)
  const mounted = useRef(false)
  const dropBlob = () => {
    if (blobRef.current) URL.revokeObjectURL(blobRef.current)
    blobRef.current = null
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      dropBlob()
    }
  }, [])

  const upload = useCoverUpload(templateId, setListCover, (url, file) => {
    if (!mounted.current) return
    dropBlob()
    if (!url) blobRef.current = URL.createObjectURL(file)
    setCover(url || blobRef.current)
  })
  const { state } = upload
  const busy = state.kind === 'uploading'
  const pick = () => inputRef.current?.click()
  const next = state.kind === 'failed' ? coverFailureNext(state.reason) : null

  // Удаление обложки и смена акцента показываются сразу, до ответа сервера. Сбой —
  // обычный исход (связь на телефоне), и без отката экран врал бы: обложка «убрана»,
  // а на странице списка осталась. Откатываем и называем причину с «Повторить».
  const [saveFailed, setSaveFailed] = useState<null | (() => void)>(null)

  // Ошибочная полоса одна: новое действие гасит причину прежнего, иначе под зоной
  // висели бы две полосы, и непонятно, какая из них про то, что сейчас нажато.
  function send(f: File) {
    setSaveFailed(null)
    void upload.send(f)
  }

  function clear() {
    const prev = cover
    upload.reset()
    setSaveFailed(null)
    setCover(null)
    start(async () => {
      try {
        await removeListCover(templateId)
        dropBlob()
      } catch {
        setCover(prev)
        setSaveFailed(() => clear)
      }
    })
  }

  // Акцент щёлкают подряд (A, затем B), и ответы приходят в любом порядке. Откат —
  // только если упал ПОСЛЕДНИЙ запрос: упавший A при уже выбранном B экран не трогает.
  // И откат — к последнему ПОДТВЕРЖДЁННОМУ сервером значению (по номеру запроса, а не
  // по порядку ответов), а не к тому, что было на экране перед щелчком.
  const accentSeq = useRef(0)
  const saved = useRef({ seq: 0, accent })

  function pickAccent(a: string) {
    const seq = ++accentSeq.current
    upload.reset()
    setSaveFailed(null)
    setAccent(a)
    start(async () => {
      try {
        await setListAccent(templateId, a)
        if (seq > saved.current.seq) saved.current = { seq, accent: a }
      } catch {
        if (seq !== accentSeq.current) return
        setAccent(saved.current.accent)
        setSaveFailed(() => () => pickAccent(a))
      }
    })
  }

  return (
    <SettingsSection title={t('coverTitle', lang)}>
      {/* Подсказка — строкой под зоной, а не всплывашкой: на пальце наведения нет,
          и тултип на телефоне не показывался никогда. */}
      {/* ui-parity-ok: зона перетаскивания — рамка в две толщины меняет цвет под курсором, у карточки такой роли нет */}
      <button
        type="button"
        onClick={pick}
        disabled={busy}
        aria-busy={busy}
        aria-label={busy ? t('editor.uploading', lang) : t('coverTitle', lang)}
        aria-describedby={hintId}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f && !busy) send(f)
        }}
        className={`group relative block h-37.5 w-full overflow-hidden rounded-lg border-2 ${over ? 'border-accent' : 'border-dashed border-border'}`}
      >
        {cover ? (
          <SmartImage src={cover} alt="" className="h-full w-full object-cover" />
        ) : (
          <AutoBanner seed={templateId} accent={accent} label={slug} height="h-full" />
        )}
        {busy ? (
          // Ожидание видно ВСЕГДА, а не по наведению: раньше кружок жил в hover-слое
          // с opacity-0, и на телефоне загрузка не показывалась вовсе.
          <span className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 text-body-sm font-medium text-white">
            <Spinner size="md" />
            {t('editor.uploading', lang)}
          </span>
        ) : (
          // Слой наведения — через `group` на кнопке: у самого слоя pointer-events-none,
          // и собственный hover: на нём не срабатывал никогда.
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-opacity group-hover:bg-black/35 group-hover:opacity-100">
            <ImagePlus size={18} />
          </span>
        )}
      </button>
      <p id={hintId} className="mt-1.5 text-body-sm text-muted">
        {fill('cover.pickHint', lang, { n: megabytes(IMAGE_MAX_BYTES) })}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          // Сбрасываем поле: иначе повторный выбор ТОГО ЖЕ файла не даёт change.
          e.target.value = ''
          if (f) send(f)
        }}
      />
      {state.kind === 'failed' && (
        <Alert
          variant="danger"
          className="mt-2"
          action={
            next === 'retry' ? (
              <Button size="sm" onClick={() => send(state.file)}>
                {t('tryAgain', lang)}
              </Button>
            ) : next === 'pick' ? (
              <Button size="sm" onClick={pick}>
                {t('cover.pickAnother', lang)}
              </Button>
            ) : undefined
          }
        >
          {coverFailureText(state.reason, state.file, lang)}
        </Alert>
      )}
      {saveFailed && (
        <Alert
          variant="danger"
          className="mt-2"
          action={
            <Button size="sm" onClick={saveFailed}>
              {t('tryAgain', lang)}
            </Button>
          }
        >
          {t('cover.errSettingSave', lang)}
        </Alert>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        {/* ⚠️ `flex-wrap` ОБЯЗАТЕЛЕН: на грубом указателе каждый кружок палитры дорастает
            до тач-цели 44px (TOUCH_MIN_BOX), и пять кружков с подписью не помещаются в
            360px — ряд распирал бы страницу горизонтально. Замечание авто-ревью по
            fe#827: цель не должна выигрывать у мобильной ширины, они обе обязательны. */}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="mr-1 text-body-sm text-ink-2">{t('cover.accent', lang)}</span>
          {ACCENTS.map((a) => (
            <ColorSwatch
              key={a || 'default'}
              color={a || null}
              selected={accent === a}
              label={a || 'default'}
              onSelect={() => pickAccent(a)}
            />
          ))}
        </div>
        {cover && (
          <TextButton tone="danger" onClick={clear} disabled={busy}>
            <Trash2 size={13} /> {t('cover.remove', lang)}
          </TextButton>
        )}
      </div>
    </SettingsSection>
  )
}
