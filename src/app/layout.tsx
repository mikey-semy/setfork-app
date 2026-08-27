import { Suspense } from 'react'
import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { ThemeProvider } from '@/shared/providers/theme-provider'
import { getSession } from '@/shared/auth/session'
import { isAdminHandle } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { avatarSrc } from '@/shared/media'
import { getBrowserNotifyEnabled, getNotifications, getUnreadCount } from '@/features/notifications/queries'
import { getUserTemplates } from '@/features/library/queries'
import { SIDEBAR_LISTS } from '@/shared/lib/paging'
import { listVisibilityState } from '@/features/library/list-visibility'
import { getUserAppearance } from '@/features/settings/appearance'
import { BrowserNotifier } from '@/features/notifications/BrowserNotifier'
import { LAYER } from '@/shared/ui/control'
import { buttonClass } from '@/shared/ui/button-style'
import { HydrationSignal } from '@/shared/ui/HydrationSignal'
import { UpdateBanner } from '@/shared/ui/UpdateBanner'
import { getBuildId } from '@/shared/version'
import { TooltipProvider } from '@/shared/ui/Tooltip'
import { AppToaster } from '@/shared/ui/toast'
import { TopNav } from '@/widgets/TopNav'
import { Sidebar } from '@/widgets/Sidebar'
import { cookies } from 'next/headers'
import { SidebarProvider } from '@/widgets/sidebar-context'
import { SIDEBAR_COOKIE } from '@/shared/lib/sidebar-cookie'
import { Footer } from '@/widgets/Footer'
import { ScrollToTop } from '@/shared/ui/ScrollToTop'
import './globals.css'
import { SITE_ORIGIN } from '@/shared/site'

/**
 * ШРИФТЫ ЛЕЖАТ В РЕПОЗИТОРИИ, а не качаются на сборке.
 *
 * Было `next/font/google`: каждая сборка ходила на `fonts.gstatic.com`. 20.08 этот адрес
 * перестал отвечать через рабочий туннель — и перестало собираться ВСЁ, локально и в CI
 * (раннеры на той же машине), при полностью исправном коде. Внешний сервис в середине гейта
 * — это его отказ, засчитанный нам.
 *
 * Файлы взяты из npm-пакетов `@fontsource/*` (те же оригиналы Google) и лежат в
 * `src/shared/fonts` — 236 КБ на пять семейств. Не в `src/app`: каталог внутри `app` это
 * МАРШРУТ, и `app/fonts` занял бы ник «fonts» у людей (поймано уздой `reserved-top`). Сборка теперь не ходит наружу вовсе, прогон воспроизводим, и
 * заодно закрыт юридический хвост — при `next/font/google` часть настроек грузила шрифт у
 * посетителя, то есть его IP уезжал в Google.
 *
 * Обновлять так: `npm i -D @fontsource/<семейство>`, скопировать нужные `.woff2` в
 * `src/shared/fonts/`, пакет удалить. В зависимостях он не нужен — нужны только файлы.
 * Именно в `shared`, а не в `app`: см. предупреждение выше про маршрут и занятый ник.
 */
