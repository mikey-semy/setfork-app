'use client'

import { useTheme } from 'next-themes'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import type { Lang } from '@/shared/i18n'

export function LangSwitch({ lang }: { lang: Lang }) {
  const router = useRouter()
  function set(next: Lang) {
    if (next === lang) return
    document.cookie = `lang=${next}; path=/; max-age=${60 * 60 * 24 * 365}`
    router.refresh()
  }
  return (
    <span className="inline-flex gap-0.5 rounded-full border border-border bg-surface-2 p-0.5">
      {(['en', 'ru'] as Lang[]).map((l) => (
        <button
          key={l}
          onClick={() => set(l)}
          className={`cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase transition-colors ${
            lang === l ? 'bg-primary text-primary-fg' : 'text-ink-2'
          }`}
        >
          {l}
        </button>
      ))}
    </span>
  )
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const isDark = mounted && resolvedTheme === 'dark'
  return (
    <button
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="grid h-[30px] w-[30px] place-items-center rounded-full border border-border text-ink-2 hover:text-ink"
    >
      {isDark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  )
}
