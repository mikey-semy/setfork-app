'use client'

import { t, type Lang } from '@/shared/i18n'
import { useRef, useState, useTransition } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { Switch } from '@/shared/ui/switch'
import { Tooltip } from '@/shared/ui/Tooltip'
import { Alert } from '@/shared/ui/Alert'
import { ACHIEVEMENT_KEYS, type AchievementKey } from '@/features/profile/achievements'
import { ACH_META } from '@/features/profile/achievement-meta'
import type { AchDisplayMap } from '@/features/profile/achievement-config'
import { removeAchievementImage, setAchievementEnabled, uploadAchievementImage } from './achievement-actions'
import { buttonClass } from '@/shared/ui/button-style'
import { cardClass } from '@/shared/ui/card-style'
import { Spinner } from '@/shared/ui/Spinner'

/** Админ-панель достижений: вкл/выкл + своя картинка (drag-and-drop) на каждое. */
export function AchievementsAdmin({ initial, lang }: { initial: AchDisplayMap; lang: Lang }) {
  const ru = lang === 'ru'
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
      {err && <Alert variant="danger">{err}</Alert>}
      {ACHIEVEMENT_KEYS.map((key) => (
        <AchRow key={key} k={key} d={map[key]} lang={lang} pending={pending} onToggle={toggle} onUpload={upload} onClear={clearImage} />
      ))}
      <p className="mt-1 text-[0.78125rem] text-muted">
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
  lang,
  pending,
  onToggle,
  onUpload,
  onClear,
}: {
  k: AchievementKey
  d: { enabled: boolean; imageUrl: string }
  lang: Lang
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
    <div className={cardClass({ tone: 'inset', pad: 'sm', className: `flex items-center gap-3 ${d.enabled ? '' : 'opacity-60'}` })}>
      {/* Плитка-дропзона: картинка или иконка-фолбэк. */}
      <Tooltip label={t('ach.pickImage', lang)}>
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
          className={buttonClass({
            variant: 'ghost',
            className: `relative size-11 shrink-0 overflow-hidden border p-0 ${over ? 'border-accent bg-(--accent-soft)' : 'border-dashed border-border'}`,
          })}
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
        <div className="truncate text-[0.8125rem] font-medium text-ink">{t(meta.label, lang)}</div>
        <div className="font-mono text-[0.6875rem] text-muted">{k}</div>
      </div>

      {d.imageUrl && (
        <Tooltip label={t('ach.resetImage', lang)}>
          <button
            type="button"
            onClick={() => onClear(k)}
            className={buttonClass({ variant: 'danger', className: 'hover:bg-surface hover:text-danger' })}
          >
            <X size={15} />
          </button>
        </Tooltip>
      )}
      {pending && <Spinner size="md" className="text-muted" />}
      <Switch checked={d.enabled} onCheckedChange={(v) => onToggle(k, v)} />
    </div>
  )
}
