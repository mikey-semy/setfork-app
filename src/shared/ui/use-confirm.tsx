'use client'

import { useCallback, useRef, useState, type ReactNode } from 'react'
import { ConfirmDialog } from './ConfirmDialog'

// Императивное подтверждение поверх ConfirmDialog (Ф2 трека ui-system).
// Для мест, где вопрос задаётся ИЗНУТРИ обработчика (RunView, таблицы админки) —
// раньше они звали нативный confirm(): блокирующий, нестилизуемый, чужой на
// мобиле. Декларативным местам (Danger Zone) по-прежнему лучше сам ConfirmDialog.
//
//   const { confirm, confirmDialog } = useConfirm()
//   ...
//   if (!(await confirm({ title, intro, confirmLabel }))) return
//   ...
//   return <>{...}{confirmDialog}</>

type ConfirmOptions = {
  title: ReactNode
  intro?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** Для по-настоящему необратимого — type-to-confirm, как в ConfirmDialog. */
  confirmPhrase?: string
  confirmHint?: ReactNode
}

export function useConfirm(): {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  confirmDialog: ReactNode
} {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<(ok: boolean) => void>(null)

  const confirm = useCallback((next: ConfirmOptions) => {
    setOpts(next)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const settle = useCallback((ok: boolean) => {
    setOpts(null)
    resolver.current?.(ok)
    resolver.current = null
  }, [])

  const confirmDialog = opts ? (
    <ConfirmDialog
      open
      onClose={() => settle(false)}
      title={opts.title}
      intro={opts.intro}
      confirmLabel={opts.confirmLabel}
      cancelLabel={opts.cancelLabel}
      confirmPhrase={opts.confirmPhrase}
      confirmHint={opts.confirmHint}
      onConfirm={() => settle(true)}
    />
  ) : null

  return { confirm, confirmDialog }
}
