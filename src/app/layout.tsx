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
import { SIDEBAR_LISTS } from '@/widgets/ListsPanel'
import { listVisibilityState } from '@/features/library/list-visibility'
import { getUserAppearance } from '@/features/settings/appearance'
import { BrowserNotifier } from '@/features/notifications/BrowserNotifier'
import { HydrationSignal } from '@/shared/ui/HydrationSignal'
import { UpdateBanner } from '@/shared/ui/UpdateBanner'
import { getBuildId } from '@/shared/version'
import { TooltipProvider } from '@/shared/ui/Tooltip'
import { AppToaster } from '@/shared/ui/toast'
import { TopNav } from '@/widgets/TopNav'
import { Sidebar } from '@/widgets/Sidebar'
import { SidebarProvider } from '@/widgets/sidebar-context'
import { Footer } from '@/widgets/Footer'
import { ScrollToTop } from '@/shared/ui/ScrollToTop'
import './globals.css'
import { SITE_ORIGIN } from '@/shared/site'

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

const SITE_URL = SITE_ORIGIN
const DESCRIPTION = 'Canonical, runnable, versioned reference lists — run them, check off steps, and fork from the library.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'SetFork — versioned, runnable lists', template: '%s · SetFork' },
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
    title: 'SetFork — versioned, runnable lists',
    description: DESCRIPTION,
    url: SITE_URL,
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'SetFork' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SetFork — versioned, runnable lists',
    description: DESCRIPTION,
    images: ['/og-image.png'],
  },
  other: { 'msapplication-config': '/browserconfig.xml' },
}

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
  // Виртуальная клавиатура РЕСАЙЗИТ контент, а не перекрывает его: поле ввода не
  // прячется под клавиатурой (Chrome/Android). Зум НЕ запрещаем (никаких
  // maximum-scale / userScalable: false) — это доступность; от зума при фокусе
  // спасает 16px в полях (см. globals.css, @media pointer: coarse).
  interactiveWidget: 'resizes-content',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [lang, user] = await Promise.all([getLang(), getSession()])
  const [unread, notifications, browserNotify, ownLists, appearance] = user
    ? await Promise.all([
        getUnreadCount(user.userId),
        getNotifications(user.userId, 8),
        getBrowserNotifyEnabled(user.userId),
        // Ровно столько, сколько показываем ниже: до 13.08.2026 здесь поднимались
        // ВСЕ списки владельца на КАЖДОЙ странице сайта ради десяти строк рейки.
        getUserTemplates(user.userId, user.userId, { limit: SIDEBAR_LISTS }),
        getUserAppearance(user.userId),
      ])
    : [0, [], false, [], { accent: '', font: '', scale: '' }]
  // «Top lists» в боковом меню: недавние списки пользователя (по updatedAt), минимум
  // полей. Значок состояния — тот же признак, что в шапке и в переключателе, и
  // считается одним правилом (list-visibility): у черновика поле visibility говорит
  // лишь о будущем, поэтому по нему рисовать нельзя.
  const topLists = ownLists.map((l) => ({
    handle: l.ownerHandle,
    slug: l.slug,
    title: l.title,
    avatarUrl: l.ownerAvatarUrl,
    visibility: listVisibilityState(l),
  }))
  // Резолвим аватар для шапки: сессия может хранить storage_key — превращаем в imgproxy-URL.
  const navUser = user ? { ...user, avatarUrl: (await avatarSrc(user.avatarUrl, 60)) ?? undefined } : null
  return (
    <html
      lang={lang}
      className={`${sans.variable} ${mono.variable} ${logoFont.variable} ${inter.variable} ${manrope.variable}`}
      // Аккаунтный вид применяем на SSR (no-flash на новом устройстве); на своём
      // браузере localStorage-скрипт ниже перекроет, если выбор там уже есть.
      data-accent={appearance.accent || undefined}
      data-font={appearance.font || undefined}
      data-scale={appearance.scale || undefined}
      suppressHydrationWarning
    >
      <body>
        <HydrationSignal />
        {/* Локальный выбор (localStorage) приоритетнее аккаунтного SSR — мгновенная
            реакция на этом устройстве; иначе остаются data-атрибуты из аккаунта. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var d=document.documentElement,a=localStorage.getItem('sf-accent'),f=localStorage.getItem('sf-font'),s=localStorage.getItem('sf-scale');if(a)d.setAttribute('data-accent',a);else if(a==='')d.removeAttribute('data-accent');if(f)d.setAttribute('data-font',f);else if(f==='')d.removeAttribute('data-font');if(s)d.setAttribute('data-scale',s);else if(s==='')d.removeAttribute('data-scale')}catch(e){}",
          }}
        />
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <TooltipProvider>
            <div className="flex min-h-screen flex-col bg-canvas">
              <SidebarProvider>
                <Suspense>
                  <TopNav lang={lang} user={navUser} isAdmin={isAdminHandle(user?.handle)} unread={unread} notifications={notifications} />
                </Suspense>
                <div className="flex flex-1">
                  <Sidebar lang={lang} authed={!!navUser} topLists={topLists} />
                  <main className="flex min-w-0 flex-1 flex-col">{children}</main>
                </div>
              </SidebarProvider>
              <Footer lang={lang} />
              <ScrollToTop label={lang === 'ru' ? 'Наверх' : 'Back to top'} />
              {/* Детект устаревшей вкладки после деплоя — иначе Server Actions падают UnrecognizedActionError. */}
              <UpdateBanner build={getBuildId()} lang={lang} />
              {user && browserNotify && <BrowserNotifier enabled />}
            </div>
          </TooltipProvider>
          <AppToaster />
        </ThemeProvider>
        {process.env.NEXT_PUBLIC_UMAMI_URL && process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID && (
          <script
            defer
            src={`${process.env.NEXT_PUBLIC_UMAMI_URL}/script.js`}
            data-website-id={process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID}
          />
        )}
      </body>
    </html>
  )
}
