'use client'

import { Printer } from 'lucide-react'
import { buttonClass } from '@/shared/ui/button-style'

/** Кнопка печати сертификата (window.print). Скрыта при печати. */
export function CertificatePrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={buttonClass({ className: 'print:hidden' })}
    >
      <Printer size={14} /> {label}
    </button>
  )
}
