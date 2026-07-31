'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ImageUp, Loader2, Sparkles, X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { Tooltip } from '@/shared/ui/Tooltip'
import type { Lang } from '@/shared/i18n'
import type { LandingContent, LandingCopy } from '@/shared/settings/landing'
import { saveLanding, suggestSlogan, uploadLandingImage } from './landing-actions'

type FieldKey = keyof Omit<LandingCopy, 'stats'>
type Field = { key: FieldKey; label: string; max: number; area?: boolean; ai?: boolean }

// Поля копирайта: лимит символов + где нужна AI-кнопка (слоганы). Порядок = как на странице.
const FIELDS: Field[] = [
  { key: 'eyebrow', label: 'Плашка (eyebrow)', max: 30 },
  { key: 'heroTitle', label: 'Заголовок hero', max: 40, ai: true },
  { key: 'heroTitleAccent', label: 'Заголовок — акцент', max: 30, ai: true },
  { key: 'heroSub', label: 'Подзаголовок hero', max: 220, area: true, ai: true },
  { key: 'ctaTitle', label: 'CTA — заголовок', max: 60, ai: true },
  { key: 'ctaSub', label: 'CTA — подпись', max: 160, area: true, ai: true },
  { key: 'ctaPrimary', label: 'CTA — кнопка 1', max: 30 },
  { key: 'ctaSecondary', label: 'CTA — кнопка 2', max: 30 },
  { key: 'footerBlurb', label: 'Футер — описание', max: 140, area: true },
  { key: 'footerNote', label: 'Футер — слоган', max: 40 },
]

