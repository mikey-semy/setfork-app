import type { Metadata } from 'next'
import { Chakra_Petch, Hanken_Grotesk, IBM_Plex_Mono } from 'next/font/google'
import { ThemeProvider } from '@/shared/providers/theme-provider'
import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { avatarSrc } from '@/shared/media'
import { getBrowserNotifyEnabled, getNotifications, getUnreadCount } from '@/features/notifications/queries'
import { BrowserNotifier } from '@/features/notifications/BrowserNotifier'
import { TopNav } from '@/widgets/TopNav'
import { Footer } from '@/widgets/Footer'
import './globals.css'

const sans = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
})
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
})
// Логотип: гротеск с прямыми/квадратными углами (Chakra Petch), жирный.
const logoFont = Chakra_Petch({
  subsets: ['latin'],
  weight: ['700'],
  variable: '--font-logo',
})

export const metadata: Metadata = {
  title: 'SetFork — runnable checklists',
  description: 'Запускаемые версионируемые чек-листы: прогоняй, отмечай шаги, форкай из библиотеки.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [lang, user] = await Promise.all([getLang(), getSession()])
  const [unread, notifications, browserNotify] = user
    ? await Promise.all([getUnreadCount(user.userId), getNotifications(user.userId, 8), getBrowserNotifyEnabled(user.userId)])
    : [0, [], false]
  // Резолвим аватар для шапки: сессия может хранить storage_key — превращаем в imgproxy-URL.
  const navUser = user ? { ...user, avatarUrl: (await avatarSrc(user.avatarUrl, 60)) ?? undefined } : null
  return (
    <html lang={lang} className={`${sans.variable} ${mono.variable} ${logoFont.variable}`} suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          <div className="flex min-h-screen flex-col bg-canvas">
            <TopNav lang={lang} user={navUser} isAdmin={isAdminHandle(user?.handle)} unread={unread} notifications={notifications} />
            <main className="flex flex-1 flex-col">{children}</main>
            <Footer lang={lang} />
            {user && browserNotify && <BrowserNotifier enabled />}
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
