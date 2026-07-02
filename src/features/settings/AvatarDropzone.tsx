'use client'

import { useRef, useState } from 'react'
import { ImageUp, X } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { t, type Lang } from '@/shared/i18n'

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const MAX_BYTES = 2 * 1024 * 1024

/** Аватар с drag-and-drop: перетащить или кликнуть. Выбранный файл кладётся в
 *  скрытый input[name=avatar], чтобы уйти в форму updateProfile обычным сабмитом. */
export function AvatarDropzone({ handle, avatarUrl, lang }: { handle: string; avatarUrl: string | null; lang: Lang }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const accept = (file: File): boolean => {
    if (!ACCEPT.includes(file.type)) {
      setError(t('avatarTypeErr', lang))
      return false
    }
    if (file.size > MAX_BYTES) {
      setError(t('avatarSizeErr', lang))
      return false
    }
    setError(null)
    return true
  }

  const applyFile = (file: File) => {
    if (!accept(file)) return
    // Кладём файл в input, чтобы он ушёл в FormData вместе с формой.
    const dt = new DataTransfer()
    dt.items.add(file)
    if (inputRef.current) inputRef.current.files = dt.files
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) applyFile(file)
  }

  const clear = () => {
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div>
      <label className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">{t('avatar', lang)}</label>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer items-center gap-4 rounded-lg border border-dashed p-4 transition-colors ${
          dragOver ? 'border-accent bg-[var(--accent-soft)]' : 'border-border-strong hover:border-accent hover:bg-surface-2'
        }`}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-[72px] w-[72px] shrink-0 rounded-full object-cover" />
        ) : (
          <Avatar handle={handle} avatarUrl={avatarUrl} size={72} />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
            <ImageUp size={16} className="text-ink-2" />
            {dragOver ? t('dropRelease', lang) : t('dropAvatar', lang)}
          </div>
          <p className="mt-1 text-[12px] text-muted">{t('avatarHint', lang)}</p>
          {error && <p className="mt-1 text-[12px] text-[var(--danger)]">{error}</p>}
          {preview && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                clear()
              }}
              className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-ink-2 hover:text-ink"
            >
              <X size={12} /> {t('removePhoto', lang)}
            </button>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        name="avatar"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) applyFile(f)
        }}
        className="hidden"
      />
    </div>
  )
}
