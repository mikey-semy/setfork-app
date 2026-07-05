import { Suspense } from 'react'
import type { Metadata, Viewport } from 'next'
import { Chakra_Petch, Hanken_Grotesk, IBM_Plex_Mono, Inter, Manrope } from 'next/font/google'
import { ThemeProvider } from '@/shared/providers/theme-provider'
import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { avatarSrc } from '@/shared/media'
import { getBrowserNotifyEnabled, getNotifications, getUnreadCount } from '@/features/notifications/queries'
import { getUserTemplates } from '@/features/library/queries'
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
// Альтернативные шрифты интерфейса (Настройки → Appearance, data-font на html).
// С кириллицей — интерфейс двуязычный.
const inter = Inter({ subsets: ['latin', 'cyrillic'], variable: '--font-inter' })
const manrope = Manrope({ subsets: ['latin', 'cyrillic'], variable: '--font-manrope' })

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://setfork.com'
const DESCRIPTION = 'Canonical, runnable, versioned reference lists — run them, check off steps, and fork from the library.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'SetFork — runnable checklists', template: '%s · SetFork' },
  description: DESCRIPTION,
  applicationName: 'SetFork',
  manifest: '/site.webmanifest',
  // Crawl-доступные иконки: браузерная вкладка + результаты поиска Google (favicon в выдаче).
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', type: 'image/png', sizes: '16x16' },
      { url: '/favicon-32x32.png', type: 'image/png', sizes: '32x32' },
      { url: '/favicon-96x96.png', type: 'image/png', sizes: '96x96' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
    other: [{ rel: 'mask-icon', url: '/safari-pinned-tab.svg', color: '#0f172a' }],
  },
  // Помогаем поисковикам индексировать (favicon в выдаче требует индексируемой главной).
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    siteName: 'SetFork',
    title: 'SetFork — runnable checklists',
    description: DESCRIPTION,
    url: SITE_URL,
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'SetFork' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SetFork — runnable checklists',
    description: DESCRIPTION,
    images: ['/og-image.png'],
  },
  other: { 'msapplication-config': '/browserconfig.xml' },
}

export const viewport: Viewport = {
  themeColor: '#0f172a',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [lang, user] = await Promise.all([getLang(), getSession()])
  const [unread, notifications, browserNotify, ownLists] = user
    ? await Promise.all([
        getUnreadCount(user.userId),
        getNotifications(user.userId, 8),
        getBrowserNotifyEnabled(user.userId),
        getUserTemplates(user.userId, user.userId),
      ])
    : [0, [], false, []]
  // «Top lists» в боковом меню: недавние списки пользователя (по updatedAt), минимум полей.
  const topLists = ownLists.slice(0, 10).map((l) => ({ handle: l.ownerHandle, slug: l.slug, avatarUrl: l.ownerAvatarUrl }))
  // Резолвим аватар для шапки: сессия может хранить storage_key — превращаем в imgproxy-URL.
  const navUser = user ? { ...user, avatarUrl: (await avatarSrc(user.avatarUrl, 60)) ?? undefined } : null
  return (
    <html lang={lang} className={`${sans.variable} ${mono.variable} ${logoFont.variable} ${inter.variable} ${manrope.variable}`} suppressHydrationWarning>
      <body>
        {/* Акцент/шрифт из localStorage до первой отрисовки (no-flash; mode ставит next-themes). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var d=document.documentElement,a=localStorage.getItem('sf-accent'),f=localStorage.getItem('sf-font');if(a)d.setAttribute('data-accent',a);if(f)d.setAttribute('data-font',f)}catch(e){}",
          }}
        />
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <div className="flex min-h-screen flex-col bg-canvas">
            <Suspense>
              <TopNav lang={lang} user={navUser} isAdmin={isAdminHandle(user?.handle)} unread={unread} notifications={notifications} topLists={topLists} />
            </Suspense>
            <main className="flex flex-1 flex-col">{children}</main>
            <Footer lang={lang} />
            {user && browserNotify && <BrowserNotifier enabled />}
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
