'use client'

import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { ThemeModeSwitch } from '@/shared/ui/controls'
import { t, type Lang } from '@/shared/i18n'
import { saveAppearance } from './appearance-actions'

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
  // Латиница и кириллица у этих двух — разные файлы, поэтому в образце тоже стек:
  // иначе русское имя шрифта в списке рисовалось бы запасным системным.
  { value: 'inter', label: 'Inter', css: 'var(--font-inter-latin), var(--font-inter-cyr)' },
  { value: 'manrope', label: 'Manrope', css: 'var(--font-manrope-latin), var(--font-manrope-cyr)' },
  { value: 'system', label: 'System', css: 'system-ui, sans-serif' },
]

// Масштаб (Ф6): все размеры в rem, корневой font-size масштабирует всё
// пропорционально; '' = 100%. Значения — как в SCALE_VALUES экшена.
const SCALES = [
  { value: '90', labelEn: 'Compact · 90%', labelRu: 'Компактный · 90%' },
  { value: '', labelEn: 'Default · 100%', labelRu: 'Стандартный · 100%' },
  { value: '110', labelEn: 'Large · 110%', labelRu: 'Крупный · 110%' },
]

function applyAttr(attr: 'data-accent' | 'data-font' | 'data-scale', key: string, value: string) {
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
  `flex items-center gap-2 rounded-md border px-3 py-2 text-body text-ink transition-colors ${
    on ? 'border-accent bg-accent-soft' : 'border-border hover:border-border-strong'
  }`

export function AppearanceSettings({
  lang,
  initialAccent = '',
  initialFont = '',
  initialScale = '',
}: {
  lang: Lang
  initialAccent?: string
  initialFont?: string
  initialScale?: string
}) {
  const ru = lang === 'ru'
  const [mounted, setMounted] = useState(false)
  const [accent, setAccent] = useState(initialAccent)
  const [font, setFont] = useState(initialFont)
  const [scale, setScale] = useState(initialScale)

  useEffect(() => {
    setMounted(true)
    try {
      // Локальный выбор приоритетнее (мгновенная реакция на этом устройстве);
      // при пустом localStorage берём значение из аккаунта (новое устройство).
      setAccent(localStorage.getItem('sf-accent') ?? initialAccent)
      setFont(localStorage.getItem('sf-font') ?? initialFont)
      setScale(localStorage.getItem('sf-scale') ?? initialScale)
    } catch {
      // ignore
    }
  }, [initialAccent, initialFont, initialScale])

  // Меняем локально (мгновенно, no-flash) и синхронизируем в аккаунт
  // (fire-and-forget) — ТОЛЬКО изменившееся поле: локальная копия остальных
  // может отставать от аккаунта и не должна его затирать (Codex #623).
  function pickAccent(v: string) {
    setAccent(v)
    applyAttr('data-accent', 'sf-accent', v)
    void saveAppearance({ accent: v })
  }
  function pickFont(v: string) {
    setFont(v)
    applyAttr('data-font', 'sf-font', v)
    void saveAppearance({ font: v })
  }
  function pickScale(v: string) {
    setScale(v)
    applyAttr('data-scale', 'sf-scale', v)
    void saveAppearance({ scale: v })
  }

  if (!mounted) return <div className="h-60" /> // резерв места до гидрации

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mb-2 text-body-sm font-semibold text-ink">{ru ? 'Тема' : 'Theme'}</div>
        <ThemeModeSwitch labels lang={lang} />
      </div>

      <div>
        <div className="mb-2 text-body-sm font-semibold text-ink">{ru ? 'Акцентный цвет' : 'Accent color'}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ACCENTS.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => pickAccent(a.value)}
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
        <div className="mb-2 text-body-sm font-semibold text-ink">{t('uiScale', lang)}</div>
        <div className="grid grid-cols-3 gap-2">
          {SCALES.map((s) => (
            <button key={s.value} type="button" onClick={() => pickScale(s.value)} className={pickCls(scale === s.value)}>
              <span className="min-w-0 truncate">{ru ? s.labelRu : s.labelEn}</span>
              {scale === s.value && <Check size={13} className="ml-auto shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-body-sm font-semibold text-ink">{ru ? 'Шрифт' : 'Font'}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {FONTS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => pickFont(f.value)}
              style={{ fontFamily: f.css }}
              className={pickCls(font === f.value)}
            >
              <span className="min-w-0 truncate">{f.label}</span>
              {font === f.value && <Check size={13} className="ml-auto shrink-0 text-accent" />}
            </button>
          ))}
        </div>
        <p className="mt-2 text-body-sm text-muted">
          {ru
            ? 'Акцент и шрифт сохраняются в аккаунте и следуют за тобой между устройствами. Тема (светлая/тёмная) — в этом браузере.'
            : 'Accent and font are saved to your account and follow you across devices. Theme (light/dark) stays in this browser.'}
        </p>
      </div>
    </div>
  )
}
