'use client'

import { useTheme } from 'next-themes'
import { Toaster, toast } from 'sonner'

// Единые тосты (sonner). Ошибки/успех показываем ими, а не инлайн-текстом.
// Тема берётся из next-themes (тот же тумблер, что и у всего приложения).
export { toast }

export function AppToaster() {
  const { resolvedTheme } = useTheme()
  return (
    <Toaster
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      position="bottom-center"
      richColors
      closeButton
      toastOptions={{ className: 'text-body' }}
    />
  )
}