const sans = localFont({
  src: [
    { path: '../shared/fonts/hanken-grotesk-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../shared/fonts/hanken-grotesk-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../shared/fonts/hanken-grotesk-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../shared/fonts/hanken-grotesk-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-sans',
  display: 'swap',
})
const mono = localFont({
  src: [
    { path: '../shared/fonts/ibm-plex-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../shared/fonts/ibm-plex-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../shared/fonts/ibm-plex-mono-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-mono',
  display: 'swap',
})

const logoFont = localFont({
  src: '../shared/fonts/chakra-petch-latin-700-normal.woff2',
  weight: '700',
  style: 'normal',
  variable: '--font-logo',
  display: 'swap',
})

/**
 * Inter и Manrope — переменные шрифты и нужны с кириллицей, а она лежит ОТДЕЛЬНЫМ файлом:
 * `@fontsource` режет по подмножествам, и объединённого файла у него нет. `next/font/local`
 * не умеет `unicode-range`, поэтому подмножества объявлены двумя семействами, а собираются
 * в стек в globals.css: латиница первой, кириллица следом. Браузер сам берёт второй шрифт
 * для символов, которых нет в первом, — это обычное поведение стека, а не хитрость.
 *
 * `preload: false` у кириллицы намеренно: качать её заранее незачем — на английской странице
 * она не понадобится, а понадобится — загрузится по первому же символу.
 */
const interLatin = localFont({
  src: '../shared/fonts/inter-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-inter-latin',
  display: 'swap',
})
const interCyr = localFont({
  src: '../shared/fonts/inter-cyrillic-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-inter-cyr',
  display: 'swap',
  preload: false,
})
const manropeLatin = localFont({
  src: '../shared/fonts/manrope-latin-wght-normal.woff2',
  weight: '200 800',
  style: 'normal',
  variable: '--font-manrope-latin',
  display: 'swap',
})
const manropeCyr = localFont({
  src: '../shared/fonts/manrope-cyrillic-wght-normal.woff2',
  weight: '200 800',
  style: 'normal',
  variable: '--font-manrope-cyr',
  display: 'swap',
  preload: false,
})

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
  const [lang, user, jar] = await Promise.all([getLang(), getSession(), cookies()])
  // Сайдбар: свёрнут по умолчанию, развёрнут — только по явному выбору человека.
  // Выбор приходит КУКОЙ, чтобы сервер нарисовал его сразу и не было прыжка после гидрации.
  const sidebarCollapsed = jar.get(SIDEBAR_COOKIE)?.value !== '0'
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
      className={`${sans.variable} ${mono.variable} ${logoFont.variable} ${interLatin.variable} ${interCyr.variable} ${manropeLatin.variable} ${manropeCyr.variable}`}
      // Аккаунтный вид применяем на SSR (no-flash на новом устройстве); на своём
      // браузере localStorage-скрипт ниже перекроет, если выбор там уже есть.
      data-accent={appearance.accent || undefined}
      data-font={appearance.font || undefined}
      data-scale={appearance.scale || undefined}
      suppressHydrationWarning
    >
      <body>
        {/* ПЕРЕХОД К СОДЕРЖИМОМУ — первая цель Tab на любой странице.
            Без него человек с клавиатуры и диктором обязан на КАЖДОЙ странице пройти
            шапку и весь боковой список, прежде чем добраться до текста (WCAG 2.4.1
            «Обход блоков»). Ссылка не видна, пока не получит фокус — приём стандартный,
            так сделано у GitHub и в государственных дизайн-системах. */}
        <a href="#main" className={buttonClass({ variant: 'outline', className: `sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 ${LAYER.toast}` })}>
          {t('skipToContent', lang)}
        </a>
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
              {/* Состояние сайдбара приходит из куки: сервер рисует его сразу таким, каким
                  человек его оставил, и разворачивавший не видит прыжка после гидрации. */}
              <SidebarProvider initialCollapsed={sidebarCollapsed}>
                <Suspense>
                  <TopNav lang={lang} user={navUser} isAdmin={isAdminHandle(user?.handle)} unread={unread} notifications={notifications} />
                </Suspense>
                <div className="flex flex-1">
                  <Sidebar lang={lang} authed={!!navUser} topLists={topLists} />
                  {/* tabIndex=-1: цель перехода обязана уметь ПРИНЯТЬ фокус, иначе браузер
                      прокрутит страницу, но чтение диктора продолжится со старого места. */}
                  <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-hidden">
                    {children}
                  </main>
                </div>
              </SidebarProvider>
              <Footer lang={lang} />
              <ScrollToTop label={lang === 'ru' ? 'Наверх' : 'Back to top'} />
              {/* Детект устаревшей вкладки после деплоя — иначе Server Actions падают UnrecognizedActionError. */}
              <UpdateBanner build={getBuildId()} lang={lang} />
              {user && browserNotify && <BrowserNotifier enabled />}
            </div>
          </TooltipProvider>
          <AppToaster lang={lang} />
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
