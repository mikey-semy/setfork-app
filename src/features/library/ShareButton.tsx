'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, Share2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { Tooltip } from '@/shared/ui/Tooltip'

// Бренд-иконки (24×24, single-path, currentColor) — в lucide их нет.
const P = (d: string) => (
  <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor" aria-hidden>
    <path d={d} />
  </svg>
)
const ICON: Record<string, React.ReactNode> = {
  X: P('M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'),
  Telegram: P('M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212-.07-.062-.174-.041-.249-.024-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z'),
  WhatsApp: P('M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z'),
  Facebook: P('M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z'),
  LinkedIn: P('M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0z'),
  VK: P('m9.489.004.729-.003h3.564l.73.003.914.01.433.007.418.011.403.014.388.016.374.021.36.025.345.03.333.033c1.74.196 2.933.616 3.833 1.516.9.9 1.32 2.092 1.516 3.833l.034.333.029.346.025.36.02.373.025.588.012.41.013.644.009.915.004.98-.001 3.313-.003.73-.01.914-.007.433-.011.418-.014.403-.016.388-.021.374-.025.36-.03.345-.033.333c-.196 1.74-.616 2.933-1.516 3.833-.9.9-2.092 1.32-3.833 1.516l-.333.034-.346.029-.36.025-.373.02-.588.025-.41.012-.644.013-.915.009-.98.004-3.313-.001-.73-.003-.914-.01-.433-.007-.418-.011-.403-.014-.388-.016-.374-.021-.36-.025-.345-.03-.333-.033c-1.74-.196-2.933-.616-3.833-1.516-.9-.9-1.32-2.092-1.516-3.833l-.034-.333-.029-.346-.025-.36-.02-.373-.025-.588-.012-.41-.013-.644-.009-.915-.004-.98.001-3.313.003-.73.01-.914.007-.433.011-.418.014-.403.016-.388.021-.374.025-.36.03-.345.033-.333c.196-1.74.616-2.933 1.516-3.833.9-.9 2.092-1.32 3.833-1.516l.333-.034.346-.029.36-.025.373-.02.588-.025.41-.012.644-.013.915-.009ZM6.79 7.3H4.05c.13 6.24 3.25 9.99 8.72 9.99h.31v-3.57c2.01.2 3.53 1.67 4.14 3.57h2.84c-.78-2.84-2.83-4.41-4.11-5.01 1.28-.74 3.08-2.54 3.51-4.98h-2.58c-.56 1.98-2.22 3.78-3.8 3.95V7.3H10.5v6.92c-1.6-.4-3.62-2.34-3.71-6.92Z'),
  OK: P('M12 0a6.2 6.2 0 0 0-6.194 6.195 6.2 6.2 0 0 0 6.195 6.192 6.2 6.2 0 0 0 6.193-6.192A6.2 6.2 0 0 0 12.001 0zm0 3.63a2.567 2.567 0 0 1 2.565 2.565 2.568 2.568 0 0 1-2.564 2.564 2.568 2.568 0 0 1-2.565-2.564 2.567 2.567 0 0 1 2.565-2.564zM6.807 12.6a1.814 1.814 0 0 0-.91 3.35 11.611 11.611 0 0 0 3.597 1.49l-3.462 3.463a1.815 1.815 0 0 0 2.567 2.566L12 20.066l3.405 3.403a1.813 1.813 0 0 0 2.564 0c.71-.709.71-1.858 0-2.566l-3.462-3.462a11.593 11.593 0 0 0 3.596-1.49 1.814 1.814 0 1 0-1.932-3.073 7.867 7.867 0 0 1-8.34 0c-.318-.2-.674-.29-1.024-.278z'),
  Reddit: P('M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12c-.688 0-1.25.561-1.25 1.25 0 .687.562 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z'),
}

