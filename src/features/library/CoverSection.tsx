'use client'

import { useRef, useState, useTransition } from 'react'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { AutoBanner } from '@/shared/ui/AutoBanner'
import type { Lang } from '@/shared/i18n'
import { removeListCover, setListAccent, setListCover } from './cover-actions'

const ACCENTS = ['', '#2159d6', '#7c3aed', '#15803d', '#c2570c', '#be123c', '#0f766e', '#b45309']
const card = 'rounded-lg border border-border bg-surface p-5'

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
  const ru = lang === 'ru'
  const [cover, setCover] = useState<string | null>(initialCover)
  const [accent, setAccent] = useState<string>(initialAccent ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [over, setOver] = useState(false)
  const [, start] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  function upload(file: File | undefined | null) {
    if (!file) return
    setErr('')
    setBusy(true)
    const fd = new FormData()
    fd.append('templateId', templateId)
    fd.append('file', file)
    setListCover(fd)
      .then((res) => {
        if ('error' in res) setErr(ru ? 'Не удалось загрузить.' : 'Upload failed.')
        else setCover(res.url)
      })
      .finally(() => setBusy(false))
  }

  function clear() {
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
    <section className={`${card} mb-6`}>
      <div className="mb-1 font-semibold text-ink">{ru ? 'Обложка' : 'Cover'}</div>
      <p className="mb-4 text-[13px] text-ink-2">
        {ru
          ? 'Баннер списка на витрине и в ленте. Нет обложки — рисуется авто-градиент по акценту.'
          : 'The banner shown on Explore and in feeds. With no cover, an auto-gradient is drawn from the accent.'}
      </p>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          upload(e.dataTransfer.files?.[0])
        }}
        className={`relative block h-[150px] w-full overflow-hidden rounded-lg border-2 ${over ? 'border-accent' : 'border-dashed border-border'}`}
        title={ru ? 'Перетащи или выбери картинку' : 'Drag or pick an image'}
      >
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="h-full w-full object-cover" />
        ) : (
          <AutoBanner seed={templateId} accent={accent} label={slug} height="h-full" />
        )}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-black/0 text-white opacity-0 transition-opacity hover:bg-black/35 hover:opacity-100">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
        </span>
      </button>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[12.5px] text-ink-2">{ru ? 'Акцент:' : 'Accent:'}</span>
          {ACCENTS.map((a) => (
            <button
              key={a || 'default'}
              type="button"
              onClick={() => pickAccent(a)}
              aria-label={a || 'default'}
              style={a ? { backgroundColor: a } : undefined}
              className={`h-5 w-5 rounded-full border ${a ? '' : 'bg-surface-2'} ${accent === a ? 'ring-2 ring-offset-1 ring-[var(--accent)]' : 'border-black/10'}`}
            >
              {!a && <span className="text-[10px] text-muted">×</span>}
            </button>
          ))}
        </div>
        {cover && (
          <button type="button" onClick={clear} className="inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-danger">
            <Trash2 size={13} /> {ru ? 'Убрать обложку' : 'Remove cover'}
          </button>
        )}
      </div>
      {err && <p className="mt-2 text-[12.5px] text-danger">{err}</p>}
    </section>
  )
}
