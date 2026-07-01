import type { Metadata } from 'next'
import { Hanken_Grotesk, IBM_Plex_Mono } from 'next/font/google'
import { ThemeProvider } from '@/shared/providers/theme-provider'
import { getLang } from '@/shared/i18n/server'
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
  const lang = await getLang()
  return (
    <html lang={lang} className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
