'use client'

import { Printer } from 'lucide-react'

/** Кнопка печати сертификата (window.print). Скрыта при печати. */
export function CertificatePrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[0.8125rem] text-ink-2 hover:border-border-strong hover:text-ink print:hidden"
    >
      <Printer size={14} /> {label}
    </button>
  )
}
