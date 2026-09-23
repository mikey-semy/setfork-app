'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { AutoBanner } from '@/shared/ui/AutoBanner'
import { Alert } from '@/shared/ui/Alert'
import { Button } from '@/shared/ui/button'
import { ColorSwatch } from '@/shared/ui/ColorSwatch'
import { SettingsSection } from '@/shared/ui/SettingsSection'
import { Spinner } from '@/shared/ui/Spinner'
import { SmartImage } from '@/shared/ui/SmartImage'
import { fill, t, type Lang } from '@/shared/i18n'
import { IMAGE_MAX_BYTES, IMAGE_TYPES, megabytes } from '@/shared/media/limits'
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

  // Свой blob-адрес — только когда сервер не дал превью (imgproxy выключен): иначе
  // успех выглядел бы как «ничего не произошло». Отзываем при замене и при уходе.
  const blobRef = useRef<string | null>(null)
  const dropBlob = () => {
    if (blobRef.current) URL.revokeObjectURL(blobRef.current)
    blobRef.current = null
  }
  useEffect(() => dropBlob, [])

  const { state, send } = useCoverUpload(templateId, setListCover, (url, file) => {
    dropBlob()
    if (!url) blobRef.current = URL.createObjectURL(file)
    setCover(url || blobRef.current)
  })
  const busy = state.kind === 'uploading'
  const pick = () => inputRef.current?.click()
  const next = state.kind === 'failed' ? coverFailureNext(state.reason) : null

  function clear() {
    dropBlob()
    setCover(null)
    start(async () => {
      await removeListCover(templateId)
    })
  }

  function pickAccent(a: string) {
    setAccent(a)
    start(async () => {
      await setListAccent(templateId, a)
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
        aria-label={t('coverTitle', lang)}
        aria-describedby="cover-pick-hint"
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f && !busy) void send(f)
        }}
        className={`relative block h-37.5 w-full overflow-hidden rounded-lg border-2 ${over ? 'border-accent' : 'border-dashed border-border'}`}
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
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-opacity hover:bg-black/35 hover:opacity-100">
            <ImagePlus size={18} />
          </span>
        )}
      </button>
      <p id="cover-pick-hint" className="mt-1.5 text-body-sm text-muted">
        {fill('cover.pickHint', lang, { n: megabytes(IMAGE_MAX_BYTES) })}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          // Сбрасываем поле: иначе повторный выбор ТОГО ЖЕ файла не даёт change.
          e.target.value = ''
          if (f) void send(f)
        }}
      />
      {state.kind === 'failed' && (
        <Alert
          variant="danger"
          className="mt-2"
          action={
            next === 'retry' ? (
              <Button size="xs" onClick={() => void send(state.file)}>
                {t('tryAgain', lang)}
              </Button>
            ) : next === 'pick' ? (
              <Button size="xs" onClick={pick}>
                {t('cover.pickAnother', lang)}
              </Button>
            ) : undefined
          }
        >
          {coverFailureText(state.reason, state.file, lang)}
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
          <TextButton tone="danger" onClick={clear}>
            <Trash2 size={13} /> {t('cover.remove', lang)}
          </TextButton>
        )}
      </div>
    </SettingsSection>
  )
}
