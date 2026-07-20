'use client'

import { useRef, useState, useTransition } from 'react'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { Switch } from '@/shared/ui/switch'
import { Tooltip } from '@/shared/ui/Tooltip'
import { ACHIEVEMENT_KEYS, type AchievementKey } from '@/features/profile/achievements'
import { ACH_META } from '@/features/profile/achievement-meta'
import type { AchDisplayMap } from '@/features/profile/achievement-config'
import { removeAchievementImage, setAchievementEnabled, uploadAchievementImage } from './achievement-actions'

/** Админ-панель достижений: вкл/выкл + своя картинка (drag-and-drop) на каждое. */
export function AchievementsAdmin({ initial, ru }: { initial: AchDisplayMap; ru: boolean }) {
  const [map, setMap] = useState<AchDisplayMap>(initial)
  const [pending, start] = useTransition()
  const [err, setErr] = useState('')

  function toggle(key: AchievementKey, enabled: boolean) {
    setMap((m) => ({ ...m, [key]: { ...m[key], enabled } }))
    start(async () => {
      await setAchievementEnabled(key, enabled)
    })
  }

  function upload(key: AchievementKey, file: File | undefined | null) {
    if (!file) return
    setErr('')
    const fd = new FormData()
    fd.append('key', key)
    fd.append('file', file)
    start(async () => {
      const res = await uploadAchievementImage(fd)
      if ('error' in res) setErr(res.error)
      else setMap((m) => ({ ...m, [key]: { ...m[key], imageUrl: res.url } }))
    })
  }

  function clearImage(key: AchievementKey) {
    setMap((m) => ({ ...m, [key]: { ...m[key], imageUrl: '' } }))
    start(async () => {
      await removeAchievementImage(key)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {err && <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{err}</div>}
      {ACHIEVEMENT_KEYS.map((key) => (
        <AchRow key={key} k={key} d={map[key]} ru={ru} pending={pending} onToggle={toggle} onUpload={upload} onClear={clearImage} />
      ))}
      <p className="mt-1 text-[12px] text-muted">
        {ru
          ? 'Перетащи картинку на плитку или кликни по ней. Выключенное достижение не показывается ни на одном профиле.'
          : 'Drag an image onto a tile or click it. A disabled achievement is hidden on all profiles.'}
      </p>
    </div>
  )
}

function AchRow({
  k,
  d,
  ru,
  pending,
  onToggle,
  onUpload,
  onClear,
}: {
  k: AchievementKey
  d: { enabled: boolean; imageUrl: string }
  ru: boolean
  pending: boolean
  onToggle: (k: AchievementKey, v: boolean) => void
  onUpload: (k: AchievementKey, f: File | undefined | null) => void
  onClear: (k: AchievementKey) => void
}) {
  const meta = ACH_META[k]
  const Icon = meta.icon
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  return (
    <div className={`flex items-center gap-3 rounded-md border border-border bg-surface-2 p-2.5 ${d.enabled ? '' : 'opacity-60'}`}>
      {/* Плитка-дропзона: картинка или иконка-фолбэк. */}
      <Tooltip label={ru ? 'Перетащи или выбери картинку' : 'Drag or pick an image'}>
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
            onUpload(k, e.dataTransfer.files?.[0])
          }}
          className={`relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border ${
            over ? 'border-accent bg-(--accent-soft)' : 'border-dashed border-border'
          }`}
        >
          {d.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Icon size={20} className={meta.color} />
          )}
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-opacity hover:bg-black/40 hover:opacity-100">
            <ImagePlus size={16} />
          </span>
        </button>
      </Tooltip>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => onUpload(k, e.target.files?.[0])} />

      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium text-ink">{ru ? meta.ru : meta.en}</div>
        <div className="font-mono text-[11px] text-muted">{k}</div>
      </div>

      {d.imageUrl && (
        <Tooltip label={ru ? 'Сбросить к иконке' : 'Reset to icon'}>
          <button
            type="button"
            onClick={() => onClear(k)}
            className="shrink-0 rounded p-1 text-muted hover:bg-surface hover:text-danger"
          >
            <X size={15} />
          </button>
        </Tooltip>
      )}
      {pending && <Loader2 size={14} className="shrink-0 animate-spin text-muted" />}
      <Switch checked={d.enabled} onCheckedChange={(v) => onToggle(k, v)} />
    </div>
  )
}
