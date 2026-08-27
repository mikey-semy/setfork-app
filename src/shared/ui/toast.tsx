'use client'

import { useTheme } from 'next-themes'
import { Toaster, toast } from 'sonner'
import { t, type Lang } from '@/shared/i18n'

// Единые тосты (sonner). Ошибки/успех показываем ими, а не инлайн-текстом.
// Тема берётся из next-themes (тот же тумблер, что и у всего приложения).
//
// Доступность: sonner сам держит живую область и объявляет сообщение диктору — но
// СВОИ подписи (имя области и крестик) отдаёт по-английски. В русском интерфейсе это
// значит, что человек без зрения слышит «Notifications» и «Close toast» посреди
// русской речи. Подписи приходят из словаря, как и весь остальной текст.
export { toast }

export function AppToaster({ lang }: { lang: Lang }) {
  const { resolvedTheme } = useTheme()
  return (
    <Toaster
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      position="bottom-center"
      richColors
      closeButton
      containerAriaLabel={t('notifications', lang)}
      toastOptions={{ className: 'text-body', closeButtonAriaLabel: t('close', lang) }}
    />
  )
}