function networks(u: string, text: string, ru: boolean) {
  const eu = encodeURIComponent(u)
  const et = encodeURIComponent(text)
  const all: Record<string, string> = {
    VK: `https://vk.com/share.php?url=${eu}&title=${et}`,
    Telegram: `https://t.me/share/url?url=${eu}&text=${et}`,
    OK: `https://connect.ok.ru/offer?url=${eu}&title=${et}`,
    WhatsApp: `https://wa.me/?text=${encodeURIComponent(`${text} ${u}`)}`,
    X: `https://twitter.com/intent/tweet?url=${eu}&text=${et}`,
    Facebook: `https://www.facebook.com/sharer/sharer.php?u=${eu}`,
    LinkedIn: `https://www.linkedin.com/sharing/share-offsite/?url=${eu}`,
    Reddit: `https://www.reddit.com/submit?url=${eu}&title=${et}`,
  }
  // Порядок — по аудитории локали (фидбек владельца: «конкретные сети и в ru, и в com»).
  // ru: только доступные В РФ сети (Telegram/WhatsApp/FB/LinkedIn/X заблокированы;
  // мессенджер MAX добавим, когда будет ПОДЛИННАЯ иконка — самодельные запрещены).
  const order = ru ? ['VK', 'OK'] : ['X', 'Reddit', 'LinkedIn', 'Facebook', 'Telegram', 'WhatsApp']
  return order.map((name) => ({ name, href: all[name] }))
}

export interface ShareLabels {
  label?: string
  copiedLabel?: string
  copyLinkLabel?: string
  shareViaLabel?: string
  qrHint?: string
}

/**
 * Содержимое «Поделиться» БЕЗ триггера/обёртки-дропдауна — чтобы переиспользовать
 * и в самостоятельной кнопке ShareButton, и внутри общего «...»-меню шапки
 * (ListHeaderMenu), не дублируя копирование/соцсети/QR. QR генерим на маунте:
 * компонент монтируется только когда меню открыто (Radix-портал), так же как
 * раньше по onOpenChange.
 */
export function ShareMenuItems({ path, title = '', ru = false, label, copiedLabel, copyLinkLabel, shareViaLabel, qrHint }: { path: string; title?: string; ru?: boolean } & ShareLabels) {
  const [copied, setCopied] = useState(false)
  const [qr, setQr] = useState('')
  const [canNative, setCanNative] = useState(false)
  const url = typeof location !== 'undefined' ? location.origin + path : path

  useEffect(() => {
    setCanNative(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
    QRCode.toDataURL(url, { width: 176, margin: 1 }).then(setQr).catch(() => {})
  }, [url])

  const copy = () => {
    navigator.clipboard?.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }
  const nativeShare = () => {
    navigator.share?.({ title: title || undefined, url }).catch(() => {})
  }
  const nets = networks(url, title, ru)

  return (
    <>
      {canNative && (
        <button
          onClick={nativeShare}
          className="mb-1 flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink"
        >
          <Share2 size={15} /> {label}
        </button>
      )}
      <button
        onClick={copy}
        className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink"
      >
        {copied ? <Check size={15} className="text-ok" /> : <Copy size={15} />}
        {copied ? (copiedLabel ?? copyLinkLabel) : copyLinkLabel}
      </button>

      <div className="mt-2 border-t border-border pt-2">
        {shareViaLabel && (
          <div className="mb-1.5 px-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{shareViaLabel}</div>
        )}
        <div className="grid grid-cols-3 gap-1">
          {nets.map((n) => (
            <a
              key={n.name}
              href={n.href}
              target="_blank"
              rel="noreferrer"
              aria-label={n.name}
              className="flex flex-col items-center gap-1 rounded-md px-1 py-2 text-muted hover:bg-surface-2 hover:text-ink"
            >
              {ICON[n.name]}
              <span className="text-[10.5px] leading-none">{n.name}</span>
            </a>
          ))}
        </div>
      </div>

      {qr && (
        <div className="mt-2 flex flex-col items-center border-t border-border pt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR" width={160} height={160} className="rounded bg-white p-1" />
          <span className="mt-1.5 text-[11px] text-muted">{qrHint}</span>
        </div>
      )}
    </>
  )
}

/** «Поделиться»: самостоятельная кнопка-дропдаун (соц-сети + копия + QR + системный share). */
export function ShareButton({
  path,
  title = '',
  ru = false,
  className,
  label,
  copiedLabel,
  copyLinkLabel,
  shareViaLabel,
  qrHint,
}: {
  path: string
  title?: string
  /** Порядок соцсетей под аудиторию локали (ru: VK/TG/OK первыми). */
  ru?: boolean
  className?: string
} & ShareLabels) {
  return (
    <DropdownMenu>
      <Tooltip label={label}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={className} aria-label={label || 'Share'}>
          <Share2 size={15} /> {label && <span className="hidden sm:inline">{label}</span>}
        </button>
      </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-[240px] p-3">
        <ShareMenuItems path={path} title={title} ru={ru} label={label} copiedLabel={copiedLabel} copyLinkLabel={copyLinkLabel} shareViaLabel={shareViaLabel} qrHint={qrHint} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
