'use client'

import { useRef, useState, type ReactNode } from 'react'

// Переиспользуемая зона drag-and-drop с РЕАЛЬНЫМ прогрессом: фон заливается
// слева-направо по мере отправки (progress 0..100), вместо неопределённого
// спиннера — видно, сколько осталось. progress===null → простаивает; на 100%
// тело отправлено, ждём обработку сервером (мягкий пульс).
export function UploadDropzone({
  progress,
  onFile,
  accept,
  idle,
  ru,
}: {
  progress: number | null
  onFile: (f: File) => void
  accept?: string
  idle: ReactNode // иконка + подпись в состоянии покоя
  ru: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const uploading = progress !== null
  const pct = Math.max(0, Math.min(100, Math.round(progress ?? 0)))
  const processing = uploading && pct >= 100 // тело ушло, сервер дожимает
  return (
    <div
      role="button"
      tabIndex={uploading ? -1 : 0}
      aria-busy={uploading}
      onClick={() => !uploading && ref.current?.click()}
      onKeyDown={(e) => !uploading && (e.key === 'Enter' || e.key === ' ') && ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        if (!uploading) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (uploading) return
        const f = e.dataTransfer.files?.[0]
        if (f) onFile(f)
      }}
      className={`relative flex min-h-[44px] items-center gap-2 overflow-hidden rounded-md border border-dashed px-3 py-2.5 text-[12.5px] transition-colors ${
        uploading
          ? 'cursor-default border-accent text-accent'
          : over
            ? 'cursor-pointer border-accent bg-(--accent-soft) text-accent'
            : 'cursor-pointer border-border text-ink-2 hover:border-border-strong'
      }`}
    >
      {/* Заливка фона слева-направо по прогрессу. */}
      {uploading && (
        <div
          aria-hidden
          className={`absolute inset-y-0 left-0 bg-(--accent-soft) ${processing ? 'animate-pulse' : 'transition-[width] duration-150 ease-out'}`}
          style={{ width: `${pct}%` }}
        />
      )}
      <div className="relative flex min-w-0 items-center gap-2">
        {uploading ? (
          <span aria-live="polite" className="tabular-nums">
            {processing ? (ru ? 'Обработка…' : 'Processing…') : `${ru ? 'Загрузка' : 'Uploading'} ${pct}%`}
          </span>
        ) : (
          idle
        )}
      </div>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
