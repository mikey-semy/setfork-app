'use client'

import { useState } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, Share2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'

/** Кнопка «Поделиться»: копирование ссылки + QR-код (удобно для печатных/показываемых списков). */
export function ShareButton({
  path,
  className,
  label,
  copiedLabel,
  copyLinkLabel,
  qrHint,
}: {
  path: string
  className?: string
  label?: string
  copiedLabel?: string
  copyLinkLabel?: string
  qrHint?: string
}) {
  const [copied, setCopied] = useState(false)
  const [qr, setQr] = useState('')

  const url = () => (typeof location !== 'undefined' ? location.origin + path : path)

  const onOpenChange = (open: boolean) => {
    if (open && !qr) QRCode.toDataURL(url(), { width: 176, margin: 1 }).then(setQr).catch(() => {})
  }
  const copy = () => {
    navigator.clipboard?.writeText(url())
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={className}>
          <Share2 size={15} /> {label && <span>{label}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[220px] p-3">
        <button
          onClick={copy}
          className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink"
        >
          {copied ? <Check size={15} className="text-ok" /> : <Copy size={15} />}
          {copied ? (copiedLabel ?? copyLinkLabel) : copyLinkLabel}
        </button>
        {qr && (
          <div className="mt-2 flex flex-col items-center border-t border-border pt-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR" width={160} height={160} className="rounded bg-white p-1" />
            <span className="mt-1.5 text-[11px] text-muted">{qrHint}</span>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
