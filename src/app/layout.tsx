import type { Metadata } from 'next'
import { Hanken_Grotesk, IBM_Plex_Mono } from 'next/font/google'
import { ThemeProvider } from '@/shared/providers/theme-provider'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { TopNav } from '@/widgets/TopNav'
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

export const metadata: Metadata = {
  title: 'SetHub — runnable checklists',
  description: 'Запускаемые версионируемые чек-листы: прогоняй, отмечай шаги, форкай из библиотеки.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [lang, user] = await Promise.all([getLang(), getSession()])
  return (
    <html lang={lang} className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          <div className="flex min-h-screen flex-col bg-canvas">
            <TopNav lang={lang} user={user} />
            <main className="flex flex-1 flex-col">{children}</main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
