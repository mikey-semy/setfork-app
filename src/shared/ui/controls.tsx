'use client'

import { useTheme } from 'next-themes'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
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

/** Трёхрежимный переключатель темы (light/dark/system) — один модуль на два места:
 *  labels=false — компактный сегмент из иконок (дропдаун аватарки),
 *  labels=true — кнопки с подписями (Настройки → Appearance). */
export function ThemeModeSwitch({ labels = false, lang }: { labels?: boolean; lang?: Lang }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const ru = lang === 'ru'
  const modes = [
    { value: 'light', label: ru ? 'Светлая' : 'Light', icon: Sun },
    { value: 'dark', label: ru ? 'Тёмная' : 'Dark', icon: Moon },
    { value: 'system', label: ru ? 'Как в системе' : 'System', icon: Monitor },
  ] as const
  const current = mounted ? theme : undefined

  if (!labels) {
    return (
      <span className="inline-flex gap-0.5 rounded-full border border-border bg-surface-2 p-0.5">
        {modes.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={`grid h-[24px] w-[24px] place-items-center rounded-full transition-colors ${
              current === value ? 'bg-primary text-primary-fg' : 'text-ink-2 hover:text-ink'
            }`}
          >
            <Icon size={13} />
          </button>
        ))}
      </span>
    )
  }
  return (
    <div className="flex flex-wrap gap-2">
      {modes.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => setTheme(value)}
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] text-ink transition-colors ${
            current === value ? 'border-accent bg-(--accent-soft)' : 'border-border hover:border-border-strong'
          }`}
        >
          <Icon size={14} className="text-muted" /> {label}
        </button>
      ))}
    </div>
  )
}
