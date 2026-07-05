'use client'

import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { ThemeModeSwitch } from '@/shared/ui/controls'
import type { Lang } from '@/shared/i18n'

// Настройки внешнего вида (по образцу aep-fullstack):
//   режим — next-themes (light/dark/system);
//   акцентная тема — data-accent на html + localStorage 'sf-accent'
//     (пресеты в globals.css; '' = синий по умолчанию);
//   шрифт — data-font + 'sf-font' ('' = Hanken Grotesk).
// no-flash: inline-скрипт в layout ставит атрибуты до первой отрисовки.

export const ACCENTS = [
  { value: '', labelEn: 'Blue (default)', labelRu: 'Синий (по умолчанию)', swatch: '#2159d6' },
  { value: 'violet', labelEn: 'Violet', labelRu: 'Фиолетовый', swatch: '#7c3aed' },
  { value: 'green', labelEn: 'Green', labelRu: 'Зелёный', swatch: '#15803d' },
  { value: 'orange', labelEn: 'Orange', labelRu: 'Оранжевый', swatch: '#c2570c' },
  { value: 'rose', labelEn: 'Rose', labelRu: 'Розовый', swatch: '#be123c' },
  { value: 'teal', labelEn: 'Teal', labelRu: 'Бирюзовый', swatch: '#0f766e' },
]

const FONTS = [
  { value: '', label: 'Hanken Grotesk', css: 'var(--font-sans)' },
  { value: 'inter', label: 'Inter', css: 'var(--font-inter)' },
  { value: 'manrope', label: 'Manrope', css: 'var(--font-manrope)' },
  { value: 'system', label: 'System', css: 'system-ui, sans-serif' },
]

function applyAttr(attr: 'data-accent' | 'data-font', key: string, value: string) {
  const el = document.documentElement
  if (value) el.setAttribute(attr, value)
  else el.removeAttribute(attr)
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // приватный режим — применится до перезагрузки
  }
}

const pickCls = (on: boolean) =>
  `flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] text-ink transition-colors ${
    on ? 'border-accent bg-[var(--accent-soft)]' : 'border-border hover:border-border-strong'
  }`

export function AppearanceSettings({ lang }: { lang: Lang }) {
  const ru = lang === 'ru'
  const [mounted, setMounted] = useState(false)
  const [accent, setAccent] = useState('')
  const [font, setFont] = useState('')

  useEffect(() => {
    setMounted(true)
    try {
      setAccent(localStorage.getItem('sf-accent') ?? '')
      setFont(localStorage.getItem('sf-font') ?? '')
    } catch {
      // ignore
    }
  }, [])

  if (!mounted) return <div className="h-[240px]" /> // резерв места до гидрации

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mb-2 text-[12.5px] font-semibold text-ink">{ru ? 'Тема' : 'Theme'}</div>
        <ThemeModeSwitch labels lang={lang} />
      </div>

      <div>
        <div className="mb-2 text-[12.5px] font-semibold text-ink">{ru ? 'Акцентный цвет' : 'Accent color'}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ACCENTS.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => {
                setAccent(a.value)
                applyAttr('data-accent', 'sf-accent', a.value)
              }}
              className={pickCls(accent === a.value)}
            >
              <span className="h-4 w-4 shrink-0 rounded-full border border-border/50" style={{ backgroundColor: a.swatch }} />
              <span className="min-w-0 truncate">{ru ? a.labelRu : a.labelEn}</span>
              {accent === a.value && <Check size={13} className="ml-auto shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-[12.5px] font-semibold text-ink">{ru ? 'Шрифт' : 'Font'}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {FONTS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                setFont(f.value)
                applyAttr('data-font', 'sf-font', f.value)
              }}
              style={{ fontFamily: f.css }}
              className={pickCls(font === f.value)}
            >
              <span className="min-w-0 truncate">{f.label}</span>
              {font === f.value && <Check size={13} className="ml-auto shrink-0 text-accent" />}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted">
          {ru
            ? 'Настройки вида хранятся в этом браузере (localStorage), не в аккаунте.'
            : 'Appearance is stored in this browser (localStorage), not in your account.'}
        </p>
      </div>
    </div>
  )
}