export function LandingEditor({ initial, heroPreview, lang }: { initial: LandingContent; heroPreview?: string; lang: Lang }) {
  const say = (en: string, ru: string) => (lang === 'ru' ? ru : en)
  const router = useRouter()
  const [c, setC] = useState<LandingContent>(initial)
  const [tab, setTab] = useState<'ru' | 'en'>('ru')
  const [pending, start] = useTransition()
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const copy = c[tab]
  const setField = (key: FieldKey, val: string) => setC((p) => ({ ...p, [tab]: { ...p[tab], [key]: val } }))
  const setStat = (i: number, k: 'num' | 'label', val: string) =>
    setC((p) => ({ ...p, [tab]: { ...p[tab], stats: p[tab].stats.map((s, j) => (j === i ? { ...s, [k]: val } : s)) } }))

  function save() {
    setErr(null)
    start(async () => {
      const r = await saveLanding(c)
      if ('error' in r) setErr(r.error)
      else {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
        router.refresh()
      }
    })
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Язык контента */}
      <div className="flex w-fit items-center gap-1 rounded-md border border-border bg-surface-2 p-0.5">
        {(['ru', 'en'] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setTab(l)}
            className={cn('rounded px-3 py-1 text-[12.5px] font-semibold uppercase', tab === l ? 'bg-primary text-primary-fg' : 'text-ink-2 hover:text-ink')}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Картинка hero — drag-and-drop (переиспользуем медиа-пайплайн) */}
      <HeroImage initial={heroPreview} say={say} onRef={(ref) => setC((p) => ({ ...p, heroImage: ref }))} />

      {/* Текстовые поля с лимитом + AI-кнопкой */}
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <LimitedField
            key={f.key}
            field={f}
            value={copy[f.key]}
            onChange={(v) => setField(f.key, v)}
            onSuggest={f.ai ? () => suggestSlogan(tab, f.key, copy[f.key]) : undefined}
            className={f.area ? 'sm:col-span-2' : ''}
          />
        ))}
      </div>

      {/* Числа-статы (4 плитки) */}
      <div>
        <div className="mb-1.5 text-[12.5px] font-semibold text-ink-2">{say('Trust stats (4)', 'Плитки-статы (4)')}</div>
        <div className="grid gap-2 sm:grid-cols-4">
          {copy.stats.map((s, i) => (
            <div key={i} className="flex flex-col gap-1.5 rounded-md border border-border p-2">
              <Input value={s.num} maxLength={8} onChange={(e) => setStat(i, 'num', e.target.value)} placeholder="12k+" size="sm" />
              <Input value={s.label} maxLength={30} onChange={(e) => setStat(i, 'label', e.target.value)} placeholder={say('label', 'подпись')} size="sm" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" variant="primary" onClick={save} disabled={pending} className="px-4 py-2 text-[14px]">
          {pending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {say('Save', 'Сохранить')}
        </Button>
        {saved && <span className="text-[13px] text-ok">{say('Saved', 'Сохранено')}</span>}
        {err && <span className="text-[13px] text-danger">{err}</span>}
      </div>
    </div>
  )
}

// ── Поле с лимитом символов и опциональной AI-кнопкой ──
function LimitedField({
  field,
  value,
  onChange,
  onSuggest,
  className,
}: {
  field: Field
  value: string
  onChange: (v: string) => void
  onSuggest?: () => Promise<{ text: string } | { error: string }>
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const left = field.max - (value?.length ?? 0)

  const suggest = async () => {
    if (!onSuggest) return
    setBusy(true)
    const r = await onSuggest()
    setBusy(false)
    if ('text' in r && r.text) onChange(r.text.slice(0, field.max))
  }

  const aiBtn = onSuggest && (
    <Tooltip label="AI">
      <button
        type="button"
        onClick={suggest}
        disabled={busy}
        className="grid size-6 place-items-center rounded-md text-accent hover:bg-(--accent-soft) disabled:opacity-50"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
      </button>
    </Tooltip>
  )

  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="flex items-center justify-between text-[12.5px] font-semibold text-ink-2">
        {field.label}
        <span className={cn('font-mono text-[11px]', left < 0 ? 'text-danger' : 'text-muted')}>{left}</span>
      </span>
      {field.area ? (
        <div className="relative">
          <Textarea value={value} maxLength={field.max} rows={3} onChange={(e) => onChange(e.target.value)} className="pr-9" />
          {onSuggest && <div className="absolute right-1.5 top-1.5">{aiBtn}</div>}
        </div>
      ) : (
        <div className="relative">
          <Input value={value} maxLength={field.max} onChange={(e) => onChange(e.target.value)} className={onSuggest ? 'pr-9' : ''} />
          {onSuggest && <div className="absolute right-1.5 top-1/2 -translate-y-1/2">{aiBtn}</div>}
        </div>
      )}
    </label>
  )
}

// ── Hero-картинка: drag-and-drop → медиа-пайплайн (uploadLandingImage) ──
function HeroImage({ initial, onRef, say }: { initial?: string; onRef: (ref: string) => void; say: (en: string, ru: string) => string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(initial ?? null)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const upload = async (file: File) => {
    if (!file.type.startsWith('image/')) return setErr(say('Image only', 'Только картинка'))
    setErr(null)
    setBusy(true)
    const fd = new FormData()
    fd.set('file', file)
    const r = await uploadLandingImage(fd)
    setBusy(false)
    if ('error' in r) setErr(r.error)
    else {
      setPreview(r.url)
      onRef(r.ref)
    }
  }

  return (
    <div>
      <div className="mb-1.5 text-[12.5px] font-semibold text-ink-2">{say('Hero image', 'Картинка hero')}</div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) void upload(f) }}
        className={cn(
          'flex cursor-pointer items-center gap-4 rounded-lg border border-dashed p-4 transition-colors',
          drag ? 'border-accent bg-(--accent-soft)' : 'border-border-strong hover:border-accent hover:bg-surface-2',
        )}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-[64px] w-[110px] shrink-0 rounded-md border border-border object-cover" />
        ) : (
          <div className="grid h-[64px] w-[110px] shrink-0 place-items-center rounded-md bg-surface-2 text-muted">
            <ImageUp size={20} />
          </div>
        )}
        <div className="min-w-0 text-[13px]">
          <div className="flex items-center gap-1.5 font-medium text-ink">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ImageUp size={15} className="text-ink-2" />}
            {drag ? say('Drop to upload', 'Отпусти, чтобы загрузить') : say('Drag an image or click', 'Перетащи картинку или кликни')}
          </div>
          <p className="mt-1 text-[12.5px] text-muted">{say('PNG/JPG/WebP. Replaces the hero illustration.', 'PNG/JPG/WebP. Заменит иллюстрацию hero.')}</p>
          {preview && (
            <button type="button" onClick={(e) => { e.stopPropagation(); setPreview(null); onRef('') }} className="mt-1 inline-flex items-center gap-1 text-[12.5px] text-ink-2 hover:text-danger">
              <X size={12} /> {say('Reset to default', 'Сбросить на дефолт')}
            </button>
          )}
          {err && <p className="mt-1 text-[12.5px] text-danger">{err}</p>}
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }} className="hidden" />
    </div>
  )
}
